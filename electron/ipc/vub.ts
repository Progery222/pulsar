import { BrowserWindow, ipcMain } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'node:path';
import { buildVubPlan } from '../../src/vub/ffmpegBuild';
import type { VubProcessRequest, VubVideo } from '../../src/vub/types';

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

function probe(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err || !data) {
        resolve({ duration: 0, hasAudio: false });
        return;
      }
      const duration = data.format?.duration ?? 0;
      const hasAudio = (data.streams ?? []).some((s) => s.codec_type === 'audio');
      resolve({ duration, hasAudio });
    });
  });
}

function processOne(
  task: VubTask,
  req: VubProcessRequest,
  send: (status: 'processing' | 'done' | 'error', percent: number, error?: string) => void
): Promise<void> {
  const video = task.video;
  return new Promise((resolve) => {
    probe(video.path).then(({ duration, hasAudio }) => {
      if (cancelled) {
        resolve();
        return;
      }
      // Каждая вариация — свой набор значений, распределённый по диапазонам (§ вариации).
      const plan = buildVubPlan(req.params, req.effects, req.text, req.cleanMetadata, task.index, task.total);
      const out = path.join(req.outputDir, task.outName);

      const cmd = ffmpeg(video.path).addInputOption('-nostdin');

      // Водяной знак: накладываем в случайную из заданных зон.
      const wm = req.watermark;
      const useWatermark = !!wm.file && wm.zones.length > 0;
      if (useWatermark && wm.file) {
        cmd.input(wm.file);
        const z = wm.zones[Math.floor(Math.random() * wm.zones.length)];
        const vfChain = plan.videoFilters.length ? plan.videoFilters.join(',') : 'null';
        const complex =
          `[0:v]${vfChain}[base];` +
          `[1:v]scale=iw*${z.w.toFixed(3)}:-1[wm];` +
          `[base][wm]overlay=W*${z.x.toFixed(3)}:H*${z.y.toFixed(3)}[v]`;
        cmd.complexFilter(complex, ['v']);
      } else if (plan.videoFilters.length) {
        cmd.videoFilters(plan.videoFilters.join(','));
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
          send('done', 100);
          resolve();
        })
        .on('error', (err) => {
          active.delete(cmd);
          if (!cancelled) send('error', 0, err.message);
          resolve();
        });

      active.add(cmd);
      cmd.run();
    });
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
