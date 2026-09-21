import { app, BrowserWindow, dialog, Menu } from 'electron';
import path from 'node:path';
import { handleMediaProtocol, registerMediaScheme } from './mediaProtocol';
import { registerMetadataHandlers } from './ipc/metadata';
import { runSmoke } from './metadata-smoke';

/**
 * Отдельное приложение «Pulsar Метаданные» — только модуль метаданных, без
 * остального Pulsar. Собирается своим конфигом (vite.metadata.config.ts,
 * electron-builder.metadata.json), в первую очередь под macOS.
 *
 * `--smoke <папка>` — проверка собранного приложения без окна: пишет и читает
 * метаданные файлов из папки и выходит с кодом 0/1. Её гоняет CI на маке.
 */

// dist-metadata-electron/metadata-main.js -> __dirname = <root>/dist-metadata-electron
process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist-metadata');

// Свои настройки и пресеты, отдельно от Pulsar.
app.setPath('userData', path.join(app.getPath('appData'), 'Pulsar Metadata'));

process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err);
  try {
    dialog.showErrorBox('Pulsar Метаданные остановились', `Произошёл сбой, приложение будет закрыто.\n\n${err?.stack ?? String(err)}`.slice(0, 2000));
  } finally {
    app.exit(1);
  }
});

registerMediaScheme();

let win: BrowserWindow | null = null;

function createWindow(show = true): BrowserWindow {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0D0D0D',
    title: 'Pulsar Метаданные',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`[UI] ${message}`);
  });
  if (show) win.once('ready-to-show', () => win?.show());

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(new URL('metadata.html', VITE_DEV_SERVER_URL).toString());
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools();
    });
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'metadata.html'));
  }
  return win;
}

app.whenReady().then(async () => {
  // На маке без меню не работают Cmd+C/V/A в полях и Cmd+Q — оставляем
  // стандартные «Правка» и «Окно». Перезагрузки окна (Cmd+R) там нет.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  );
  handleMediaProtocol();
  registerMetadataHandlers();

  const smokeAt = process.argv.indexOf('--smoke');
  if (smokeAt !== -1) {
    const ok = await runSmoke(process.argv[smokeAt + 1] ?? '', () => createWindow(false));
    app.exit(ok ? 0 : 1);
    return;
  }
  createWindow();
});

// Утилита в одно окно: закрыли окно — закрыли программу, и на маке тоже.
app.on('window-all-closed', () => app.quit());
