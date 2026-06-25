import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getGeminiKey } from './config';
import { detect } from './cleaner';
import { runDub } from './dub';
import { videoEncoderOptions } from './encoder';
import { buildVubPlan } from '../../src/vub/ffmpegBuild';
import type { VubEffects, VubParams, VubText } from '../../src/vub/types';
import type { FunnelStartRequest, FunnelProgressEvent } from '../../src/funnel/types';

// Оркестратор модуля «Воронка»: скачивание (yt-dlp) -> AI-классификация (Gemini)
// -> маршрутизация по 5 веткам -> выполнение ветки (переиспользуя Cleaner/Дубляж/VUB)
// -> сохранение результата. Переиспользует уже реализованные модули, не дублируя код.

const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

let cancelled = false;
const activeFfmpeg = new Set<ffmpeg.FfmpegCommand>();
const activeProc = new Set<ChildProcess>();

function pyCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}
function scriptPath(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', name)
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', name);
}
function ffmpegDir(): string | null {
  return ffmpegPath ? path.dirname(ffmpegPath) : null;
}

const VIDEO_EXT = /\.(mp4|mov|avi|webm|mkv)$/i;

// Коды целевых языков воронки -> языки дубляжа/перевода (BR = бразильский португальский).
const LANG_MAP: Record<string, string> = { en: 'en', es: 'es', fr: 'fr', br: 'pt', tr: 'tr' };

function send(win: BrowserWindow | null, ev: FunnelProgressEvent) {
  win?.webContents.send('funnel-progress', ev);
}

// ── Probe ──────────────────────────────────────────────────────────────────
interface Probe {
  duration: number;
  hasAudio: boolean;
  width: number;
  height: number;
}
function probe(file: string): Promise<Probe> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err || !data) {
        resolve({ duration: 0, hasAudio: false, width: 0, height: 0 });
        return;
      }
      const streams = data.streams ?? [];
      const v = streams.find((s) => s.codec_type === 'video');
      resolve({
        duration: data.format?.duration ?? 0,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        width: v?.width ?? 0,
        height: v?.height ?? 0,
      });
    });
  });
}

// ── Скачивание (yt-dlp, с поддержкой плейлистов/аккаунтов) ────────────────────
function ytdlpInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pyCmd(), ['-m', 'yt_dlp', '--version']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function installYtdlp(): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const child = spawn(pyCmd(), ['-u', '-m', 'pip', 'install', '--upgrade', 'yt-dlp'], {
      env: { ...process.env, PYTHONUNBUFFERED: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' },
    });
    child.on('error', (err) => resolve({ error: `Python/pip недоступен: ${err.message}` }));
    child.on('close', (code) => (code === 0 ? resolve({ ok: true }) : resolve({ error: `pip код ${code}` })));
  });
}

// Скачивает по ссылке (одно видео или весь аккаунт/плейлист) в outDir.
// onPercent — суммарный прогресс скачивания 0..100. Возвращает список файлов.
function runDownload(
  url: string,
  outDir: string,
  onPercent: (pct: number) => void
): Promise<{ ok: true; files: string[] } | { error: string }> {
  return new Promise((resolve) => {
    const args = [
      '-m', 'yt_dlp',
      '--yes-playlist',
      '--no-warnings',
      '--newline',
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '-o', path.join(outDir, '%(playlist_index|0)s_%(title).60B.%(ext)s'),
    ];
    const dir = ffmpegDir();
    if (dir) args.push('--ffmpeg-location', dir);
    args.push(url);

    const child = spawn(pyCmd(), args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    activeProc.add(child);
    let stderr = '';
    const onOut = (chunk: Buffer) => {
      const s = chunk.toString();
      const m = [...s.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
      if (m.length) onPercent(parseFloat(m[m.length - 1][1]));
    };
    child.stdout.on('data', onOut);
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      onOut(c);
    });
    child.on('error', (err) => {
      activeProc.delete(child);
      resolve({ error: `Не удалось запустить yt-dlp: ${err.message}` });
    });
    child.on('close', (code) => {
      activeProc.delete(child);
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? `код ${code}`;
        resolve({ error: `Ошибка загрузки: ${tail}` });
        return;
      }
      const files = fs.existsSync(outDir)
        ? fs.readdirSync(outDir).filter((n) => VIDEO_EXT.test(n)).map((n) => path.join(outDir, n))
        : [];
      if (!files.length) resolve({ error: 'Видео скачано, но не найдено на диске' });
      else resolve({ ok: true, files });
    });
  });
}

// ── AI-классификация (Gemini) ────────────────────────────────────────────────
interface Classification {
  branch: number;
  has_voice: boolean;
  has_subtitles: boolean;
  has_text_overlay: boolean;
  language: string;
  text_content: string;
  confidence: number;
}
function analyze(video: string, apiKey: string): Promise<Classification | { error: string }> {
  return new Promise((resolve) => {
    const child = spawn(pyCmd(), [scriptPath('gemini_analyzer.py'), video, '--api-key', apiKey], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    activeProc.add(child);
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', (e) => {
      activeProc.delete(child);
      resolve({ error: e.message });
    });
    child.on('close', () => {
      activeProc.delete(child);
      try {
        const r = JSON.parse(out.trim());
        if (r.ok) resolve(r as Classification);
        else resolve({ error: r.error || 'Ошибка анализа Gemini' });
      } catch {
        resolve({ error: err.trim() || 'gemini_analyzer.py недоступен' });
      }
    });
  });
}

// ── Базовые операции веток ───────────────────────────────────────────────────
function escFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
function escDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

// Запуск ffmpeg-команды с регистрацией в active (для отмены).
function runCmd(cmd: ffmpeg.FfmpegCommand, out: string): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    cmd
      .output(out)
      .on('end', () => {
        activeFfmpeg.delete(cmd);
        resolve({ ok: true });
      })
      .on('error', (e) => {
        activeFfmpeg.delete(cmd);
        if (!cancelled) resolve({ error: e.message });
        else resolve({ ok: true });
      });
    activeFfmpeg.add(cmd);
    cmd.run();
  });
}

// Лёгкая уникализация результата (переиспользуем планировщик фильтров VUB).
async function uniqueize(src: string, out: string): Promise<{ ok: true } | { error: string }> {
  const off: VubParams['brightness'] = { enabled: false, min: 0, max: 0 };
  const params: VubParams = {
    brightness: { enabled: true, min: -5, max: 5 },
    contrast: { enabled: true, min: -5, max: 5 },
    sharpness: off,
    volume: off,
    duration: off,
    rotation: { enabled: true, min: -2, max: 2 },
  };
  const effects: VubEffects = {
    darken: { enabled: false, duration: 0, audioFadeIn: false },
    mirror: { enabled: false, mode: 'never' },
    grid: { enabled: false, opacityMin: 0, opacityMax: 0 },
    gridColor: { enabled: false, colors: [] },
    gridSize: { enabled: false, size: 32 },
  };
  const text: VubText = { spintax: '', font: '', size: 24, color: '#FFFFFF', position: 'bottom' };
  const plan = buildVubPlan(params, effects, text, true, 0, 1);
  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 22 });
  const cmd = ffmpeg(src).addInputOption('-nostdin');
  if (plan.videoFilters.length) cmd.videoFilters(plan.videoFilters.join(','));
  if (plan.audioFilters.length) cmd.audioFilters(plan.audioFilters.join(','));
  cmd.outputOptions('-map_metadata', '-1');
  for (const [k, v] of Object.entries(plan.metadata)) cmd.outputOptions('-metadata', `${k}=${v}`);
  cmd.outputOptions(venc).outputOptions('-movflags', '+faststart');
  return runCmd(cmd, out);
}

// Удаление «выжженного» текста (субтитры/плашки) через детектор Cleaner + delogo.
// dynamicTextOnly=true — только меняющийся текст (субтитры); false — весь текст (плашки+сабы).
async function removeOverlays(
  src: string,
  out: string,
  dynamicTextOnly: boolean
): Promise<{ ok: true } | { error: string }> {
  const det = await detect(src, { detectTitles: true, detectWatermarks: false, dynamicTextOnly });
  if (cancelled) return { ok: true };
  const W = det.width || 0;
  const H = det.height || 0;
  const boxes = (det.boxes || []).filter((b) => (b.conf ?? 1) >= 0.25);

  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 });
  const cmd = ffmpeg(src).addInputOption('-nostdin');
  if (boxes.length && W && H) {
    const vf = boxes
      .map((b) => {
        let x = Math.max(1, Math.round(b.x * W));
        let y = Math.max(1, Math.round(b.y * H));
        let w = Math.round(b.w * W);
        let h = Math.round(b.h * H);
        if (x + w > W - 1) w = W - 1 - x;
        if (y + h > H - 1) h = H - 1 - y;
        return { x, y, w, h };
      })
      .filter((b) => b.w > 4 && b.h > 4)
      .map((b) => `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}`)
      .join(',');
    if (vf) cmd.videoFilters(vf);
  }
  cmd.outputOptions(venc).outputOptions('-movflags', '+faststart');
  return runCmd(cmd, out);
}

// Перевод строки текста плашки на целевой язык (deep-translator через translate.py).
function translateText(text: string, tgt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!text.trim()) {
      resolve('');
      return;
    }
    const tmp = path.join(os.tmpdir(), `funnel_tr_${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify([text]), 'utf-8');
    const child = spawn(pyCmd(), [scriptPath('translate.py'), '--in', tmp, '--src', 'auto', '--tgt', tgt]);
    let out = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.on('error', () => {
      fs.promises.unlink(tmp).catch(() => {});
      resolve(text);
    });
    child.on('close', () => {
      fs.promises.unlink(tmp).catch(() => {});
      try {
        const r = JSON.parse(out.trim());
        resolve(r.ok && r.texts?.[0] ? r.texts[0] : text);
      } catch {
        resolve(text);
      }
    });
  });
}

// Наложение новой текстовой плашки на видео (FFmpeg drawtext).
async function overlayPlate(src: string, out: string, text: string, H: number): Promise<{ ok: true } | { error: string }> {
  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 });
  const cmd = ffmpeg(src).addInputOption('-nostdin');
  const t = escDrawtext(text);
  const fontSize = Math.max(28, Math.round((H || 1920) * 0.05));
  if (t) {
    cmd.videoFilters(
      `drawtext=text='${t}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.5:boxborderw=14`
    );
  }
  cmd.outputOptions(venc).outputOptions('-movflags', '+faststart');
  return runCmd(cmd, out);
}

// Временный файл с уникальным именем.
function tmpFile(): string {
  return path.join(os.tmpdir(), `funnel_${Math.random().toString(36).slice(2, 10)}.mp4`);
}

// ── Выполнение ветки для одного видео и одного целевого языка ─────────────────
// Возвращает путь готового файла либо ошибку.
async function processBranchLang(
  src: string,
  branch: number,
  langCode: string,
  cls: Classification,
  req: FunnelStartRequest,
  baseName: string,
  H: number,
  stage: (label: string) => void
): Promise<{ ok: true; out: string } | { error: string }> {
  const dubLang = LANG_MAP[langCode] || langCode;
  const sep = req.outputDir.includes('\\') ? '\\' : '/';
  const finalOut = `${req.outputDir}${sep}${baseName}_b${branch}_${langCode}.mp4`;
  const temps: string[] = [];
  const cleanup = () => temps.forEach((f) => fs.promises.unlink(f).catch(() => {}));

  // Дубляж (без прогресс-событий — оркестратор шлёт свои этапы).
  const dub = (input: string, burnSubs: boolean) =>
    runDub(
      {
        videoPath: input,
        sourceLang: cls.language && cls.language !== 'unknown' ? cls.language : 'auto',
        targetLang: dubLang,
        keepOriginal: true,
        originalVolume: 0.12,
        syncTiming: true,
        burnSubs,
        outputDir: os.tmpdir(),
      },
      () => {}
    );

  try {
    let cur = src; // текущий промежуточный файл
    if (branch === 2) {
      // Субтитры + голос: удалить оригинальные субтитры -> дубляж + новые субтитры.
      stage(`${langCode}: удаление субтитров`);
      const t1 = tmpFile();
      temps.push(t1);
      const r1 = await removeOverlays(cur, t1, true);
      if ('error' in r1) return r1;
      stage(`${langCode}: дубляж + субтитры`);
      const r2 = await dub(t1, true);
      if ('error' in r2) return r2;
      temps.push(r2.out);
      cur = r2.out;
    } else if (branch === 3) {
      // Нет субтитров + голос: дубляж + новые субтитры.
      stage(`${langCode}: дубляж + субтитры`);
      const r = await dub(cur, true);
      if ('error' in r) return r;
      temps.push(r.out);
      cur = r.out;
    } else if (branch === 4) {
      // Плашка + нет голоса: удалить плашку -> перевести текст -> новая плашка.
      stage(`${langCode}: удаление плашки`);
      const t1 = tmpFile();
      temps.push(t1);
      const r1 = await removeOverlays(cur, t1, false);
      if ('error' in r1) return r1;
      stage(`${langCode}: перевод и плашка`);
      const translated = await translateText(cls.text_content, dubLang);
      const t2 = tmpFile();
      temps.push(t2);
      const r2 = await overlayPlate(t1, t2, translated, H);
      if ('error' in r2) return r2;
      cur = t2;
    } else if (branch === 5) {
      // Плашка + голос: удалить плашку+сабы -> новая плашка -> дубляж + новые субтитры.
      stage(`${langCode}: удаление плашки и субтитров`);
      const t1 = tmpFile();
      temps.push(t1);
      const r1 = await removeOverlays(cur, t1, false);
      if ('error' in r1) return r1;
      stage(`${langCode}: перевод и плашка`);
      const translated = await translateText(cls.text_content, dubLang);
      const t2 = tmpFile();
      temps.push(t2);
      const r2 = await overlayPlate(t1, t2, translated, H);
      if ('error' in r2) return r2;
      stage(`${langCode}: дубляж + субтитры`);
      const r3 = await dub(t2, true);
      if ('error' in r3) return r3;
      temps.push(r3.out);
      cur = r3.out;
    } else {
      return { error: `Ветка ${branch} не требует обработки по языку` };
    }

    // Финализация: опц. уникализация -> в итоговую папку.
    if (req.uniqueize) {
      stage(`${langCode}: уникализация`);
      const r = await uniqueize(cur, finalOut);
      if ('error' in r) return r;
    } else {
      await fs.promises.copyFile(cur, finalOut);
    }
    return { ok: true, out: finalOut };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cleanup();
  }
}

// ── Обработка одного скачанного видео целиком ─────────────────────────────────
async function processVideo(
  src: string,
  id: string,
  req: FunnelStartRequest,
  apiKey: string,
  win: BrowserWindow | null
): Promise<void> {
  const baseName = path.parse(src).name.replace(/[^\w\-]+/g, '_').slice(0, 48) || 'video';
  const emit = (ev: Omit<FunnelProgressEvent, 'id'>) => send(win, { id, ...ev });

  // AI-классификация.
  emit({ stage: 'analyzing', percent: 12, stageLabel: 'AI-анализ (Gemini)…' });
  const cls = await analyze(src, apiKey);
  if (cancelled) return;
  if ('error' in cls) {
    emit({ stage: 'error', percent: 0, error: cls.error });
    return;
  }
  emit({ stage: 'processing', percent: 15, branch: cls.branch, stageLabel: `Ветка ${cls.branch}` });

  const { height } = await probe(src);

  // Ветка 1: только уникализация (без привязки к языку).
  if (cls.branch === 1) {
    const sep = req.outputDir.includes('\\') ? '\\' : '/';
    const out = `${req.outputDir}${sep}${baseName}_b1_unique.mp4`;
    emit({ stage: 'processing', percent: 40, stageLabel: 'Уникализация' });
    const r = req.uniqueize ? await uniqueize(src, out) : await fs.promises.copyFile(src, out).then(() => ({ ok: true as const }));
    if (cancelled) return;
    if ('error' in r) emit({ stage: 'error', percent: 0, error: r.error });
    else emit({ stage: 'done', percent: 100, output: out, stageLabel: 'Готово' });
    return;
  }

  // Ветки 2–5: по одному результату на каждый целевой язык.
  const langs = req.targetLanguages.length ? req.targetLanguages : ['en'];
  let firstErr = '';
  let produced = 0;
  for (let i = 0; i < langs.length; i++) {
    if (cancelled) return;
    const base = 15 + (i / langs.length) * 75;
    const r = await processBranchLang(src, cls.branch, langs[i], cls, req, baseName, height, (label) =>
      emit({ stage: 'processing', percent: Math.round(base + 5), branch: cls.branch, stageLabel: label })
    );
    if (cancelled) return;
    if ('error' in r) {
      if (!firstErr) firstErr = r.error;
    } else {
      produced++;
      emit({ stage: 'processing', percent: Math.round(15 + ((i + 1) / langs.length) * 75), output: r.out });
    }
  }

  if (produced === 0) emit({ stage: 'error', percent: 0, error: firstErr || 'Не удалось обработать ни один язык' });
  else emit({ stage: 'done', percent: 100, stageLabel: `Готово (${produced})` });
}

export function registerFunnelHandlers() {
  ipcMain.handle('funnel:start', async (event, req: FunnelStartRequest) => {
    cancelled = false;
    const win = BrowserWindow.fromWebContents(event.sender);

    const apiKey = getGeminiKey();
    if (!apiKey) return { error: 'Не задан ключ Gemini API (Настройки). Он нужен для AI-классификации.' };
    if (!req.url || !/^https?:\/\//i.test(req.url.trim())) return { error: 'Введите корректную ссылку (http/https)' };
    if (!req.outputDir) return { error: 'Не выбрана папка сохранения' };

    // Загрузчик yt-dlp.
    if (!(await ytdlpInstalled())) {
      const inst = await installYtdlp();
      if ('error' in inst) return inst;
      if (!(await ytdlpInstalled())) return { error: 'yt-dlp не установился. Проверьте Python.' };
    }

    // Скачивание (общий прогресс показываем на временной строке id=download).
    const dlDir = path.join(app.getPath('downloads'), 'Beatleap', 'funnel', String(Date.now()));
    fs.mkdirSync(dlDir, { recursive: true });
    send(win, { id: 'download', name: 'Скачивание', stage: 'downloading', percent: 0, stageLabel: 'Скачивание видео…' });
    const dl = await runDownload(req.url.trim(), dlDir, (pct) =>
      send(win, { id: 'download', stage: 'downloading', percent: Math.round(pct * 0.1) })
    );
    if (cancelled) return { ok: true };
    if ('error' in dl) {
      send(win, { id: 'download', stage: 'error', percent: 0, error: dl.error });
      return dl;
    }
    // Заводим задачи в очереди по числу скачанных видео.
    const items = dl.files.map((f, i) => ({ id: `funnel_${Date.now()}_${i}`, path: f }));
    send(win, {
      id: 'download',
      stage: 'done',
      percent: 100,
      stageLabel: `Скачано: ${items.length}`,
    });
    for (const it of items) {
      send(win, {
        id: it.id,
        name: path.basename(it.path),
        stage: 'queued',
        percent: 10,
        stageLabel: 'В очереди',
      });
    }

    // Последовательная обработка каждого видео.
    for (const it of items) {
      if (cancelled) break;
      await processVideo(it.path, it.id, req, apiKey, win);
    }
    return { ok: true };
  });

  ipcMain.handle('funnel:cancel', () => {
    cancelled = true;
    for (const cmd of activeFfmpeg) {
      try {
        cmd.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
    activeFfmpeg.clear();
    for (const proc of activeProc) {
      try {
        proc.kill();
      } catch {
        /* noop */
      }
    }
    activeProc.clear();
    return { ok: true };
  });
}
