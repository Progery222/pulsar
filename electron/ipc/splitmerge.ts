import { ipcMain } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILTERS } from '../../src/data/filters';

// Модуль «Сплит-монтаж»: вертикальный кадр из 2 ячеек — сверху хуки (короткие 2-4с,
// склеиваются на всю длину), снизу эмоция (N секунд). Пер-ячейка эффекты. Экспорт N
// уникальных вариаций (рандомные исходники из папок). Собирается ffmpeg (vstack).

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
const ffprobeBin = (ffprobeStatic as unknown as { path: string })?.path?.replace('app.asar', 'app.asar.unpacked');

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const FORMATS: Record<string, [number, number]> = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] };

export interface CellFx {
  sharpen: number; // 0..2
  noise: number; // 0..40
  brightness: number; // -0.3..0.3
  contrast: number; // -0.5..0.5 (0 = нейтрально)
  saturation: number; // -1..1 (0 = нейтрально)
  filter: string | null; // ключ пресета из FILTERS
}

let cancelled = false;

function scan(folder: string): string[] {
  try {
    return fs.readdirSync(folder).filter((n) => VIDEO_EXT.test(n)).map((n) => path.join(folder, n));
  } catch {
    return [];
  }
}
function ff(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let err = '';
    const ch = spawn(ffmpegBin, args, { windowsHide: true });
    ch.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-1500)));
    ch.on('error', reject);
    ch.on('close', (code) => {
      if (code === 0) return resolve();
      console.error('[split] ffmpeg failed:', args.join(' '), '\n', err.slice(-600));
      reject(new Error(err.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ') || `ffmpeg ${code}`));
    });
  });
}
function probeDur(file: string): Promise<number> {
  return new Promise((resolve) => {
    if (!ffprobeBin) return resolve(0);
    const ch = spawn(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
    ch.on('close', () => resolve(Number(out.trim()) || 0));
    ch.on('error', () => resolve(0));
  });
}
function hasAudio(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ffprobeBin) return resolve(true);
    const ch = spawn(ffprobeBin, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
    ch.on('close', () => resolve(out.trim().length > 0));
    ch.on('error', () => resolve(true));
  });
}
function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function fxChain(fx: CellFx | undefined): string {
  if (!fx) return '';
  const p: string[] = [];
  if (fx.sharpen > 0) p.push(`unsharp=5:5:${Math.min(3, Math.max(0, fx.sharpen)).toFixed(3)}:5:5:0`);
  const eq: string[] = [];
  if (fx.brightness) eq.push(`brightness=${Number(fx.brightness).toFixed(3)}`);
  if (fx.contrast) eq.push(`contrast=${(1 + Number(fx.contrast)).toFixed(3)}`);
  if (fx.saturation) eq.push(`saturation=${(1 + Number(fx.saturation)).toFixed(3)}`);
  if (eq.length) p.push(`eq=${eq.join(':')}`);
  if (fx.noise > 0) p.push(`noise=alls=${Math.round(fx.noise)}:allf=t`);
  if (fx.filter) {
    const m = FILTERS.find((f) => f.key === fx.filter);
    if (m?.ffmpeg) p.push(m.ffmpeg);
  }
  return p.join(',');
}

// Набор хуков, чья суммарная длина ≥ D (заполняют всю ячейку сверху).
async function pickHooksToFill(files: string[], D: number): Promise<string[]> {
  const shuffled = shuffle(files);
  const picked: string[] = [];
  let sum = 0;
  for (const f of shuffled) {
    const d = await probeDur(f);
    if (d <= 0.2) continue;
    picked.push(f);
    sum += d;
    if (sum >= D) break;
  }
  // Хуков мало — повторяем по кругу, пока не заполнится.
  let i = 0;
  while (sum < D && picked.length && i < 400) {
    const f = shuffled[i % shuffled.length] || picked[0];
    const d = (await probeDur(f)) || 3;
    picked.push(f);
    sum += d;
    i++;
  }
  return picked;
}

export function registerSplitMergeHandlers() {
  ipcMain.handle('split:scanFolder', (_e, folder: string) => scan(folder));
  ipcMain.handle('split:cancel', () => { cancelled = true; return { ok: true }; });

  ipcMain.handle('split:generate', async (e, req: {
    topFolder: string; bottomFolder: string; duration: number; format: string;
    variations: number; audio: 'bottom' | 'none'; topFx: CellFx; bottomFx: CellFx; outputDir: string;
  }) => {
    cancelled = false;
    if (!ffmpegBin) return { error: 'ffmpeg не найден' };
    const [W, H] = FORMATS[req.format] ?? FORMATS['9:16'];
    const Hc = Math.round(H / 4) * 2; // половина высоты, чётная
    const topFiles = scan(req.topFolder);
    const botFiles = scan(req.bottomFolder);
    if (!topFiles.length) return { error: 'В верхней папке (хуки) нет видео' };
    if (!botFiles.length) return { error: 'В нижней папке (эмоции) нет видео' };
    const D = Math.max(2, Number(req.duration) || 10);
    const emit = (stage: string, percent: number) => e.sender.send('split:progress', { stage, percent });
    const cover = `scale=${W}:${Hc}:force_original_aspect_ratio=increase,crop=${W}:${Hc},setsar=1,fps=30`;
    const botFx = fxChain(req.bottomFx);
    const topFx = fxChain(req.topFx);
    const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
    const made: string[] = [];

    try {
      const N = Math.max(1, Math.min(100, Number(req.variations) || 1));
      for (let v = 0; v < N; v++) {
        if (cancelled) break;
        emit(`Вариация ${v + 1}/${N}`, Math.round((v / N) * 100));
        const bottom = botFiles[Math.floor(Math.random() * botFiles.length)];
        const hooks = await pickHooksToFill(topFiles, D);
        if (!hooks.length) continue;

        const inputs: string[] = ['-stream_loop', '-1', '-i', bottom];
        hooks.forEach((h) => inputs.push('-i', h));
        const fc: string[] = [];
        fc.push(`[0:v]${cover}${botFx ? ',' + botFx : ''},trim=0:${D},setpts=PTS-STARTPTS[bot]`);
        hooks.forEach((_, i) => fc.push(`[${i + 1}:v]${cover}[h${i}]`));
        fc.push(`${hooks.map((_, i) => `[h${i}]`).join('')}concat=n=${hooks.length}:v=1:a=0[tcat]`);
        fc.push(`[tcat]${topFx ? topFx + ',' : ''}trim=0:${D},setpts=PTS-STARTPTS[top]`);
        fc.push(`[top][bot]vstack=inputs=2[v]`);
        let amap: string | null = null;
        if (req.audio === 'bottom' && (await hasAudio(bottom))) {
          fc.push(`[0:a]atrim=0:${D},asetpts=PTS-STARTPTS[a]`);
          amap = '[a]';
        }

        const finalOut = path.join(req.outputDir, `split_${Date.now()}_${v + 1}.mp4`);
        // ffmpeg на Windows не открывает не-ASCII выходной путь — рендерим в temp ASCII, потом move.
        const staged = !isAscii(finalOut);
        const out = staged ? path.join(os.tmpdir(), `split_${Math.random().toString(36).slice(2, 10)}.mp4`) : finalOut;

        const args = ['-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[v]'];
        if (amap) args.push('-map', amap, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2');
        else args.push('-an');
        args.push('-t', String(D), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
        await ff(args);

        if (staged) {
          await fs.promises.rm(finalOut, { force: true }).catch(() => {});
          await fs.promises.rename(out, finalOut).catch(async () => {
            await fs.promises.copyFile(out, finalOut);
            await fs.promises.unlink(out).catch(() => {});
          });
        }
        made.push(finalOut);
      }
      emit('Готово', 100);
      return { ok: true as const, count: made.length, dir: req.outputDir };
    } catch (err) {
      console.error('[split] generate failed:', err);
      return { error: (err as Error).message };
    }
  });
}
