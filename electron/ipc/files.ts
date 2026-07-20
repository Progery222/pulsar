import { app, dialog, ipcMain, shell } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { transcribeWhisper } from './transcribe';
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

// Список установленных в системе шрифтов (Windows-реестр) — семейства без стилевых суффиксов.
function listSystemFonts(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const read = (root: string) =>
    new Promise<string>((resolve) => {
      const ch = spawn('reg', ['query', root], { windowsHide: true });
      let out = '';
      ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
      ch.on('close', () => resolve(out));
      ch.on('error', () => resolve(''));
    });
  const roots = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
  const STYLE = /\s+(Bold|Italic|Oblique|Light|Semibold|Demibold|Medium|Black|Thin|Heavy|Regular|Condensed|Narrow|Extrabold|Extralight|Book|Hairline)\b/gi;
  return Promise.all(roots.map(read)).then((texts) => {
    const fams = new Set<string>();
    for (const txt of texts) {
      for (const line of txt.split(/\r?\n/)) {
        const m = /^\s{4,}(.+?)\s+REG_SZ\s+/.exec(line);
        if (!m) continue;
        const raw = m[1].replace(/\s*\((TrueType|OpenType|VDMX|All res)\)\s*$/i, '').trim();
        for (let part of raw.split('&')) {
          part = part.replace(STYLE, '').replace(/\s+/g, ' ').trim();
          if (part && !/^[0-9]/.test(part) && part.length <= 40) fams.add(part);
        }
      }
    }
    return [...fams].sort((a, b) => a.localeCompare(b));
  });
}

// IPC-обработчики для файловой системы: системные диалоги выбора файлов.
export function registerFileHandlers() {
  ipcMain.handle('fonts:list', () => listSystemFonts());

  // Авто-титры: офлайн-распознавание речи (faster-whisper) -> слова с таймингами (мс).
  ipcMain.handle('pro:transcribe', async (_e, src: string, language: string) => {
    try {
      return { words: await transcribeWhisper(src, language || 'ru') };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  // Транскрибация с прогрессом (модуль «Субтитры») -> события 'transcribe:progress'.
  ipcMain.handle('transcribe:run', async (e, src: string, language: string) => {
    try {
      const words = await transcribeWhisper(src, language || 'auto', 'small', (ev) => e.sender.send('transcribe:progress', ev));
      return { words };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
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

  // Сохранить текстовый файл (SRT/TXT/VTT) через диалог «Сохранить как».
  ipcMain.handle('dialog:saveText', async (_e, defaultName: string, content: string) => {
    const ext = (defaultName.split('.').pop() || 'txt').toLowerCase();
    const res = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Все файлы', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePath) return { cancelled: true as const };
    try {
      await fs.promises.writeFile(res.filePath, content, 'utf8');
      return { ok: true as const, path: res.filePath };
    } catch (err) {
      return { error: (err as Error).message };
    }
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
    let bytes = 0;
    const CAP = SR * 2 * 3600; // ≤1 час PCM — защита от OOM на аномально длинных файлах
    await new Promise<void>((resolve) => {
      const ch = spawn(ffmpegBin, ['-i', src, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { windowsHide: true });
      ch.stdout.on('data', (d: Buffer) => {
        chunks.push(d);
        bytes += d.length;
        if (bytes >= CAP) ch.kill();
      });
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
    let bytes = 0;
    const CAP = SR * 2 * 3600; // ≤1 час PCM — защита от OOM
    await new Promise<void>((resolve) => {
      const ch = spawn(ffmpegBin, ['-i', src, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { windowsHide: true });
      ch.stdout.on('data', (d: Buffer) => {
        chunks.push(d);
        bytes += d.length;
        if (bytes >= CAP) ch.kill();
      });
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
    // Сырые onset'ы (акценты) — адаптивный порог + пик-пикинг.
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

    // Оценка темпа: автокорреляция огибающей онсетов (сглаженной) на диапазоне 60..190 BPM.
    const fps = SR / hop; // кадров огибающей в секунду
    const env = new Float32Array(frames);
    for (let i = 0; i < frames; i++) env[i] = (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(frames - 1, i + 1)]) / 3;
    // Диапазон tactus 70..180 BPM + весовое предпочтение ~120 BPM (иначе автокорр цепляется за двойной/половинный темп).
    const minLag = Math.max(2, Math.round((fps * 60) / 180));
    const maxLag = Math.min(frames - 2, Math.round((fps * 60) / 70));
    const ac = new Float32Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = lag; i < frames; i++) s += env[i] * env[i - lag];
      s /= frames - lag;
      const bpm = (60 * fps) / lag;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2)); // гаусс вокруг 120 BPM
      ac[lag] = s * w;
    }
    let bestLag = minLag;
    for (let lag = minLag + 1; lag <= maxLag; lag++) if (ac[lag] > ac[bestLag]) bestLag = lag;
    // Парабол. интерполяция вершины для дробного периода.
    const al = ac[bestLag - 1] || 0;
    const bl = ac[bestLag];
    const cl = ac[bestLag + 1] || 0;
    const denom = al - 2 * bl + cl;
    let period = bestLag + (denom < 0 ? (0.5 * (al - cl)) / denom : 0);
    if (!(period > 1)) period = bestLag;

    // Фаза: смещение сетки, максимизирующее сумму огибающей на долях (мелкий шаг для точной посадки).
    let bestPhase = 0;
    let bestScore = -1;
    for (let p = 0; p < period; p += 0.25) {
      let s = 0;
      for (let f = p; f < frames; f += period) s += env[Math.round(f)] || 0;
      if (s > bestScore) {
        bestScore = s;
        bestPhase = p;
      }
    }

    // Ровная сетка битов (tactus) по темпу+фазе.
    const grid: number[] = [];
    for (let f = bestPhase; f < frames; f += period) grid.push(Number(((f * hop) / SR).toFixed(3)));
    const tempo = Math.round((60 * fps) / period);
    return { beat_times: grid.length >= 2 ? grid : onsets, onset_times: onsets, duration, tempo };
  });

  // Миниатюра кадра видео (для таймлайна/очереди). Кэшируется по src+time.
  ipcMain.handle('media:thumb', async (_event, src: string, time: number) => {
    if (!ffmpegBin || !src) return null;
    const dir = path.join(app.getPath('userData'), 'thumbs');
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash('md5').update(`${src}|${time}`).digest('hex');
    const out = path.join(dir, `${key}.jpg`);
    if (fs.existsSync(out)) return out;
    // Ограничиваем параллелизм — иначе десятки ffmpeg разом душат CPU и превью не проигрывается.
    await acquireThumbSlot();
    try {
      await new Promise<void>((resolve) => {
        const ch = spawn(ffmpegBin, ['-y', '-ss', String(Math.max(0, time || 0)), '-i', src, '-frames:v', '1', '-vf', 'scale=200:-1', out], { windowsHide: true });
        ch.on('close', () => resolve());
        ch.on('error', () => resolve());
      });
    } finally {
      releaseThumbSlot();
    }
    return fs.existsSync(out) ? out : null;
  });
}

// Очередь миниатюр: не более 3 ffmpeg одновременно (чтобы не забивать CPU при добавлении клипа).
let thumbActive = 0;
const thumbWaiters: (() => void)[] = [];
function acquireThumbSlot(): Promise<void> {
  if (thumbActive < 3) {
    thumbActive++;
    return Promise.resolve();
  }
  return new Promise<void>((res) => thumbWaiters.push(() => res())).then(() => {
    thumbActive++;
  });
}
function releaseThumbSlot(): void {
  thumbActive--;
  const next = thumbWaiters.shift();
  if (next) next();
}
