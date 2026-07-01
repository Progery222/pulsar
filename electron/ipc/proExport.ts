import { app, dialog, ipcMain } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');

// Разрешаем работать только внутри системной temp-папки (кадры экспорта).
function isTempDir(dir: string): boolean {
  try {
    return path.resolve(dir).startsWith(path.resolve(os.tmpdir()));
  } catch {
    return false;
  }
}

interface AudioInput {
  path: string;
  inPoint: number;
  duration: number;
  delayMs: number;
  volumeDb: number;
  pitch: number;
  fadeIn: number;
  fadeOut: number;
}
interface EncodeOpts {
  dir: string;
  fps: number;
  audio: AudioInput[];
  outPath: string;
  codec?: string; // libx264 | libx265
  videoBitrateMbps?: number;
  audioBitrateK?: number;
}

// Экспорт Pulsar Pro (§6/§7 ТЗ): кадры рендерятся в renderer WebGL-компоновщиком,
// пишутся в temp-папку, здесь собираются FFmpeg в mp4 + мукс аудио.
export function registerProExportHandlers() {
  // Диалог выбора файла вывода.
  ipcMain.handle('pro:exportSavePath', async (_e, ext?: string) => {
    const e = ext === 'mov' ? 'mov' : 'mp4';
    const res = await dialog.showSaveDialog({
      defaultPath: `pulsar-pro.${e}`,
      filters: [{ name: e.toUpperCase(), extensions: [e] }],
    });
    return res.canceled ? null : (res.filePath ?? null);
  });

  // Временная папка под кадры.
  ipcMain.handle('pro:exportDir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-pro-'));
    return dir;
  });

  // Запись одного кадра PNG (только внутрь temp-папки).
  ipcMain.handle('pro:writeFrame', async (_e, dir: string, index: number, data: ArrayBuffer) => {
    if (!isTempDir(dir)) return { error: 'bad dir' };
    const idx = Math.max(0, Math.floor(Number(index) || 0));
    const name = `frame_${String(idx).padStart(6, '0')}.png`;
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
    if (!isTempDir(dir)) return { error: 'bad dir' };
    const args = ['-y', '-framerate', String(Number(fps) || 30), '-i', path.join(dir, 'frame_%06d.png')];
    for (const a of audio) args.push('-ss', String(Math.max(0, Number(a.inPoint) || 0)), '-t', String(Math.max(0.01, Number(a.duration) || 0.01)), '-i', a.path);

    if (audio.length) {
      const parts = audio.map((a, i) => {
        const d = Math.max(0, Math.round(Number(a.delayMs) || 0));
        const vol = Math.pow(10, (Number(a.volumeDb) || 0) / 20);
        const chain: string[] = [];
        // Питч: смещение тона без изменения темпа (asetrate → aresample → atempo).
        const pitch = Number(a.pitch) || 0;
        if (pitch) {
          const r = Math.min(2, Math.max(0.5, Math.pow(2, pitch / 12)));
          chain.push(`asetrate=44100*${r}`, `aresample=44100`, `atempo=${(1 / r).toFixed(4)}`);
        }
        if (Number(a.fadeIn) > 0) chain.push(`afade=t=in:st=0:d=${Number(a.fadeIn)}`);
        if (Number(a.fadeOut) > 0) chain.push(`afade=t=out:st=${Math.max(0, Number(a.duration) - Number(a.fadeOut)).toFixed(3)}:d=${Number(a.fadeOut)}`);
        chain.push(`volume=${vol.toFixed(3)}`);
        chain.push(`adelay=${d}|${d}`);
        return `[${i + 1}:a]${chain.join(',')}[a${i}]`;
      });
      const mix = audio.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${audio.length}:normalize=0[aout]`;
      args.push('-filter_complex', parts.join(';') + ';' + mix, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', `${Math.max(64, Math.round(Number(opts.audioBitrateK) || 192))}k`);
    } else {
      args.push('-an');
    }
    const codec = opts.codec === 'libx265' ? 'libx265' : 'libx264';
    const vb = Math.max(1, Math.round(Number(opts.videoBitrateMbps) || 8));
    args.push('-c:v', codec, '-b:v', `${vb}M`, '-pix_fmt', 'yuv420p', '-preset', 'veryfast');
    if (codec === 'libx264') args.push('-profile:v', 'high');
    args.push('-r', String(Number(fps) || 30), '-movflags', '+faststart', outPath);

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
