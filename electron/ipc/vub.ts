import { app, BrowserWindow, ipcMain } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVubPlan } from '../../src/vub/ffmpegBuild';
import { buildAss } from '../../src/vub/assBuilder';
import { outFileName } from '../../src/vub/naming';
import type { TranscriptWord, VubProcessRequest, VubVideo } from '../../src/vub/types';
import { transcribe } from './transcribe';
import { getAssemblyKey } from './config';

// Одна задача очереди = конкретная вариация конкретного видео.
interface VubTask {
  id: string; // уникальный id строки прогресса (videoId#index)
  video: VubVideo;
  outName: string; // имя выходного файла
  index: number; // номер вариации (0-based)
  total: number; // всего вариаций на это видео
}

// Bundled FFmpeg (распаковка из asar в упакованном приложении).
const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

let cancelled = false;
const active = new Set<ffmpeg.FfmpegCommand>();

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

interface ProbeResult {
  duration: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

function probe(file: string): Promise<ProbeResult> {
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

async function processOne(
  task: VubTask,
  req: VubProcessRequest,
  send: (status: 'processing' | 'done' | 'error', percent: number, error?: string) => void,
  warn: (msg: string) => void
): Promise<void> {
  const video = task.video;
  const { duration, hasAudio, width, height } = await probe(video.path);
  if (cancelled) return;

  // Каждая вариация — свой набор значений, распределённый по диапазонам (§ вариации).
  const plan = buildVubPlan(req.params, req.effects, req.text, req.cleanMetadata, task.index, task.total);
  const finalOut = path.join(req.outputDir, task.outName);
  // ffmpeg на Windows не открывает выходной файл с не-ASCII именем (EINVAL) —
  // рендерим во временный ASCII-файл, затем переименовываем средствами Node.
  const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
  const stageDir = isAscii(path.dirname(finalOut)) ? path.dirname(finalOut) : os.tmpdir();
  const out = isAscii(finalOut)
    ? finalOut
    : path.join(stageDir, `vub_out_${Math.random().toString(36).slice(2, 10)}.mp4`);
  const staged = out !== finalOut;

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
    cmd.input(wm.file);
    const z = wm.zones[Math.floor(Math.random() * wm.zones.length)];
    const vfChain = plan.videoFilters.length ? plan.videoFilters.join(',') : 'null';
    let complex =
      `[0:v]${vfChain}[base];` +
      `[1:v]scale=iw*${z.w.toFixed(3)}:-1[wm];` +
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

  cmd
    .outputOptions('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(20 + Math.floor(Math.random() * 6)))
    .outputOptions('-movflags', '+faststart')
    .output(out);

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
        finalizeOutput()
          .then(() => send('done', 100))
          .catch((e) => send('error', 0, `Не удалось сохранить файл: ${e instanceof Error ? e.message : String(e)}`))
          .finally(() => resolve());
      })
      .on('error', (err) => {
        active.delete(cmd);
        cleanup();
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
        });
        g++;
      }
    }

    await runPool(tasks, req.threads, (task) =>
      processOne(task, req, (status, percent, error) => emit(task.id, status, percent, error), warn)
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
}
