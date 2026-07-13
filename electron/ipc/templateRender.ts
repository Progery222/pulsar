import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import ffmpegStatic from 'ffmpeg-static';
import { videoEncoderOptions } from './encoder';

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

  // Склейка кадров + музыка.
  if (!ffmpegBin) throw new Error('ffmpeg не найден');
  const venc = await videoEncoderOptions({ preset: 'medium', crf: 18 });
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, 'f%05d.png')];
  if (opts.musicPath) {
    if (opts.musicStart && opts.musicStart > 0) args.push('-ss', String(opts.musicStart));
    args.push('-i', opts.musicPath);
  }
  args.push('-map', '0:v:0');
  if (opts.musicPath) args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
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
