import { app, BrowserWindow, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';

// Node 18 fetch (undici) без Happy Eyeballs падает «fetch failed», если хост
// резолвится в IPv6, а IPv6 не работает. Глобально предпочитаем IPv4 для всех
// сетевых вызовов приложения (OpenRouter, AssemblyAI и т.д.). Должно стоять до
// любых сетевых запросов.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* noop */
}

// Разрешаем программный WebGL (SwiftShader), если аппаратный GPU недоступен/заблокирован —
// иначе WebGL-компоновщик Viewer в Pulsar Pro не инициализируется (createShader → null).
try {
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  // WebGPU для Студии (Dawn -> D3D12 на Windows; Vulkan НЕ форсим — он ронял GPU).
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  // Платформенный декод HEVC/H.265 в <video> (превью монтажа) — иначе видео с
  // телефонов (H.265) не проигрываются (MediaError code 4). Требует HEVC-декодер
  // в системе (обычно есть на Windows с GPU Intel/NVIDIA/AMD).
  app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
} catch {
  /* noop */
}
import { registerFileHandlers } from './ipc/files';
import { registerAudioHandlers } from './ipc/audio';
import { registerFfmpegHandlers } from './ipc/ffmpeg';
import { registerVubHandlers } from './ipc/vub';
import { registerConfigHandlers, loadSettings } from './ipc/config';
import { registerCleanerHandlers } from './ipc/cleaner';
import { registerStoreHandlers } from './ipc/store';
import { registerTtsHandlers } from './ipc/tts';
import { registerSetupHandlers } from './ipc/setup';
import { registerDubHandlers } from './ipc/dub';
import { registerDownloadHandlers } from './ipc/download';
import { registerFunnelHandlers } from './ipc/funnel';
import { registerUpdaterHandlers } from './ipc/updater';
import { registerProExportHandlers } from './ipc/proExport';
import { registerFeedbackHandlers } from './ipc/feedback';

// dist-electron/main.js  -> __dirname = <root>/dist-electron
process.env.APP_ROOT = path.join(__dirname, '..');

// Диагностика краша Студии: логируем причину гибели рендер/дочерних процессов.
app.on('render-process-gone', (_e, _wc, details) => {
  console.error('[CRASH] render-process-gone:', JSON.stringify(details));
});
app.on('child-process-gone', (_e, details) => {
  console.error('[CRASH] child-process-gone:', JSON.stringify(details));
});

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

// Привилегированная схема для загрузки локальных медиафайлов в renderer.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let win: BrowserWindow | null = null;

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icon.png')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'assets', 'icon.png');

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0D0D0D',
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(MAIN_DIST, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => {
    win?.show();
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

app.whenReady().then(() => {
  // media:///<encoded-abs-path> -> потоковая отдача локального файла с поддержкой Range.
  protocol.handle('media', async (request) => {
    const encoded = request.url.slice('media://'.length).replace(/^\/+/, '');
    let filePath = decodeURIComponent(encoded);
    // Относительные пути (assets/music/...) резолвим от корня приложения/ресурсов.
    if (!path.isAbsolute(filePath)) {
      const base = app.isPackaged
        ? process.resourcesPath
        : (process.env.APP_ROOT ?? process.cwd());
      filePath = path.join(base, filePath);
    }
    try {
      const stat = await fs.promises.stat(filePath);
      const total = stat.size;
      console.log('[media] req', request.headers.get('Range') || 'no-range', '->', filePath, total, 'bytes');
      const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      const rangeHeader = request.headers.get('Range');
      // Ограничение размера чанка: для открытых range (bytes=0-) не тянем весь
      // файл в память — отдаём кусок, <video> дозапросит остальное.
      const MAX_CHUNK = 4 * 1024 * 1024;

      let start = 0;
      let end = total - 1;
      let partial = false;
      if (rangeHeader) {
        const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        start = match ? parseInt(match[1], 10) : 0;
        const openEnded = !(match && match[2]);
        end = openEnded ? total - 1 : parseInt(match![2], 10);
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (end < start) end = start;
        if (openEnded && end - start + 1 > MAX_CHUNK) end = start + MAX_CHUNK - 1;
        partial = true;
      } else if (total > MAX_CHUNK) {
        end = MAX_CHUNK - 1;
        partial = true;
      }
      const len = end - start + 1;
      const data = new Uint8Array(len);
      const fd = await fs.promises.open(filePath, 'r');
      try {
        await fd.read(data, 0, len, start);
      } finally {
        await fd.close();
      }
      console.log('[media]', partial ? 206 : 200, `${start}-${end}/${total}`, path.basename(filePath));
      return new Response(data, {
        status: partial ? 206 : 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(len),
          ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      console.error('[media protocol] error', filePath, err);
      return new Response('Not found', { status: 404 });
    }
  });

  registerFileHandlers();
  registerAudioHandlers();
  registerFfmpegHandlers();
  registerVubHandlers();
  registerConfigHandlers();
  loadSettings();
  registerCleanerHandlers();
  registerStoreHandlers();
  registerTtsHandlers();
  registerSetupHandlers();
  registerDubHandlers();
  registerDownloadHandlers();
  registerFunnelHandlers();
  registerUpdaterHandlers();
  registerProExportHandlers();
  registerFeedbackHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
