import { app, dialog, ipcMain } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');

interface AudioInput {
  path: string;
  inPoint: number;
  duration: number;
  delayMs: number;
  volume: number;
}
interface EncodeOpts {
  dir: string;
  fps: number;
  audio: AudioInput[];
  outPath: string;
}

// Экспорт Pulsar Pro (§6/§7 ТЗ): кадры рендерятся в renderer WebGL-компоновщиком,
// пишутся в temp-папку, здесь собираются FFmpeg в mp4 + мукс аудио.
export function registerProExportHandlers() {
  // Диалог выбора файла вывода.
  ipcMain.handle('pro:exportSavePath', async () => {
    const res = await dialog.showSaveDialog({
      defaultPath: 'pulsar-pro.mp4',
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    return res.canceled ? null : (res.filePath ?? null);
  });

  // Временная папка под кадры.
  ipcMain.handle('pro:exportDir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-pro-'));
    return dir;
  });

  // Запись одного кадра PNG.
  ipcMain.handle('pro:writeFrame', async (_e, dir: string, index: number, data: ArrayBuffer) => {
    const name = `frame_${String(index).padStart(6, '0')}.png`;
    await fs.promises.writeFile(path.join(dir, name), Buffer.from(data));
    return { ok: true };
  });

  // Генерация proxy-файла (§7 ТЗ): 720p H.264, низкий битрейт, для быстрого превью.
  ipcMain.handle('pro:makeProxy', async (_e, src: string) => {
    if (!ffmpegBin || !src) return null;
    const dir = path.join(app.getPath('userData'), 'proxies');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, crypto.createHash('md5').update(src).digest('hex') + '.mp4');
    if (fs.existsSync(out)) return out;
    await new Promise<void>((resolve) => {
      const ch = spawn(ffmpegBin, ['-y', '-i', src, '-vf', 'scale=-2:720', '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-an', out], { windowsHide: true });
      ch.on('close', () => resolve());
      ch.on('error', () => resolve());
    });
    return fs.existsSync(out) ? out : null;
  });

  // Кодирование кадров + аудио в mp4.
  ipcMain.handle('pro:encode', async (_e, opts: EncodeOpts) => {
    if (!ffmpegBin) return { error: 'ffmpeg не найден' };
    const { dir, fps, audio, outPath } = opts;
    const args = ['-y', '-framerate', String(fps), '-i', path.join(dir, 'frame_%06d.png')];
    for (const a of audio) args.push('-ss', String(Math.max(0, a.inPoint)), '-t', String(Math.max(0.01, a.duration)), '-i', a.path);

    if (audio.length) {
      const parts = audio.map((a, i) => {
        const d = Math.max(0, Math.round(a.delayMs));
        return `[${i + 1}:a]adelay=${d}|${d},volume=${a.volume}[a${i}]`;
      });
      const mix = audio.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${audio.length}:normalize=0[aout]`;
      args.push('-filter_complex', parts.join(';') + ';' + mix, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    } else {
      args.push('-an');
    }
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-preset', 'veryfast', '-movflags', '+faststart', outPath);

    const result = await new Promise<{ ok: true } | { error: string }>((resolve) => {
      let err = '';
      const ch = spawn(ffmpegBin, args, { windowsHide: true });
      ch.stderr.on('data', (d: Buffer) => {
        err += d.toString();
        if (err.length > 8000) err = err.slice(-8000);
      });
      ch.on('close', (code) => resolve(code === 0 ? { ok: true } : { error: err.slice(-800) || `ffmpeg exit ${code}` }));
      ch.on('error', (e) => resolve({ error: e.message }));
    });

    // Уборка кадров.
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      /* не критично */
    }
    return result;
  });
}
