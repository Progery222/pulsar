import { app, BrowserWindow, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { registerFileHandlers } from './ipc/files';
import { registerAudioHandlers } from './ipc/audio';
import { registerFfmpegHandlers } from './ipc/ffmpeg';
import { registerVubHandlers } from './ipc/vub';

// dist-electron/main.js  -> __dirname = <root>/dist-electron
process.env.APP_ROOT = path.join(__dirname, '..');

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
      const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      const rangeHeader = request.headers.get('Range');

      if (rangeHeader) {
        const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  registerFileHandlers();
  registerAudioHandlers();
  registerFfmpegHandlers();
  registerVubHandlers();
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
