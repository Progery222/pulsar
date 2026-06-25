import { app, BrowserWindow, ipcMain } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Скачивание видео по ссылке (TikTok, YouTube, Instagram, …) через yt-dlp
// в локальную папку — дальше его подхватывает Уникализатор (VUB).

function pyCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

// Каталог с бинарником ffmpeg (нужен yt-dlp для склейки видео+аудио).
function ffmpegDir(): string | null {
  const p = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
  return p ? path.dirname(p) : null;
}

const VIDEO_EXT = /\.(mp4|mov|avi|webm|mkv)$/i;

function sendProgress(ev: { stage?: string; percent?: number; line?: string }) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('download-progress', ev));
}

// Установлен ли модуль yt_dlp.
function ytdlpInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pyCmd(), ['-m', 'yt_dlp', '--version']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// Установка yt-dlp через pip (стриминг прогресса).
function installYtdlp(): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    sendProgress({ stage: 'install', line: 'Устанавливаю загрузчик (yt-dlp)…' });
    const child = spawn(
      pyCmd(),
      ['-u', '-m', 'pip', 'install', '--upgrade', 'yt-dlp'],
      { env: { ...process.env, PYTHONUNBUFFERED: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' } }
    );
    child.on('error', (err) => resolve({ error: `Python/pip недоступен: ${err.message}` }));
    child.on('close', (code) =>
      code === 0 ? resolve({ ok: true }) : resolve({ error: `pip завершился с кодом ${code}` })
    );
  });
}

// Самый большой видеофайл в каталоге (без .part-огрызков).
function pickVideo(dir: string): string | null {
  let best: { p: string; size: number } | null = null;
  for (const name of fs.readdirSync(dir)) {
    if (!VIDEO_EXT.test(name)) continue;
    const full = path.join(dir, name);
    const size = fs.statSync(full).size;
    if (!best || size > best.size) best = { p: full, size };
  }
  return best?.p ?? null;
}

function runDownload(url: string, outDir: string): Promise<{ ok: true; path: string } | { error: string }> {
  return new Promise((resolve) => {
    const args = [
      '-m', 'yt_dlp',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '-o', path.join(outDir, '%(title).80B.%(ext)s'),
    ];
    const dir = ffmpegDir();
    if (dir) args.push('--ffmpeg-location', dir);
    args.push(url);

    sendProgress({ stage: 'download', percent: 0, line: 'Получаю видео…' });
    const child = spawn(pyCmd(), args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stderr = '';

    const onOut = (chunk: Buffer) => {
      const s = chunk.toString();
      const m = [...s.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
      if (m.length) {
        const pct = parseFloat(m[m.length - 1][1]);
        sendProgress({ stage: 'download', percent: pct });
      }
      if (/\[Merger\]|Merging formats|\[ffmpeg\]/i.test(s)) {
        sendProgress({ stage: 'merge', percent: 100, line: 'Склеиваю дорожки…' });
      }
    };
    child.stdout.on('data', onOut);
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      onOut(c);
    });
    child.on('error', (err) => resolve({ error: `Не удалось запустить yt-dlp: ${err.message}` }));
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? `код ${code}`;
        resolve({ error: `Ошибка загрузки: ${tail}` });
        return;
      }
      const file = pickVideo(outDir);
      if (!file) {
        resolve({ error: 'Файл скачан, но не найден на диске' });
        return;
      }
      sendProgress({ stage: 'done', percent: 100, line: 'Готово' });
      resolve({ ok: true, path: file });
    });
  });
}

export function registerDownloadHandlers() {
  ipcMain.handle('download:url', async (_e, url: string) => {
    if (!url || !/^https?:\/\//i.test(url.trim())) {
      return { error: 'Введите корректную ссылку (http/https)' };
    }
    if (!(await ytdlpInstalled())) {
      const inst = await installYtdlp();
      if ('error' in inst) return inst;
      if (!(await ytdlpInstalled())) return { error: 'yt-dlp не установился. Проверьте Python.' };
    }
    const outDir = path.join(app.getPath('downloads'), 'Beatleap', String(Date.now()));
    fs.mkdirSync(outDir, { recursive: true });
    try {
      return await runDownload(url.trim(), outDir);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
