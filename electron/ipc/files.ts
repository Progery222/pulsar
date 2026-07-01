import { app, dialog, ipcMain, shell } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

// Список доступных дисков Windows (C:\, D:\ …).
function listDrives(): DirEntry[] {
  const out: DirEntry[] = [];
  for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = `${l}:\\`;
    try {
      fs.accessSync(p);
      out.push({ name: `${l}:`, path: p, isDir: true });
    } catch {
      /* диска нет */
    }
  }
  return out;
}

// IPC-обработчики для файловой системы: системные диалоги выбора файлов.
export function registerFileHandlers() {
  // Листинг директории для бокового проводника. dir пустой -> диски (Windows) / home.
  ipcMain.handle('fs:listDir', async (_e, dir: string | null) => {
    try {
      if (!dir) {
        const drives = process.platform === 'win32' ? listDrives() : [];
        if (drives.length) return { entries: drives, parent: null, home: os.homedir() };
        return { entries: [{ name: os.homedir(), path: os.homedir(), isDir: true }], parent: null, home: os.homedir() };
      }
      const items = await fs.promises.readdir(dir, { withFileTypes: true });
      const entries: DirEntry[] = items
        .filter((d) => !d.name.startsWith('$') && !d.name.startsWith('.'))
        .map((d) => {
          let isDir = d.isDirectory();
          // Симлинки/junctions: пробуем определить тип реальной цели.
          if (d.isSymbolicLink()) {
            try {
              isDir = fs.statSync(path.join(dir, d.name)).isDirectory();
            } catch {
              isDir = false;
            }
          }
          return { name: d.name, path: path.join(dir, d.name), isDir };
        })
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const parent = path.dirname(dir);
      return { entries, parent: parent === dir ? null : parent, home: os.homedir() };
    } catch (err) {
      return { entries: [], parent: null, home: os.homedir(), error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Выбор видеофайлов (§5.2): фильтр .mp4, .mov, .avi
  ipcMain.handle('dialog:selectVideos', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // Выбор аудиофайла (§5.3): фильтр .mp3, .wav, .aac
  ipcMain.handle('dialog:selectAudio', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Аудио', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Выбор файла водяного знака VUB (§4.5): PNG, GIF, MP4.
  ipcMain.handle('dialog:selectWatermark', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Водяной знак', extensions: ['png', 'gif', 'mp4'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Выбор папки для экспорта (§11).
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Открыть папку в проводнике Windows (§11).
  ipcMain.handle('shell:openPath', async (_event, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  // Показать файл в проводнике (с выделением).
  ipcMain.handle('shell:showItem', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  // Пики аудиодорожки для вейвформ на таймлайне (Pulsar Pro §3.3). Кэш JSON по src.
  // Декодируем в моно PCM 8кГц, считаем ~60 пиков/сек (0..1) на всю длину файла.
  ipcMain.handle('media:waveform', async (_event, src: string) => {
    if (!ffmpegBin || !src) return null;
    const dir = path.join(app.getPath('userData'), 'waveforms');
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash('md5').update(src).digest('hex');
    const out = path.join(dir, `${key}.json`);
    if (fs.existsSync(out)) {
      try {
        return JSON.parse(fs.readFileSync(out, 'utf8')) as { peaks: number[]; duration: number };
      } catch {
        /* битый кэш — перегенерим */
      }
    }
    const SR = 8000;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve) => {
      const ch = spawn(ffmpegBin, ['-i', src, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { windowsHide: true });
      ch.stdout.on('data', (d: Buffer) => chunks.push(d));
      ch.on('close', () => resolve());
      ch.on('error', () => resolve());
    });
    const buf = Buffer.concat(chunks);
    const total = Math.floor(buf.length / 2);
    if (total === 0) return null;
    const duration = total / SR;
    const targetPeaks = Math.min(200000, Math.max(1, Math.ceil(duration * 60)));
    const bucket = Math.max(1, Math.floor(total / targetPeaks));
    const peaks: number[] = [];
    for (let i = 0; i < total; i += bucket) {
      let peak = 0;
      const end = Math.min(total, i + bucket);
      for (let j = i; j < end; j++) {
        const v = Math.abs(buf.readInt16LE(j * 2));
        if (v > peak) peak = v;
      }
      peaks.push(peak / 32768);
    }
    const result = { peaks, duration };
    try {
      fs.writeFileSync(out, JSON.stringify(result));
    } catch {
      /* не критично */
    }
    return result;
  });

  // Детект битов/онсетов в main (ffmpeg стримит PCM) — без OOM в renderer.
  ipcMain.handle('media:beats', async (_event, src: string) => {
    if (!ffmpegBin || !src) return null;
    const SR = 22050;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve) => {
      const ch = spawn(ffmpegBin, ['-i', src, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { windowsHide: true });
      ch.stdout.on('data', (d: Buffer) => chunks.push(d));
      ch.on('close', () => resolve());
      ch.on('error', () => resolve());
    });
    const buf = Buffer.concat(chunks);
    const total = Math.floor(buf.length / 2);
    if (total < SR) return null;
    const duration = total / SR;
    const hop = 1024;
    const frames = Math.floor(total / hop);
    const energy = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0;
      const base = i * hop * 2;
      for (let j = 0; j < hop; j++) {
        const v = buf.readInt16LE(base + j * 2) / 32768;
        s += v * v;
      }
      energy[i] = Math.sqrt(s / hop);
    }
    const flux = new Float32Array(frames);
    for (let i = 1; i < frames; i++) {
      const d = energy[i] - energy[i - 1];
      flux[i] = d > 0 ? d : 0;
    }
    const onsets: number[] = [];
    const win = Math.round(SR / hop);
    for (let i = 1; i < frames - 1; i++) {
      const lo = Math.max(0, i - win);
      const hi = Math.min(frames, i + win);
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += flux[k];
      const mean = sum / (hi - lo);
      if (flux[i] > mean * 1.6 && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > 1e-4) {
        const t = (i * hop) / SR;
        if (!onsets.length || t - onsets[onsets.length - 1] > 0.14) onsets.push(t);
      }
    }
    if (onsets.length < 2) return null;
    const gaps: number[] = [];
    for (let i = 1; i < onsets.length; i++) gaps.push(onsets[i] - onsets[i - 1]);
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)] || 0.5;
    return { beat_times: onsets, onset_times: onsets, duration, tempo: med > 0 ? Math.round(60 / med) : 120 };
  });

  // Миниатюра кадра видео (для таймлайна/очереди). Кэшируется по src+time.
  ipcMain.handle('media:thumb', async (_event, src: string, time: number) => {
    if (!ffmpegBin || !src) return null;
    const dir = path.join(app.getPath('userData'), 'thumbs');
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash('md5').update(`${src}|${time}`).digest('hex');
    const out = path.join(dir, `${key}.jpg`);
    if (fs.existsSync(out)) return out;
    await new Promise<void>((resolve) => {
      const ch = spawn(ffmpegBin, ['-y', '-ss', String(Math.max(0, time || 0)), '-i', src, '-frames:v', '1', '-vf', 'scale=200:-1', out], { windowsHide: true });
      ch.on('close', () => resolve());
      ch.on('error', () => resolve());
    });
    return fs.existsSync(out) ? out : null;
  });
}
