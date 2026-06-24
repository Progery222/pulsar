import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: string;
  conf?: number;
}
interface DetectResult {
  width: number;
  height: number;
  duration: number;
  boxes: Box[];
  error?: string;
}

export interface CleanerVideo {
  id: string;
  path: string;
  name: string;
}
export interface CleanerRequest {
  videos: CleanerVideo[];
  detectTitles: boolean;
  detectWatermarks: boolean;
  coverMethod: 'delogo' | 'blur' | 'box';
  boxColor: string;
  minConf: number;
  outputDir: string;
}

let cancelled = false;
const active = new Set<ffmpeg.FfmpegCommand>();

function pythonScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'detect_overlays.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'detect_overlays.py');
}

// Запуск Python-детектора, парсинг JSON.
function detect(videoPath: string): Promise<DetectResult> {
  return new Promise((resolve) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(py, [pythonScript(), videoPath]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ width: 0, height: 0, duration: 0, boxes: [], error: 'detect timeout' });
    }, 120000);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ width: 0, height: 0, duration: 0, boxes: [], error: e.message });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ width: 0, height: 0, duration: 0, boxes: [], error: err.trim() || 'bad detector output' });
      }
    });
  });
}

function color6(hex: string): string {
  const h = hex.replace('#', '');
  return `0x${h.slice(0, 6)}`;
}

// Строит фильтр перекрытия по боксам (нормированные 0..1 -> пиксели).
function buildCover(
  boxes: Box[],
  W: number,
  H: number,
  method: CleanerRequest['coverMethod'],
  boxColor: string
): { vf?: string; complex?: string } {
  const px = boxes
    .map((b) => {
      let x = Math.max(1, Math.round(b.x * W));
      let y = Math.max(1, Math.round(b.y * H));
      let w = Math.round(b.w * W);
      let h = Math.round(b.h * H);
      if (x + w > W - 1) w = W - 1 - x;
      if (y + h > H - 1) h = H - 1 - y;
      return { x, y, w, h };
    })
    .filter((b) => b.w > 4 && b.h > 4);

  if (!px.length) return {};

  if (method === 'box') {
    const col = color6(boxColor);
    return { vf: px.map((b) => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${col}@1:t=fill`).join(',') };
  }
  if (method === 'delogo') {
    return { vf: px.map((b) => `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}`).join(',') };
  }
  // blur: split -> crop+gblur каждой зоны -> последовательные overlay
  const n = px.length;
  const parts: string[] = [];
  parts.push(`[0:v]split=${n + 1}[main]${px.map((_, i) => `[s${i}]`).join('')}`);
  px.forEach((b, i) => {
    parts.push(`[s${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},gblur=sigma=14[b${i}]`);
  });
  let label = 'main';
  px.forEach((b, i) => {
    const next = i === n - 1 ? 'outv' : `m${i}`;
    parts.push(`[${label}][b${i}]overlay=${b.x}:${b.y}[${next}]`);
    label = next;
  });
  return { complex: parts.join(';') };
}

function probe(file: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (e, data) => {
      const v = (data?.streams ?? []).find((s) => s.codec_type === 'video');
      resolve({ w: v?.width ?? 0, h: v?.height ?? 0 });
    });
  });
}

const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);

async function processOne(
  video: CleanerVideo,
  req: CleanerRequest,
  send: (status: string, percent: number, info?: string) => void
): Promise<void> {
  send('detecting', 3);
  const det = await detect(video.path);
  if (cancelled) return;
  if (det.error) {
    send('error', 0, det.error);
    return;
  }
  const { w: W, h: H } = det.width ? { w: det.width, h: det.height } : await probe(video.path);
  const boxes = (det.boxes || []).filter((b) => (b.conf ?? 1) >= req.minConf);
  send('processing', 10, `зон: ${boxes.length}`);

  const cover = buildCover(boxes, W, H, req.coverMethod, req.boxColor);

  const finalOut = path.join(req.outputDir, `${path.parse(video.name).name}_clean.mp4`);
  const stageDir = isAscii(path.dirname(finalOut)) ? path.dirname(finalOut) : os.tmpdir();
  const out = isAscii(finalOut) ? finalOut : path.join(stageDir, `cl_${Math.random().toString(36).slice(2, 10)}.mp4`);
  const staged = out !== finalOut;

  const cmd = ffmpeg(video.path).addInputOption('-nostdin');
  if (cover.complex) cmd.complexFilter(cover.complex, ['outv']);
  else if (cover.vf) cmd.videoFilters(cover.vf);

  cmd
    .outputOptions('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
    .outputOptions('-movflags', '+faststart')
    .output(out);

  await new Promise<void>((resolve) => {
    cmd
      .on('progress', (p) => send('processing', Math.min(99, Math.max(11, p.percent || 11))))
      .on('end', async () => {
        active.delete(cmd);
        if (staged) {
          await fs.promises.rm(finalOut, { force: true }).catch(() => {});
          await fs.promises.rename(out, finalOut).catch(async () => {
            await fs.promises.copyFile(out, finalOut);
            await fs.promises.unlink(out).catch(() => {});
          });
        }
        send('done', 100, `зон: ${boxes.length}`);
        resolve();
      })
      .on('error', (e) => {
        active.delete(cmd);
        if (staged) fs.promises.unlink(out).catch(() => {});
        if (!cancelled) send('error', 0, e.message);
        resolve();
      });
    active.add(cmd);
    cmd.run();
  });
}

export function registerCleanerHandlers() {
  ipcMain.handle('cleaner:process', async (event, req: CleanerRequest) => {
    cancelled = false;
    const sender = BrowserWindow.fromWebContents(event.sender);
    for (const v of req.videos) {
      if (cancelled) break;
      await processOne(v, req, (status, percent, info) =>
        sender?.webContents.send('cleaner-progress', { id: v.id, status, percent, info })
      );
    }
    return { ok: true };
  });

  ipcMain.handle('cleaner:cancel', () => {
    cancelled = true;
    for (const c of active) {
      try {
        c.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
    active.clear();
    return { ok: true };
  });
}
