import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getOpenRouterKey } from './config';
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
const activeAborts = new Set<AbortController>();

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

// Надёжное завершение процесса вместе с дочерними (yt-dlp порождает ffmpeg).
// На Windows обычный kill не убивает дерево — используем taskkill /T /F.
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      /* noop */
    }
  }
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

// Максимум видео при ссылке на аккаунт/плейлист (защита от выкачивания всего профиля).
const PLAYLIST_LIMIT = 20;

// Скачивает по ссылке (одно видео или аккаунт/плейлист) в outDir.
// onReport — прогресс текущего файла (0..100) и/или человекочитаемая метка этапа.
// Возвращает список файлов. «Ленивый» плейлист: качает по мере перечисления (не ждёт весь список).
function runDownload(
  url: string,
  outDir: string,
  onReport: (r: { percent?: number; label?: string }) => void
): Promise<{ ok: true; files: string[] } | { error: string }> {
  return new Promise((resolve) => {
    const args = [
      '-m', 'yt_dlp',
      '--yes-playlist',
      '--lazy-playlist', // начинать загрузку сразу, не перечисляя весь аккаунт
      '--playlist-end', String(PLAYLIST_LIMIT),
      '--ignore-errors', // один сбойный ролик не валит всю пачку
      '--socket-timeout', '30',
      '--retries', '3',
      '--no-warnings',
      '--newline',
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '-o', path.join(outDir, '%(playlist_index|0)s_%(title).60B.%(ext)s'),
    ];
    const dir = ffmpegDir();
    if (dir) args.push('--ffmpeg-location', dir);
    args.push(url);

    onReport({ label: 'Получаю список видео…' });
    const child = spawn(pyCmd(), args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    activeProc.add(child);
    let stderr = '';
    const onOut = (chunk: Buffer) => {
      const s = chunk.toString();
      // Номер текущего ролика в пачке.
      const item = [...s.matchAll(/Downloading (?:item|video) (\d+) of (\d+)/gi)].pop();
      if (item) onReport({ label: `Скачиваю видео ${item[1]} из ${item[2]}…`, percent: 0 });
      // Процент текущего файла.
      const m = [...s.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
      if (m.length) onReport({ percent: parseFloat(m[m.length - 1][1]) });
      if (/\[Merger\]|Merging formats/i.test(s)) onReport({ label: 'Склеиваю дорожки…' });
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
      const files = fs.existsSync(outDir)
        ? fs.readdirSync(outDir).filter((n) => VIDEO_EXT.test(n)).map((n) => path.join(outDir, n))
        : [];
      // С --ignore-errors код может быть ненулевым, но часть файлов скачана — это успех.
      if (files.length) {
        resolve({ ok: true, files });
        return;
      }
      const tail = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? `код ${code}`;
      resolve({ error: `Ошибка загрузки: ${tail}` });
    });
  });
}

// ── AI-классификация (OpenRouter, мультимодальная модель: кадры + аудио) ───────
interface Classification {
  branch: number;
  has_voice: boolean;
  has_subtitles: boolean;
  has_text_overlay: boolean;
  language: string;
  text_content: string;
  confidence: number;
}

const CLASSIFY_PROMPT = `Ты — классификатор коротких вертикальных видео для конвейера обработки.
Тебе дают несколько кадров (раскадровку) и аудиодорожку одного ролика.
Определи три признака:
1. has_voice — есть ли в аудио человеческая речь (voice). Музыка/тишина без речи = false.
2. has_subtitles — есть ли «выжженные» субтитры: динамически меняющийся текст,
   синхронизированный с речью (обычно внизу кадра, идёт фразами).
3. has_text_overlay — статические/полустатические текстовые плашки, заголовки, CTA,
   которые НЕ являются субтитрами.
Выбери ветку (branch):
- 1: has_subtitles=false и has_voice=false.
- 2: has_subtitles=true и has_voice=true.
- 3: has_subtitles=false, has_voice=true, has_text_overlay=false.
- 4: has_text_overlay=true и has_voice=false.
- 5: has_text_overlay=true и has_voice=true.
Также верни: language (ISO-639-1 основного языка речи/текста, либо "unknown"),
text_content (распознанный текст плашки, если есть, иначе ""), confidence (0.0..1.0).
Ответь СТРОГО одним JSON-объектом без markdown по схеме:
{"branch":<1-5>,"has_voice":<bool>,"has_subtitles":<bool>,"has_text_overlay":<bool>,"language":"<code>","text_content":"<str>","confidence":<float>}`;

// Извлечение N равномерных кадров (для распознавания текста/субтитров/плашек).
function extractFrames(src: string, count: number, dir: string): Promise<string[]> {
  return new Promise((resolve) => {
    const names: string[] = [];
    ffmpeg(src)
      .on('filenames', (fns: string[]) => fns.forEach((f) => names.push(path.join(dir, f))))
      .on('end', () => resolve(names))
      .on('error', () => resolve([]))
      .screenshots({ count, folder: dir, filename: 'frame_%i.jpg', size: '512x?' });
  });
}

// Извлечение аудиодорожки (моно, обрезка до maxSec) для детекции голоса.
function extractAudio(src: string, out: string, maxSec: number): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg(src)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .duration(maxSec)
      .format('mp3')
      .output(out)
      .on('end', () => resolve(true))
      .on('error', () => resolve(false))
      .run();
  });
}

// Вычисление ветки из признаков — подстраховка, если модель не вернула branch.
function deriveBranch(d: Partial<Classification>): number {
  const voice = !!d.has_voice;
  const subs = !!d.has_subtitles;
  const plate = !!d.has_text_overlay;
  if (plate && voice) return 5;
  if (plate && !voice) return 4;
  if (subs && voice) return 2;
  if (voice) return 3;
  return 1;
}

// Анализ видео через OpenRouter (OpenAI-совместимый API). Шлёт кадры + аудио.
async function analyze(
  video: string,
  apiKey: string,
  model: string,
  hasAudio: boolean
): Promise<Classification | { error: string }> {
  const work = path.join(os.tmpdir(), `funnel_an_${Math.random().toString(36).slice(2, 10)}`);
  fs.mkdirSync(work, { recursive: true });
  const audioPath = path.join(work, 'audio.mp3');
  const cleanup = () => fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});

  try {
    const frames = await extractFrames(video, 8, work);
    if (cancelled) return { error: 'отменено' };
    if (!frames.length) return { error: 'Не удалось извлечь кадры из видео' };
    const audioOk = hasAudio ? await extractAudio(video, audioPath, 90) : false;
    if (cancelled) return { error: 'отменено' };

    // Сборка мультимодального сообщения: текст + кадры + (опц.) аудио.
    const content: Record<string, unknown>[] = [{ type: 'text', text: CLASSIFY_PROMPT }];
    for (const f of frames) {
      const b64 = fs.readFileSync(f).toString('base64');
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } });
    }
    if (audioOk) {
      const ab64 = fs.readFileSync(audioPath).toString('base64');
      content.push({ type: 'input_audio', input_audio: { data: ab64, format: 'mp3' } });
    } else {
      content.push({ type: 'text', text: 'Аудиодорожка отсутствует — считай has_voice=false.' });
    }

    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    // Запрос к OpenRouter с одной повторной попыткой при сетевом сбое.
    let resp: Response | null = null;
    let netErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (cancelled) return { error: 'отменено' };
      const controller = new AbortController();
      activeAborts.add(controller);
      try {
        resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://beatleap.local',
            'X-Title': 'Beatleap Atom Funnel',
          },
          body,
          signal: controller.signal,
        });
        break;
      } catch (fe) {
        // undici прячет реальную причину в .cause — раскрываем её.
        const cause = (fe as { cause?: unknown })?.cause;
        const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : '';
        netErr = `${fe instanceof Error ? fe.message : String(fe)}${causeMsg ? ` (${causeMsg})` : ''}`;
      } finally {
        activeAborts.delete(controller);
      }
    }
    if (!resp) return { error: `Сеть OpenRouter недоступна: ${netErr}. Проверьте интернет/прокси/VPN.` };

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { error: `OpenRouter ${resp.status}: ${t.slice(0, 200)}` };
    }
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    let raw = (data.choices?.[0]?.message?.content || '').trim();
    if (raw.startsWith('```')) raw = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
    if (!raw.startsWith('{')) raw = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(raw) as Partial<Classification>;
    const branch = [1, 2, 3, 4, 5].includes(parsed.branch as number) ? (parsed.branch as number) : deriveBranch(parsed);
    return {
      branch,
      has_voice: !!parsed.has_voice,
      has_subtitles: !!parsed.has_subtitles,
      has_text_overlay: !!parsed.has_text_overlay,
      language: String(parsed.language || 'unknown'),
      text_content: String(parsed.text_content || ''),
      confidence: Number(parsed.confidence || 0),
    };
  } catch (e) {
    if (cancelled) return { error: 'отменено' };
    const cause = (e as { cause?: unknown })?.cause;
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : '';
    const msg = e instanceof Error ? e.message : String(e);
    return { error: causeMsg ? `${msg} (${causeMsg})` : msg };
  } finally {
    cleanup();
  }
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

  const { height, hasAudio } = await probe(src);

  // AI-классификация (OpenRouter).
  emit({ stage: 'analyzing', percent: 12, stageLabel: 'AI-анализ (OpenRouter)…' });
  const cls = await analyze(src, apiKey, req.model || 'google/gemini-3.5-flash', hasAudio);
  if (cancelled) return;
  if ('error' in cls) {
    emit({ stage: 'error', percent: 0, error: cls.error });
    return;
  }
  emit({ stage: 'processing', percent: 15, branch: cls.branch, stageLabel: `Ветка ${cls.branch}` });

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

    const apiKey = getOpenRouterKey();
    if (!apiKey) return { error: 'Не задан ключ OpenRouter API (Настройки). Он нужен для AI-классификации.' };
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
    const dl = await runDownload(req.url.trim(), dlDir, (r) =>
      send(win, {
        id: 'download',
        stage: 'downloading',
        percent: r.percent != null ? Math.max(2, Math.round(r.percent * 0.1)) : undefined,
        stageLabel: r.label,
      })
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
    for (const proc of activeProc) killTree(proc);
    activeProc.clear();
    for (const ac of activeAborts) {
      try {
        ac.abort();
      } catch {
        /* noop */
      }
    }
    activeAborts.clear();
    return { ok: true };
  });
}
