import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { videoEncoderOptions } from './encoder';

const ffprobeBin = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
function hasAudioStream(file: string): Promise<boolean> {
  if (!ffprobeBin) return Promise.resolve(false);
  return new Promise((resolve) => {
    const p = spawn(ffprobeBin, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(out.trim().length > 0));
  });
}

// Мини-Remotion на нашем Chromium: шаблон (public/templates/runtime.html) рендерится
// в скрытом окне покадрово (capturePage) → PNG → ffmpeg склейка + музыка → mp4.
// +0 МБ (Chromium уже в сборке), без внешних зависимостей.

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');

function runtimeHtmlPath(): string {
  // VITE_PUBLIC = public (dev) / dist (prod); в обоих случаях templates/runtime.html копируется.
  return path.join(process.env.VITE_PUBLIC || process.cwd(), 'templates', 'runtime.html');
}
function fontsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'fonts')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'assets', 'fonts');
}
function sfxPath(name: string): string {
  return path.join(process.env.VITE_PUBLIC || process.cwd(), 'templates', 'sfx', `${name}.mp3`);
}
// Переход → звук: свайпы/вайпы/зеркало — whoosh; удар/глитч/зум — impact; вспышка — pop.
const TRANS_SFX: Record<string, string | null> = {
  fade: null, text: 'whoosh', wipe: 'whoosh', swipe: 'whoosh', swipeUp: 'whoosh', mirror: 'whoosh',
  zoom: 'impact', punch: 'impact', glitchcut: 'impact', flash: 'pop',
};

export interface TemplateRenderOpts {
  templateId: string;
  data: Record<string, unknown>;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  outputPath: string;
  musicPath?: string | null;
  musicStart?: number;
  clipAudio?: boolean; // подмешивать звук из видео-клипов сцен
  sfx?: boolean; // звуки переходов (по умолчанию выкл)
}

export interface TemplateRenderHooks {
  onProgress?: (percent: number) => void;
  getCancelled?: () => boolean;
}

export async function renderTemplate(opts: TemplateRenderOpts, hooks: TemplateRenderHooks = {}): Promise<string> {
  const { templateId, data, width, height, fps, durationSec, outputPath } = opts;
  const total = Math.max(1, Math.round(fps * durationSec));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-tpl-'));
  const framesDir = path.join(tmp, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });

  try {
    win.webContents.setFrameRate(60);
    await win.loadFile(runtimeHtmlPath());
    const cfg = { id: templateId, dur: durationSec, fontsDir: fontsDir(), data };
    await win.webContents.executeJavaScript(`initTemplate(${JSON.stringify(cfg)}); true`);
    try {
      await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
    } catch {
      /* шрифты не критичны */
    }
    await new Promise((r) => setTimeout(r, 400));
    // Дождаться загрузки видео-слотов (если есть) перед покадровым захватом.
    try {
      await win.webContents.executeJavaScript('window.mediaReady ? window.mediaReady().then(()=>true) : true');
    } catch {
      /* видео не критичны */
    }

    for (let i = 0; i < total; i++) {
      if (hooks.getCancelled?.()) throw new Error('Отменено');
      const tv = (i / fps).toFixed(4);
      // seekAndWait докручивает видео до нужного кадра; для шаблонов без видео — мгновенно.
      await win.webContents.executeJavaScript(
        `window.seekAndWait ? window.seekAndWait(${tv}).then(()=>true) : (window.seek(${tv}),true)`
      );
      await new Promise((r) => setTimeout(r, 16));
      let img = await win.webContents.capturePage();
      const sz = img.getSize();
      // При Windows-масштабе (DPR≠1) захват крупнее — приводим к точному размеру.
      if (sz.width !== width || sz.height !== height) {
        img = img.resize({ width, height, quality: 'best' });
      }
      fs.writeFileSync(path.join(framesDir, `f${String(i).padStart(5, '0')}.png`), img.toPNG());
      hooks.onProgress?.(Math.round((i / total) * 80));
    }
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }

  // Склейка кадров + музыка + SFX-переходы на стыках сцен.
  if (!ffmpegBin) throw new Error('ffmpeg не найден');
  const venc = await videoEncoderOptions({ preset: 'medium', crf: 18 });
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, 'f%05d.png')];

  // Аудио-входы: [музыка?][sfx...]; собираем filter_complex-микс.
  // Пресет-трек приходит относительным (assets/music/...) — резолвим к ресурсам.
  const musicFile = opts.musicPath
    ? (path.isAbsolute(opts.musicPath)
        ? opts.musicPath
        : path.join(app.isPackaged ? process.resourcesPath : (process.env.APP_ROOT ?? process.cwd()), opts.musicPath))
    : null;
  const mixParts: string[] = [];
  const filters: string[] = [];
  let inIdx = 1; // 0 — кадры
  if (musicFile && fs.existsSync(musicFile)) {
    if (opts.musicStart && opts.musicStart > 0) args.push('-ss', String(opts.musicStart));
    args.push('-i', musicFile);
    filters.push(`[${inIdx}:a]volume=0.85[m]`);
    mixParts.push('[m]');
    inIdx++;
  }
  // SFX на переходах: время стыка сцены i = сумма длительностей до i (масштаб к durationSec).
  const scenes = Array.isArray((data as { scenes?: unknown }).scenes)
    ? ((data as { scenes: { dur?: number; trans?: string }[] }).scenes)
    : [];
  if (opts.sfx && scenes.length > 1) {
    const authored = scenes.reduce((s, x) => s + (x.dur || 1.5), 0) || 1;
    const factor = durationSec / authored;
    let acc = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (i > 0) {
        const name = TRANS_SFX[scenes[i].trans || 'fade'];
        const file = name ? sfxPath(name) : null;
        if (file && fs.existsSync(file)) {
          const dl = Math.max(0, Math.round(acc * factor * 1000) - 20); // чуть раньше стыка
          args.push('-i', file);
          filters.push(`[${inIdx}:a]adelay=${dl}|${dl},volume=0.7[s${inIdx}]`);
          mixParts.push(`[s${inIdx}]`);
          inIdx++;
        }
      }
      acc += scenes[i].dur || 1.5;
    }
  }
  // Звук из видео-клипов: для сцены со слот-видео берём его аудио в окне сцены.
  if (opts.clipAudio && scenes.length) {
    const dslots = Array.isArray((data as { slots?: unknown }).slots) ? (data as { slots: unknown[] }).slots : [];
    const authored = scenes.reduce((s, x) => s + (x.dur || 1.5), 0) || 1;
    const factor = durationSec / authored;
    let acc2 = 0;
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i] as { dur?: number; slot?: number };
      const slot = typeof sc.slot === 'number' ? (dslots[sc.slot] as { path?: string; start?: number } | undefined) : undefined;
      if (slot && slot.path && fs.existsSync(slot.path) && (await hasAudioStream(slot.path))) {
        const dl = Math.round(acc2 * factor * 1000);
        args.push('-ss', String(slot.start || 0), '-t', String(((sc.dur || 1.5) * factor).toFixed(3)), '-i', slot.path);
        filters.push(`[${inIdx}:a]adelay=${dl}|${dl},volume=1.0[c${inIdx}]`);
        mixParts.push(`[c${inIdx}]`);
        inIdx++;
      }
      acc2 += sc.dur || 1.5;
    }
  }

  args.push('-map', '0:v:0');
  if (mixParts.length > 0) {
    const mix = `${filters.join(';')};${mixParts.join('')}amix=inputs=${mixParts.length}:normalize=0:duration=longest[aout]`;
    args.push('-filter_complex', mix, '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-vf', 'format=yuv420p', ...venc, '-r', String(fps), '-t', String(durationSec), outputPath);

  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegBin, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      hooks.onProgress?.(100);
      if (code === 0) resolve();
      else reject(new Error('ffmpeg: ' + err.slice(-400)));
    });
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  return outputPath;
}

let cancelled = false;

export function registerTemplateHandlers() {
  ipcMain.handle('template:render', async (e, opts: TemplateRenderOpts) => {
    cancelled = false;
    try {
      const out = await renderTemplate(opts, {
        onProgress: (p) => e.sender.send('template:progress', p),
        getCancelled: () => cancelled,
      });
      return { ok: true, path: out };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('template:cancel', () => {
    cancelled = true;
    return { ok: true };
  });
  ipcMain.handle('template:ids', async () => {
    // Список зарегистрированных шаблонов из runtime (для UI).
    const win = new BrowserWindow({ width: 200, height: 200, show: false, webPreferences: { offscreen: true } });
    try {
      await win.loadFile(runtimeHtmlPath());
      return await win.webContents.executeJavaScript('templateIds()');
    } catch {
      return [];
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  });
}
