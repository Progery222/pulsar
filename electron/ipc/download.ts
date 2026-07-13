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
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|opus|ogg)$/i;

function pickAudio(dir: string): string | null {
  let best: { p: string; size: number } | null = null;
  for (const name of fs.readdirSync(dir)) {
    if (!AUDIO_EXT.test(name)) continue;
    const full = path.join(dir, name);
    const size = fs.statSync(full).size;
    if (!best || size > best.size) best = { p: full, size };
  }
  return best?.p ?? null;
}

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

// Ошибки, при которых нужна авторизация (Instagram/приватные видео) — повторяем с куками из браузера.
const NEEDS_COOKIES = /empty media response|login required|log in|sign in|requires authentication|cookies|private|not available|rate.?limit|account/i;
// Браузеры для извлечения куки (в порядке попыток).
const COOKIE_BROWSERS = ['edge', 'chrome', 'firefox'];

function runDownload(url: string, outDir: string, cookiesBrowser?: string): Promise<{ ok: true; path: string } | { error: string }> {
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
    // Куки из браузера (нужны Instagram и для приватного контента).
    if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser);
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

// Скачивание только АУДИО (yt-dlp -x mp3) — трендовый звук по ссылке для монтажа.
function runAudioDownload(url: string, outDir: string, cookiesBrowser?: string): Promise<{ ok: true; path: string } | { error: string }> {
  return new Promise((resolve) => {
    const args = [
      '-m', 'yt_dlp',
      '--no-playlist', '--no-warnings', '--newline',
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '-o', path.join(outDir, '%(title).80B.%(ext)s'),
    ];
    if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser);
    const dir = ffmpegDir();
    if (dir) args.push('--ffmpeg-location', dir);
    args.push(url);

    sendProgress({ stage: 'download', percent: 0, line: 'Получаю аудио…' });
    const child = spawn(pyCmd(), args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stderr = '';
    const onOut = (chunk: Buffer) => {
      const s = chunk.toString();
      const m = [...s.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
      if (m.length) sendProgress({ stage: 'download', percent: parseFloat(m[m.length - 1][1]) });
      if (/ExtractAudio|Destination.*\.mp3|\[ffmpeg\]/i.test(s)) sendProgress({ stage: 'merge', percent: 100, line: 'Извлекаю дорожку…' });
    };
    child.stdout.on('data', onOut);
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); onOut(c); });
    child.on('error', (err) => resolve({ error: `Не удалось запустить yt-dlp: ${err.message}` }));
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? `код ${code}`;
        resolve({ error: `Ошибка загрузки: ${tail}` });
        return;
      }
      const file = pickAudio(outDir);
      if (!file) { resolve({ error: 'Аудио скачано, но не найдено на диске' }); return; }
      sendProgress({ stage: 'done', percent: 100, line: 'Готово' });
      resolve({ ok: true, path: file });
    });
  });
}

// Best-effort: «использовано в N видео» — парсим встроенный JSON страницы TikTok.
async function tiktokUses(url: string): Promise<{ uses: number | null; title: string | null }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await res.text();
    // Счётчик видео со звуком (в разных ключах у TikTok).
    const counts = [...html.matchAll(/"(?:videoCount|video_count)"\s*:\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
    const uses = counts.length ? Math.max(...counts) : null;
    const t = html.match(/"musicName"\s*:\s*"([^"]+)"/) || html.match(/"title"\s*:\s*"([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
    return { uses, title: t ? t[1] : null };
  } catch {
    return { uses: null, title: null };
  }
}

// Тренды TikTok через Apify (надёжно, free-тир): запускаем актёр и берём датасет.
async function apifyTrending(opts: { token: string; actor?: string; country?: string; limit?: number }): Promise<{ items: unknown[] } | { error: string }> {
  try {
    const token = (opts.token || '').trim();
    if (!token) return { error: 'Нужен Apify-токен' };
    const actor = (opts.actor || 'novi~tiktok-music-trend-api').replace('/', '~');
    const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const input = { countryCode: opts.country || 'US', country: opts.country || 'US', region: opts.country || 'US', limit: opts.limit || 25, maxItems: opts.limit || 25, period: 7 };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const text = await res.text();
    if (!res.ok) return { error: `Apify ${res.status}: ${text.slice(0, 200)}` };
    let items: unknown;
    try { items = JSON.parse(text); } catch { return { error: 'Apify: неожиданный ответ' }; }
    if (!Array.isArray(items)) return { error: 'Apify: пустой результат' };
    const g = (o: Record<string, unknown>, keys: string[]): string | number | null => {
      for (const k of keys) { const v = o[k]; if (v != null && v !== '') return v as string | number; }
      return null;
    };
    const list = (items as Record<string, unknown>[]).map((it) => ({
      title: g(it, ['title', 'song_title', 'music_title', 'songName', 'name', 'clip_title']) || 'Без названия',
      author: g(it, ['author', 'author_name', 'artist', 'singer', 'author_nickname']) || '',
      uses: g(it, ['videoCount', 'video_count', 'uses', 'usage', 'postCount', 'post_count', 'user_count']),
      link: g(it, ['url', 'link', 'music_url', 'tiktok_url', 'songUrl', 'share_url']) || '',
      playUrl: g(it, ['playUrl', 'play_url', 'audio', 'audio_url', 'clipUrl', 'music_play_url']) || '',
    }));
    return { items: list };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function registerDownloadHandlers() {
  ipcMain.handle('apify:trending', async (_e, opts: { token: string; actor?: string; country?: string; limit?: number }) => apifyTrending(opts));
  ipcMain.handle('tiktok:uses', async (_e, url: string) => {
    if (!url || !/^https?:\/\//i.test(url.trim())) return { uses: null, title: null };
    return tiktokUses(url.trim());
  });
  // Аудио по ссылке (для монтажа под трендовый звук) → mp3 в Downloads/Pulsar/audio.
  ipcMain.handle('download:audio', async (_e, url: string) => {
    if (!url || !/^https?:\/\//i.test(url.trim())) return { error: 'Введите корректную ссылку (http/https)' };
    if (!(await ytdlpInstalled())) {
      const inst = await installYtdlp();
      if ('error' in inst) return inst;
      if (!(await ytdlpInstalled())) return { error: 'yt-dlp не установился. Проверьте Python.' };
    }
    const outDir = path.join(app.getPath('downloads'), 'Pulsar', 'audio', String(Date.now()));
    fs.mkdirSync(outDir, { recursive: true });
    try {
      let r = await runAudioDownload(url.trim(), outDir);
      if ('error' in r && NEEDS_COOKIES.test(r.error)) {
        for (const b of COOKIE_BROWSERS) {
          sendProgress({ stage: 'download', line: `Требуется вход — пробую куки из ${b}…` });
          const r2 = await runAudioDownload(url.trim(), outDir, b);
          if ('ok' in r2) return r2;
          r = r2;
        }
      }
      return r;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // url — ссылка; baseDir (необязательно) — куда сохранять (иначе Downloads/Pulsar).
  // Каждое скачивание идёт в свою подпапку-таймстамп, чтобы файлы не перемешивались.
  ipcMain.handle('download:url', async (_e, url: string, baseDir?: string) => {
    if (!url || !/^https?:\/\//i.test(url.trim())) {
      return { error: 'Введите корректную ссылку (http/https)' };
    }
    if (!(await ytdlpInstalled())) {
      const inst = await installYtdlp();
      if ('error' in inst) return inst;
      if (!(await ytdlpInstalled())) return { error: 'yt-dlp не установился. Проверьте Python.' };
    }
    const root = baseDir && baseDir.trim() ? baseDir : path.join(app.getPath('downloads'), 'Pulsar');
    const outDir = path.join(root, String(Date.now()));
    fs.mkdirSync(outDir, { recursive: true });
    try {
      let r = await runDownload(url.trim(), outDir);
      // Instagram/приватное: если нужна авторизация — пробуем куки из браузеров.
      if ('error' in r && NEEDS_COOKIES.test(r.error)) {
        for (const b of COOKIE_BROWSERS) {
          sendProgress({ stage: 'download', line: `Требуется вход — пробую куки из ${b}…` });
          const r2 = await runDownload(url.trim(), outDir, b);
          if ('ok' in r2) return r2;
          r = r2;
          // «браузер не найден / не удалось расшифровать куки» — пробуем следующий браузер.
        }
        return { error: `${r.error}\nНужен вход: залогиньтесь в Instagram в Chrome/Edge/Firefox и повторите (или используйте публичную ссылку).` };
      }
      return r;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
