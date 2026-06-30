import { app, BrowserWindow, ipcMain } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVubPlan, upscaleDims } from '../../src/vub/ffmpegBuild';
import { buildAss } from '../../src/vub/assBuilder';
import { outFileName, dedupeNames } from '../../src/vub/naming';
import type { TranscriptWord, VubProcessRequest, VubVideo } from '../../src/vub/types';
import { transcribe } from './transcribe';
import { getAssemblyKey } from './config';
import { videoEncoderOptions } from './encoder';

// Одна задача очереди = конкретная вариация конкретного видео.
interface VubTask {
  id: string; // уникальный id строки прогресса (videoId#index)
  video: VubVideo;
  outName: string; // имя выходного файла
  index: number; // номер вариации (0-based)
  total: number; // всего вариаций на это видео
  globalIndex: number; // сквозной номер по всей очереди (для разных хуков у разных видео)
}

// Bundled FFmpeg (распаковка из asar в упакованном приложении).
const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

let cancelled = false;
const active = new Set<ffmpeg.FfmpegCommand>();

// Состояние watch-папки (авто-обработка новых видео).
let watcher: fs.FSWatcher | null = null;
const watchSeen = new Set<string>();
const watchQueue: string[] = [];
let watchProcessing = false;

// Кэш транскрибаций: один исходник распознаётся один раз, все вариации переиспользуют.
const transcriptCache = new Map<string, Promise<TranscriptWord[]>>();

function getWords(videoPath: string, key: string, lang: string): Promise<TranscriptWord[]> {
  const ck = `${videoPath}::${lang}`;
  let pr = transcriptCache.get(ck);
  if (!pr) {
    pr = transcribe(videoPath, key, lang).catch((e) => {
      console.warn('VUB transcribe failed:', e);
      return [] as TranscriptWord[];
    });
    transcriptCache.set(ck, pr);
  }
  return pr;
}

// Экранирование пути для строки фильтра ffmpeg (Windows: D:\ -> D\:/).
function escFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// Папка со встроенными шрифтами титров (dev vs упакованное приложение).
function fontsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'fonts')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'assets', 'fonts');
}

// Резолв относительного пути ассета (assets/emoji/...) от корня приложения/ресурсов.
// Нужен для эмодзи-заготовок водяного знака, которые задаются относительным путём.
function resolveAsset(p: string): string {
  if (path.isAbsolute(p)) return p;
  const base = app.isPackaged ? process.resourcesPath : (process.env.APP_ROOT ?? process.cwd());
  return path.join(base, p);
}

interface ProbeResult {
  duration: number;
  hasAudio: boolean;
  width: number;
  height: number;
  sampleRate: number;
}

function probe(file: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err || !data) {
        resolve({ duration: 0, hasAudio: false, width: 0, height: 0, sampleRate: 44100 });
        return;
      }
      const streams = data.streams ?? [];
      const v = streams.find((s) => s.codec_type === 'video');
      const a = streams.find((s) => s.codec_type === 'audio');
      resolve({
        duration: data.format?.duration ?? 0,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        width: v?.width ?? 0,
        height: v?.height ?? 0,
        sampleRate: Number(a?.sample_rate) || 44100,
      });
    });
  });
}

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;

// Список видеофайлов в папке (для хуков), в случайном порядке.
function scanVideos(folder: string): string[] {
  try {
    const files = fs.readdirSync(folder).filter((n) => VIDEO_EXT.test(n)).map((n) => path.join(folder, n));
    // Перемешиваем (Фишер–Йейтс), чтобы порядок хуков был случайным.
    for (let i = files.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
    return files;
  } catch {
    return [];
  }
}

// Нормализация аудио под concat (одинаковые SR/формат/каналы у всех сегментов).
const A_NORM = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';

// Запуск ffmpeg-команды с захватом stderr — чтобы при ошибке вернуть понятную причину.
function runFf(cmd: ffmpeg.FfmpegCommand, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let tail = '';
    cmd.on('stderr', (l: string) => {
      tail = (tail + '\n' + l).slice(-800);
    });
    cmd.on('end', () => {
      active.delete(cmd);
      resolve();
    });
    cmd.on('error', (e) => {
      active.delete(cmd);
      const last = tail.trim().split('\n').filter(Boolean).pop() ?? '';
      reject(new Error(`${e.message || 'ffmpeg error'}${last ? ` | ${last}` : ''}`));
    });
    active.add(cmd);
    cmd.output(dest).run();
  });
}

// Нормализация клипа к WxH/30fps/yuv420p + aac 44100 stereo (тишина, если нет звука).
// Простой одно-входовый ре-энкод — куда надёжнее «скрейп»-видео, чем сложный concat-граф.
async function normalizeClip(src: string, dest: string, W: number, H: number): Promise<void> {
  const info = await probe(src);
  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 22 });
  const cmd = ffmpeg(src).addInputOption('-nostdin');
  const fc = [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v]`];
  const oo = ['-map', '[v]'];
  if (info.hasAudio) {
    fc.push(`[0:a]${A_NORM}[a]`);
  } else {
    cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputOptions(['-f', 'lavfi', '-t', String(Math.max(0.3, info.duration || 2))]);
    fc.push(`[1:a]${A_NORM}[a]`);
  }
  oo.push('-map', '[a]');
  cmd.complexFilter(fc, ['v', 'a']).outputOptions([...oo, ...venc, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2']);
  await runFf(cmd, dest);
}

// Склейка: хук в начало, затем основное видео (body).
// Хук сначала нормализуется отдельно (надёжный декод), потом конкат hookN + body.
async function prependHook(hookFile: string, body: string, dest: string): Promise<void> {
  const b = await probe(body);
  const W = b.width || 1080;
  const H = b.height || 1920;
  const hookN = `${dest}.hk.mp4`;
  try {
    // 1) Чистая нормализация хука (изолирует проблемы декода).
    await normalizeClip(hookFile, hookN, W, H).catch((e) => {
      throw new Error(`нормализация хука: ${e instanceof Error ? e.message : e}`);
    });

    // 2) Конкат: hookN (всегда WxH/30/aac) + body.
    const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 22 });
    const cmd = ffmpeg(hookN).addInputOption('-nostdin').input(body);
    const vnorm = (idx: number, label: string) =>
      `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[${label}]`;
    const fc: string[] = [vnorm(0, 'hv'), vnorm(1, 'bv'), '[hv][bv]concat=n=2:v=1:a=0[v]'];
    const aLabels: string[] = ['[a0]'];
    fc.push(`[0:a]${A_NORM}[a0]`); // hookN гарантированно имеет аудио
    if (b.hasAudio) {
      fc.push(`[1:a]${A_NORM}[a1]`);
    } else {
      cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputOptions(['-f', 'lavfi', '-t', String(Math.max(0.1, b.duration || 1))]);
      fc.push(`[2:a]${A_NORM}[a1]`);
    }
    aLabels.push('[a1]');
    fc.push(`${aLabels.join('')}concat=n=2:v=0:a=1[a]`);
    cmd.complexFilter(fc, ['v', 'a']).outputOptions([...venc, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']);
    await runFf(cmd, dest);
  } finally {
    await fs.promises.unlink(hookN).catch(() => {});
  }
}

// Склейка-шаблон: тело режется в N случайных точках, между сегментами вставляются
// клипы. Всё приводится к WxH/fps/sar тела; отсутствующее аудио заменяется тишиной.
async function applyTemplate(body: string, clips: string[], dest: string): Promise<void> {
  const b = await probe(body);
  const W = b.width || 1080;
  const H = b.height || 1920;
  const dur = b.duration || 0;
  if (!clips.length || dur < 2) {
    await fs.promises.copyFile(body, dest);
    return;
  }
  const N = clips.length;
  const segCount = N + 1;

  // Случайные точки вставки (с отступом от краёв), отсортированы.
  const pts: number[] = [];
  for (let i = 0; i < N; i++) pts.push(0.4 + Math.random() * Math.max(0.5, dur - 0.8));
  pts.sort((a, b2) => a - b2);
  const bounds = [0, ...pts, dur];

  const info: ProbeResult[] = [];
  for (const c of clips) info.push(await probe(c));

  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 22 });
  const vNorm = (label: string) =>
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[${label}]`;

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(body).addInputOption('-nostdin');
    clips.forEach((c) => cmd.input(c));
    let nextIdx = 1 + N; // следующий свободный индекс для lavfi-тишины
    const fc: string[] = [];

    // Видео тела -> split -> trim сегментов.
    const sv = Array.from({ length: segCount }, (_, i) => `sv${i}`);
    fc.push(`[0:v]split=${segCount}${sv.map((l) => `[${l}]`).join('')}`);
    const vParts: string[] = [];
    for (let i = 0; i < segCount; i++) {
      const lbl = `vp${i}`;
      fc.push(`[${sv[i]}]trim=${bounds[i].toFixed(3)}:${bounds[i + 1].toFixed(3)},setpts=PTS-STARTPTS,${vNorm(lbl)}`);
      vParts.push(lbl);
    }
    // Видео клипов.
    const clipV: string[] = [];
    for (let i = 0; i < N; i++) {
      const lbl = `cv${i}`;
      fc.push(`[${i + 1}:v]${vNorm(lbl)}`);
      clipV.push(lbl);
    }

    // Аудио тела (или тишина, если у тела нет звука).
    const segA: string[] = [];
    if (b.hasAudio) {
      const sa = Array.from({ length: segCount }, (_, i) => `sa${i}`);
      fc.push(`[0:a]asplit=${segCount}${sa.map((l) => `[${l}]`).join('')}`);
      for (let i = 0; i < segCount; i++) {
        const lbl = `ap${i}`;
        fc.push(`[${sa[i]}]atrim=${bounds[i].toFixed(3)}:${bounds[i + 1].toFixed(3)},asetpts=PTS-STARTPTS,${A_NORM}[${lbl}]`);
        segA.push(lbl);
      }
    } else {
      for (let i = 0; i < segCount; i++) {
        const lbl = `ap${i}`;
        cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputOptions(['-f', 'lavfi', '-t', (bounds[i + 1] - bounds[i]).toFixed(3)]);
        fc.push(`[${nextIdx}:a]${A_NORM}[${lbl}]`);
        nextIdx++;
        segA.push(lbl);
      }
    }
    // Аудио клипов (или тишина их длины).
    const clipA: string[] = [];
    for (let i = 0; i < N; i++) {
      const lbl = `ca${i}`;
      if (info[i].hasAudio) {
        fc.push(`[${i + 1}:a]${A_NORM}[${lbl}]`);
      } else {
        cmd.input('anullsrc=channel_layout=stereo:sample_rate=44100').inputOptions(['-f', 'lavfi', '-t', Math.max(0.1, info[i].duration || 1).toFixed(3)]);
        fc.push(`[${nextIdx}:a]${A_NORM}[${lbl}]`);
        nextIdx++;
      }
      clipA.push(lbl);
    }

    // Чередование: сегмент, клип, сегмент, клип, …, сегмент.
    const order: string[] = [];
    for (let i = 0; i < segCount; i++) {
      order.push(`[${vParts[i]}][${segA[i]}]`);
      if (i < N) order.push(`[${clipV[i]}][${clipA[i]}]`);
    }
    const total = segCount + N;
    fc.push(`${order.join('')}concat=n=${total}:v=1:a=1[v][a]`);

    cmd
      .complexFilter(fc, ['v', 'a'])
      .outputOptions([...venc, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'])
      .output(dest)
      .on('end', () => {
        active.delete(cmd);
        resolve();
      })
      .on('error', (e) => {
        active.delete(cmd);
        reject(e);
      });
    active.add(cmd);
    cmd.run();
  });
}

async function processOne(
  task: VubTask,
  req: VubProcessRequest,
  hookFiles: string[],
  templateFiles: string[],
  send: (status: 'processing' | 'done' | 'error', percent: number, error?: string) => void,
  warn: (msg: string) => void
): Promise<void> {
  const video = task.video;
  const { duration, hasAudio, width, height, sampleRate } = await probe(video.path);
  if (cancelled) return;

  // Каждая вариация — свой набор значений, распределённый по диапазонам (§ вариации).
  const plan = buildVubPlan(req.params, req.effects, req.text, req.cleanMetadata, task.index, task.total, req.nativeExport, sampleRate, req.hard, req.randomSubset);

  // Апскейл: повышение разрешения рендером. scale первым фильтром — последующие
  // eq/unsharp/поворот работают уже по кадру высокого разрешения. lanczos = качественная интерполяция.
  // baseW — эффективная ширина кадра (для размера водяного знака).
  let baseW = width || 1080;
  if (req.upscale?.enabled) {
    const dims = upscaleDims(width, height, req.upscale.target);
    if (dims) {
      plan.videoFilters.unshift(`scale=${dims[0]}:${dims[1]}:flags=lanczos`);
      baseW = dims[0];
    }
  }
  const finalOut = path.join(req.outputDir, task.outName);
  // ffmpeg на Windows не открывает выходной файл с не-ASCII именем (EINVAL) —
  // рендерим во временный ASCII-файл, затем переименовываем средствами Node.
  const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
  const stageDir = isAscii(path.dirname(finalOut)) ? path.dirname(finalOut) : os.tmpdir();
  const out = isAscii(finalOut)
    ? finalOut
    : path.join(stageDir, `vub_out_${Math.random().toString(36).slice(2, 10)}.mp4`);
  const staged = out !== finalOut;

  // Хук: по сквозному номеру -> разные хуки и у разных видео, и у копий одного видео.
  const hookFile = hookFiles.length ? hookFiles[task.globalIndex % hookFiles.length] : null;
  // Шаблон: случайный набор клипов для вставки (свой на каждую копию).
  const tplCount = req.template?.enabled ? Math.max(1, req.template.count || 1) : 0;
  const templateClips =
    tplCount && templateFiles.length
      ? Array.from({ length: tplCount }, () => templateFiles[Math.floor(Math.random() * templateFiles.length)])
      : [];
  // Если есть пост-обработка (хук/шаблон) — рендерим тело в temp, иначе сразу в out.
  const hasPost = !!hookFile || templateClips.length > 0;
  const bodyOut = hasPost
    ? path.join(stageDir, `vub_body_${Math.random().toString(36).slice(2, 10)}.mp4`)
    : out;

  // --- Авто-титры (транскрибация речи -> .ass) ---
  let assPath: string | null = null;
  if (req.titles?.enabled) {
    const apiKey = getAssemblyKey();
    if (!apiKey) {
      if (task.index === 0) warn('Титры: не задан API-ключ AssemblyAI (вкладка «Титры»).');
    } else if (!hasAudio) {
      if (task.index === 0) warn(`Титры: в «${video.name}» нет аудиодорожки.`);
    } else {
      try {
        const words = await getWords(video.path, apiKey, req.titles.language);
        if (cancelled) return;
        if (!words.length) {
          if (task.index === 0) warn(`Титры: речь не распознана в «${video.name}».`);
        } else {
          const ass = buildAss(words, req.titles, {
            width: width || 1080,
            height: height || 1920,
            variationIndex: task.index,
            variationTotal: task.total,
          });
          if (ass) {
            assPath = path.join(os.tmpdir(), `vub_sub_${task.index}_${Math.random().toString(36).slice(2, 8)}.ass`);
            fs.writeFileSync(assPath, ass, 'utf-8');
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('VUB titles failed:', msg);
        if (task.index === 0) warn(`Титры: ошибка распознавания — ${msg}`);
      }
    }
  }
  // Путь к .ass: одинарные кавычки + экранированное двоеточие (иначе ffmpeg режет по ':').
  // fontsdir — встроенные шрифты титров; системные libass тоже подхватывает (DirectWrite).
  const assFilter = assPath
    ? `ass=filename='${escFilterPath(assPath)}':fontsdir='${escFilterPath(fontsDir())}'`
    : null;

  const cmd = ffmpeg(video.path).addInputOption('-nostdin');

  // Водяной знак: накладываем в случайную из заданных зон. Титры (ass) — поверх всего.
  const wm = req.watermark;
  const useWatermark = !!wm.file && wm.zones.length > 0;
  if (useWatermark && wm.file) {
    cmd.input(resolveAsset(wm.file));
    const z = wm.zones[Math.floor(Math.random() * wm.zones.length)];
    const vfChain = plan.videoFilters.length ? plan.videoFilters.join(',') : 'null';
    let complex =
      `[0:v]${vfChain}[base];` +
      `[1:v]scale=${Math.round(baseW * (wm.scale || 0.14))}:-1[wm];` +
      `[base][wm]overlay=W*${z.x.toFixed(3)}:H*${z.y.toFixed(3)}`;
    complex += assFilter ? `[ov];[ov]${assFilter}[v]` : `[v]`;
    cmd.complexFilter(complex, ['v']);
  } else {
    const vfList = [...plan.videoFilters, ...(assFilter ? [assFilter] : [])];
    if (vfList.length) cmd.videoFilters(vfList.join(','));
  }

  if (hasAudio && plan.audioFilters.length) cmd.audioFilters(plan.audioFilters.join(','));

  // Метаданные: полная очистка + случайные значения (§4.8).
  if (req.cleanMetadata) {
    cmd.outputOptions('-map_metadata', '-1');
    for (const [k, v] of Object.entries(plan.metadata)) {
      cmd.outputOptions('-metadata', `${k}=${v}`);
    }
  }

  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 + Math.floor(Math.random() * 6) });
  // +use_metadata_tags обязателен, чтобы кастомные теги (com.apple.quicktime.*,
  // com.android.*) из «нативного экспорта» реально записались в контейнер.
  cmd
    .outputOptions(venc)
    .outputOptions('-movflags', '+faststart+use_metadata_tags')
    .output(bodyOut);

  const cleanup = () => {
    if (assPath) fs.promises.unlink(assPath).catch(() => {});
  };

  // Перенос временного ASCII-файла в итоговое (возможно кириллическое) имя.
  async function finalizeOutput() {
    if (!staged) return;
    await fs.promises.rm(finalOut, { force: true }).catch(() => {});
    try {
      await fs.promises.rename(out, finalOut);
    } catch {
      await fs.promises.copyFile(out, finalOut);
      await fs.promises.unlink(out).catch(() => {});
    }
  }

  // Дозапись 512–2048 случайных байт в конец файла (из движка v2): меняет хэш файла,
  // не влияя на воспроизведение. Только при включённой уникализации метаданных.
  async function appendRandomTail() {
    if (!req.cleanMetadata) return;
    const size = 512 + Math.floor(Math.random() * 1537);
    await fs.promises.appendFile(finalOut, crypto.randomBytes(size)).catch(() => {});
  }

  await new Promise<void>((resolve) => {
    cmd
      .on('start', () => send('processing', 1))
      .on('progress', (p) => {
        let percent = typeof p.percent === 'number' ? p.percent : 0;
        if ((!percent || percent <= 0) && duration > 0 && p.timemark) {
          const [h, m, s] = p.timemark.split(':').map(Number);
          percent = ((h * 3600 + m * 60 + s) / duration) * 100;
        }
        send('processing', Math.min(99, Math.max(1, percent)));
      })
      .on('end', () => {
        active.delete(cmd);
        cleanup();
        const tmp = () => path.join(stageDir, `vub_step_${Math.random().toString(36).slice(2, 10)}.mp4`);
        // Пост-обработка цепочкой: тело -> [хук] -> [шаблон] -> out. Каждый шаг
        // некритичен: при ошибке остаётся предыдущий результат.
        const runSteps = async () => {
          let cur = bodyOut;
          if (hookFile) {
            const t = tmp();
            try {
              await prependHook(hookFile, cur, t);
              await fs.promises.unlink(cur).catch(() => {});
              cur = t;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.warn('VUB hook failed:', msg);
              if (task.index === 0) warn(`Хук не применился (${path.basename(hookFile)}): ${msg.slice(0, 180)}`);
              await fs.promises.unlink(t).catch(() => {});
            }
          }
          if (templateClips.length) {
            const t = tmp();
            try {
              await applyTemplate(cur, templateClips, t);
              await fs.promises.unlink(cur).catch(() => {});
              cur = t;
            } catch (e) {
              console.warn('VUB template failed:', e instanceof Error ? e.message : e);
              if (task.index === 0) warn('Склейка из папки не применилась — сохранено без вставок.');
              await fs.promises.unlink(t).catch(() => {});
            }
          }
          if (cur !== out) {
            await fs.promises.rm(out, { force: true }).catch(() => {});
            try {
              await fs.promises.rename(cur, out);
            } catch {
              await fs.promises.copyFile(cur, out);
              await fs.promises.unlink(cur).catch(() => {});
            }
          }
        };
        runSteps()
          .then(() => finalizeOutput())
          .then(() => appendRandomTail())
          .then(() => send('done', 100))
          .catch((e) => send('error', 0, `Не удалось сохранить файл: ${e instanceof Error ? e.message : String(e)}`))
          .finally(() => resolve());
      })
      .on('error', (err) => {
        active.delete(cmd);
        cleanup();
        fs.promises.unlink(bodyOut).catch(() => {});
        if (staged) fs.promises.unlink(out).catch(() => {});
        if (!cancelled) {
          console.error('VUB ffmpeg error для', task.outName, '|ass:', assFilter, '|', err.message);
          send('error', 0, err.message);
        }
        resolve();
      });

    active.add(cmd);
    cmd.run();
  });
}

// Пул с ограничением конкурентности (без внешних зависимостей).
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length && !cancelled) {
      const i = index++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export function registerVubHandlers() {
  ipcMain.handle('vub:process', async (event, req: VubProcessRequest) => {
    cancelled = false;
    transcriptCache.clear();
    const sender = BrowserWindow.fromWebContents(event.sender);
    const emit = (id: string, status: string, percent: number, error?: string) =>
      sender?.webContents.send('vub-progress', { id, status, percent, error });
    const warned = new Set<string>();
    const warn = (msg: string) => {
      if (warned.has(msg)) return;
      warned.add(msg);
      sender?.webContents.send('vub-warning', msg);
    };

    // Хуки: сканируем папку один раз (случайный порядок). Пусто/выкл -> без хуков.
    const hookFiles = req.hooks?.enabled && req.hooks.folder ? scanVideos(req.hooks.folder) : [];
    if (req.hooks?.enabled && req.hooks.folder && !hookFiles.length) {
      warn('Хуки: в выбранной папке нет видеофайлов — хук не будет добавлен.');
    }
    // Шаблон-склейка: папка с клипами для вставки.
    const templateFiles = req.template?.enabled && req.template.folder ? scanVideos(req.template.folder) : [];
    if (req.template?.enabled && req.template.folder && !templateFiles.length) {
      warn('Склейка: в выбранной папке нет видеофайлов — вставки не будут добавлены.');
    }

    // Разворачиваем очередь: каждое видео -> N уникальных вариаций.
    const variations = Math.max(1, req.variations || 1);
    const totalFiles = req.videos.length * variations;
    const tasks: VubTask[] = [];
    let g = 0;
    for (const video of req.videos) {
      const base = path.parse(video.name).name;
      for (let i = 0; i < variations; i++) {
        tasks.push({
          id: variations > 1 ? `${video.id}#${i}` : video.id,
          video,
          outName: outFileName({
            baseName: base,
            variationIndex: i,
            variationTotal: variations,
            globalIndex: g,
            totalFiles,
            pattern: req.namePattern || '',
          }),
          index: i,
          total: variations,
          globalIndex: g,
        });
        g++;
      }
    }

    // Устраняем коллизии имён (например, все исходники названы «004»), иначе файлы
    // перезаписывают друг друга и на выходе остаётся один.
    const deduped = dedupeNames(tasks.map((t) => t.outName));
    tasks.forEach((t, i) => (t.outName = deduped[i]));

    await runPool(tasks, req.threads, (task) =>
      processOne(task, req, hookFiles, templateFiles, (status, percent, error) => emit(task.id, status, percent, error), warn)
    );
    return { ok: true };
  });

  // Тест распознавания: распознаёт первый ролик и возвращает текст или ошибку.
  ipcMain.handle('vub:testTranscribe', async (_e, videoPath: string, language: string) => {
    const key = getAssemblyKey();
    if (!key) return { error: 'Не задан API-ключ AssemblyAI.' };
    try {
      const words = await transcribe(videoPath, key, language || 'auto');
      return { ok: true, count: words.length, text: words.map((w) => w.text).join(' ').slice(0, 500) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('vub:cancel', () => {
    cancelled = true;
    for (const cmd of active) {
      try {
        cmd.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
    active.clear();
    return { ok: true };
  });

  // ── Watch-папка: авто-обработка новых видео текущими настройками ───────────────
  ipcMain.handle('vub:watchStart', async (event, req: VubProcessRequest, watchFolder: string) => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    watchSeen.clear();
    try {
      fs.readdirSync(watchFolder).forEach((n) => watchSeen.add(n)); // существующие — не трогаем, только новые
    } catch {
      return { error: 'Не удалось открыть папку наблюдения.' };
    }
    const sender = BrowserWindow.fromWebContents(event.sender);
    const hookFiles = req.hooks?.enabled && req.hooks.folder ? scanVideos(req.hooks.folder) : [];
    const templateFiles = req.template?.enabled && req.template.folder ? scanVideos(req.template.folder) : [];
    const notify = (msg: string) => sender?.webContents.send('vub-warning', msg);

    const processFile = async (full: string) => {
      const name = path.basename(full);
      const base = path.parse(name).name;
      const task: VubTask = {
        id: full,
        video: { id: full, path: full, name },
        outName: outFileName({ baseName: base, variationIndex: 0, variationTotal: 1, globalIndex: 0, totalFiles: 1, pattern: req.namePattern || '' }),
        index: 0,
        total: 1,
        globalIndex: 0,
      };
      cancelled = false;
      const emit = (status: string, percent: number, error?: string) =>
        sender?.webContents.send('vub-progress', { id: full, status, percent, error });
      sender?.webContents.send('vub-progress', { id: full, status: 'processing', percent: 1 });
      await processOne(task, req, hookFiles, templateFiles, (s, p, e) => emit(s, p, e), notify);
      notify(`Watch: обработано «${name}»`);
    };

    const pump = async () => {
      if (watchProcessing) return;
      watchProcessing = true;
      while (watchQueue.length) {
        const f = watchQueue.shift() as string;
        try {
          await processFile(f);
        } catch (e) {
          console.warn('watch process failed:', e instanceof Error ? e.message : e);
        }
      }
      watchProcessing = false;
    };

    const onNew = (name: string) => {
      if (!name || !VIDEO_EXT.test(name) || watchSeen.has(name)) return;
      watchSeen.add(name);
      const full = path.join(watchFolder, name);
      // Ждём, пока размер файла перестанет расти (копирование/докачка завершены).
      let last = -1;
      const check = () => {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          return;
        }
        if (size > 0 && size === last) {
          watchQueue.push(full);
          pump();
        } else {
          last = size;
          setTimeout(check, 1000);
        }
      };
      setTimeout(check, 1000);
    };

    watcher = fs.watch(watchFolder, (_e, name) => {
      if (name) onNew(name.toString());
    });
    notify(`Watch включён: ${watchFolder}. Новые видео будут обработаны автоматически.`);
    return { ok: true };
  });

  ipcMain.handle('vub:watchStop', () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    watchQueue.length = 0;
    return { ok: true };
  });
}
