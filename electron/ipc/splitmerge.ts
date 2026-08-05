import { ipcMain } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILTERS } from '../../src/data/filters';

// Модуль «Сплит-монтаж»: вертикальный кадр из 2 ячеек — сверху хуки (короткие 2-4с,
// склеиваются на всю длину), снизу эмоция (N секунд). Пер-ячейка эффекты + кадрирование
// (зум/смещение) + громкость. Экспорт N уникальных вариаций (рандомные исходники). ffmpeg (vstack).

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
  zoom: number; // 1..2.5 (кадрирование — приближение)
  offX: number; // -1..1 (сдвиг кадра по X)
  offY: number; // -1..1 (сдвиг кадра по Y)
  volume: number; // 0..2 (громкость канала)
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
    ch.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    ch.on('error', reject);
    ch.on('close', (code) => {
      if (code === 0) return resolve();
      console.error('[split] ffmpeg failed:', args.join(' '), '\n', err.slice(-800));
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
const audioCache = new Map<string, boolean>();
function hasAudio(file: string): Promise<boolean> {
  if (audioCache.has(file)) return Promise.resolve(audioCache.get(file)!);
  return new Promise((resolve) => {
    if (!ffprobeBin) return resolve(true);
    const ch = spawn(ffprobeBin, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
    ch.on('close', () => { const has = out.trim().length > 0; audioCache.set(file, has); resolve(has); });
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
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(x) || 0));

// Кадрирование (зум/смещение) + cover-crop под ячейку W×Hc.
function coverChain(W: number, Hc: number, fx: CellFx | undefined): string {
  const z = clamp(fx?.zoom ?? 1, 1, 2.5);
  const fxx = (clamp(fx?.offX ?? 0, -1, 1) + 1) / 2; // 0..1 доля слэка по X
  const fyy = (clamp(fx?.offY ?? 0, -1, 1) + 1) / 2;
  const sw = Math.ceil((W * z) / 2) * 2;
  const sh = Math.ceil((Hc * z) / 2) * 2;
  return `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${W}:${Hc}:(iw-${W})*${fxx.toFixed(4)}:(ih-${Hc})*${fyy.toFixed(4)},setsar=1,fps=30`;
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

// Набор хуков, чья суммарная длина ≥ D (заполняют всю ячейку сверху). Возвращает файл+длительность.
// cut>0 — каждый хук вносит не больше cut секунд (режется), поэтому под ту же длину влезает больше разных хуков.
async function pickHooksToFill(files: string[], D: number, cut: number): Promise<{ file: string; dur: number }[]> {
  const eff = (d: number) => (cut > 0 ? Math.min(cut, d) : d);
  const shuffled = shuffle(files);
  const picked: { file: string; dur: number }[] = [];
  let sum = 0;
  for (const f of shuffled) {
    const d = await probeDur(f);
    if (d <= 0.2) continue;
    picked.push({ file: f, dur: d });
    sum += eff(d);
    if (sum >= D) break;
  }
  // Хуков не хватило перекрыть D — доливаем разными файлами (каждый круг новый порядок).
  let guard = 0;
  while (sum < D && picked.length && guard < 600) {
    for (const f of shuffle(files)) {
      if (sum >= D) break;
      const d = (await probeDur(f)) || 3;
      if (d <= 0.2) continue;
      picked.push({ file: f, dur: d });
      sum += eff(d);
      guard++;
    }
    guard++;
  }
  return picked;
}

// Лёгкое H.264-превью клипа (для кодеков, что не тянет Chromium — HEVC и т.п.). Кэш в temp.
const previewing = new Map<string, Promise<string | null>>();
function previewClip(src: string): Promise<string | null> {
  if (previewing.has(src)) return previewing.get(src)!;
  const p = (async () => {
    try {
      if (!ffmpegBin) return null;
      const st = await fs.promises.stat(src);
      const key = crypto.createHash('md5').update(src + st.mtimeMs + st.size).digest('hex').slice(0, 16);
      const out = path.join(os.tmpdir(), `splitprev_${key}.mp4`);
      if (fs.existsSync(out) && (await fs.promises.stat(out)).size > 0) return out;
      const tmp = path.join(os.tmpdir(), `splitprev_${key}_${Date.now()}.mp4`);
      await ff(['-y', '-i', src, '-an', '-t', '8', '-vf', 'scale=-2:480:flags=fast_bilinear,fps=30',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp]);
      await fs.promises.rename(tmp, out).catch(() => {});
      return fs.existsSync(out) ? out : tmp;
    } catch (e) {
      console.error('[split] previewClip failed:', (e as Error).message);
      return null;
    }
  })();
  previewing.set(src, p);
  return p;
}

export function registerSplitMergeHandlers() {
  ipcMain.handle('split:scanFolder', (_e, folder: string) => scan(folder));
  ipcMain.handle('split:previewClip', (_e, src: string) => previewClip(src));
  ipcMain.handle('split:cancel', () => { cancelled = true; return { ok: true }; });

  ipcMain.handle('split:generate', async (e, req: {
    topFolder: string; bottomFolder: string; topFile?: string | null; bottomFile?: string | null;
    hookCut?: number; duration: number; durationMode: 'auto' | 'fixed'; format: string;
    variations: number; topFx: CellFx; bottomFx: CellFx; outputDir: string;
  }) => {
    cancelled = false;
    if (!ffmpegBin) return { error: 'ffmpeg не найден' };
    const [W, H] = FORMATS[req.format] ?? FORMATS['9:16'];
    const Hc = Math.round(H / 4) * 2; // половина высоты, чётная
    const topFiles = req.topFile ? [req.topFile] : scan(req.topFolder);
    const botFiles = req.bottomFile ? [req.bottomFile] : scan(req.bottomFolder);
    if (!topFiles.length) return { error: 'В верхней папке (хуки) нет видео' };
    if (!botFiles.length) return { error: 'В нижней папке (эмоции) нет видео' };
    const cut = Math.max(0, Number(req.hookCut) || 0);
    const auto = req.durationMode !== 'fixed';
    const fixedD = Math.max(2, Number(req.duration) || 10);
    const emit = (stage: string, percent: number) => e.sender.send('split:progress', { stage, percent });
    const coverBot = coverChain(W, Hc, req.bottomFx);
    const coverTop = coverChain(W, Hc, req.topFx);
    const botFx = fxChain(req.bottomFx);
    const topFx = fxChain(req.topFx);
    const vBot = clamp(req.bottomFx?.volume ?? 1, 0, 2);
    const vTop = clamp(req.topFx?.volume ?? 0, 0, 2);
    const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);
    const made: string[] = [];

    try {
      const N = Math.max(1, Math.min(200, Number(req.variations) || 1));
      for (let v = 0; v < N; v++) {
        if (cancelled) break;
        emit(`Вариация ${v + 1}/${N}`, Math.round((v / N) * 100));
        const bottom = botFiles[Math.floor(Math.random() * botFiles.length)];
        // Длина ролика = длине выбранного клипа эмоции (авто) или фикс. значению.
        const D = auto ? Math.min(120, Math.max(2, (await probeDur(bottom)) || fixedD)) : fixedD;
        const hooks = await pickHooksToFill(topFiles, D, cut);
        if (!hooks.length) continue;

        const inputs: string[] = ['-stream_loop', '-1', '-i', bottom];
        hooks.forEach((h) => inputs.push('-i', h.file));

        const fc: string[] = [];
        // Видео.
        fc.push(`[0:v]${coverBot}${botFx ? ',' + botFx : ''},trim=0:${D},setpts=PTS-STARTPTS[bot]`);
        const hcut = cut > 0 ? `,trim=0:${cut},setpts=PTS-STARTPTS` : '';
        hooks.forEach((_, i) => fc.push(`[${i + 1}:v]${coverTop}${hcut}[h${i}]`));
        fc.push(`${hooks.map((_, i) => `[h${i}]`).join('')}concat=n=${hooks.length}:v=1:a=0[tcat]`);
        fc.push(`[tcat]${topFx ? topFx + ',' : ''}trim=0:${D},setpts=PTS-STARTPTS[top]`);
        fc.push(`[top][bot]vstack=inputs=2[v]`);

        // Аудио: канал эмоции (низ) + канал хука (верх), микс по громкостям.
        const mix: string[] = [];
        if (vBot > 0 && (await hasAudio(bottom))) {
          fc.push(`[0:a]volume=${vBot.toFixed(3)},atrim=0:${D},asetpts=N/SR/TB[abot]`);
          mix.push('[abot]');
        }
        if (vTop > 0) {
          // Аудио хуков: где нет звука — тишина (anullsrc) нужной длины, чтобы concat не падал.
          const hookA: string[] = [];
          let lav = 0;
          const acut = cut > 0 ? `,atrim=0:${cut},asetpts=N/SR/TB` : '';
          for (let i = 0; i < hooks.length; i++) {
            if (await hasAudio(hooks[i].file)) {
              fc.push(`[${i + 1}:a]aresample=44100${acut}[hka${i}]`);
              hookA.push(`[hka${i}]`);
            } else {
              const idx = 1 + hooks.length + lav;
              const silDur = cut > 0 ? Math.min(cut, hooks[i].dur || cut) : (hooks[i].dur || 3);
              inputs.push('-f', 'lavfi', '-t', Math.max(0.1, silDur).toFixed(2), '-i', 'anullsrc=r=44100:cl=stereo');
              hookA.push(`[${idx}:a]`);
              lav++;
            }
          }
          fc.push(`${hookA.join('')}concat=n=${hooks.length}:v=0:a=1[topaRaw]`);
          fc.push(`[topaRaw]volume=${vTop.toFixed(3)},atrim=0:${D},asetpts=N/SR/TB[atop]`);
          mix.push('[atop]');
        }
        let amap: string | null = null;
        if (mix.length === 1) {
          amap = mix[0];
        } else if (mix.length === 2) {
          fc.push(`${mix.join('')}amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[amixed]`);
          amap = '[amixed]';
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
