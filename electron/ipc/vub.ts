import { BrowserWindow, ipcMain } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVubPlan } from '../../src/vub/ffmpegBuild';
import { buildAss } from '../../src/vub/assBuilder';
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
  send: (status: 'processing' | 'done' | 'error', percent: number, error?: string) => void
): Promise<void> {
  const video = task.video;
  const { duration, hasAudio, width, height } = await probe(video.path);
  if (cancelled) return;

  // Каждая вариация — свой набор значений, распределённый по диапазонам (§ вариации).
  const plan = buildVubPlan(req.params, req.effects, req.text, req.cleanMetadata, task.index, task.total);
  const out = path.join(req.outputDir, task.outName);

  // --- Авто-титры (транскрибация речи -> .ass) ---
  let assPath: string | null = null;
  const apiKey = getAssemblyKey();
  if (req.titles?.enabled && apiKey && hasAudio) {
    try {
      const words = await getWords(video.path, apiKey, req.titles.language);
      if (cancelled) return;
      if (words.length) {
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
      console.warn('VUB titles failed:', e);
    }
  }
  const assFilter = assPath
    ? `ass=filename=${escFilterPath(assPath)}` +
      (process.platform === 'win32' ? ':fontsdir=C\\:/Windows/Fonts' : '')
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
        send('done', 100);
        resolve();
      })
      .on('error', (err) => {
        active.delete(cmd);
        cleanup();
        if (!cancelled) send('error', 0, err.message);
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

    // Разворачиваем очередь: каждое видео -> N уникальных вариаций.
    const variations = Math.max(1, req.variations || 1);
    const tasks: VubTask[] = [];
    for (const video of req.videos) {
      const base = path.parse(video.name).name;
      for (let i = 0; i < variations; i++) {
        tasks.push({
          id: variations > 1 ? `${video.id}#${i}` : video.id,
          video,
          outName: variations > 1 ? `${base}_unique_${i + 1}.mp4` : `${base}_unique.mp4`,
          index: i,
          total: variations,
        });
      }
    }

    await runPool(tasks, req.threads, (task) =>
      processOne(task, req, (status, percent, error) => emit(task.id, status, percent, error))
    );
    return { ok: true };
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
