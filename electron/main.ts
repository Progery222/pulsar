import { app, BrowserWindow, dialog, Menu } from 'electron';
import { killAll } from './ipc/procRegistry';
import { handleMediaProtocol, registerMediaScheme } from './mediaProtocol';
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
import { registerTemplateHandlers } from './ipc/templateRender';
import { registerFeedbackHandlers } from './ipc/feedback';
import { registerRecorderHandlers } from './ipc/recorder';
import { registerAiVideoHandlers } from './ipc/aivideo';
import { registerSplitMergeHandlers } from './ipc/splitmerge';
import { registerMetadataHandlers } from './ipc/metadata';
import { registerImgOptHandlers } from './ipc/imgopt';

// dist-electron/main.js  -> __dirname = <root>/dist-electron
process.env.APP_ROOT = path.join(__dirname, '..');

// Диагностика краша Студии: логируем причину гибели рендер/дочерних процессов.
/**
 * Падения — с объяснением, а не молча.
 *
 * Без этих обработчиков исключение в main тихо убивало процесс (окно просто
 * исчезало), а крэш рендерера оставлял чёрное окно без единой надписи.
 * Отклонённые промисы только логируем: диалог на каждый был бы шумом.
 */
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err);
  // Дочерние ffmpeg/python иначе переживут нас и продолжат писать в файлы.
  killAll();
  try {
    dialog.showErrorBox(
      'Pulsar остановился',
      `Произошёл сбой, приложение будет закрыто.

${err?.stack ?? String(err)}`.slice(0, 2000),
    );
  } finally {
    app.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection:', reason);
});

app.on('render-process-gone', (_e, wc, details) => {
  console.error('[CRASH] render-process-gone:', JSON.stringify(details));
  // Окно не должно оставаться чёрным: перезагружаем и говорим, что случилось.
  if (details.reason !== 'clean-exit' && !wc.isDestroyed()) {
    wc.reload();
    wc.once('did-finish-load', () => {
      void wc.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('pulsar:recovered', { detail: ${JSON.stringify(details.reason)} }))`,
      ).catch(() => {});
    });
  }
});
app.on('child-process-gone', (_e, details) => {
  console.error('[CRASH] child-process-gone:', JSON.stringify(details));
});

/**
 * Ошибки интерфейса в терминал не попадают: React ломает дерево, окно чернеет,
 * а причина остаётся в консоли самого окна, куда без мышки не заглянуть.
 * Пробрасываем ошибки и предупреждения рендерера в общий лог.
 */
function pipeRendererLogs(wc: Electron.WebContents): void {
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level < 2) return; // 0 — verbose, 1 — info: шум
    const where = sourceId ? ` (${sourceId}:${line})` : '';
    console.error(`[UI] ${message}${where}`);
  });
  wc.on('unresponsive', () => console.error('[UI] окно перестало отвечать'));
}

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

// Привилегированная схема для загрузки локальных медиафайлов в renderer.
registerMediaScheme();

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
      // Не тормозить renderer при свёрнутом окне — иначе MediaRecorder «Записи экрана»
      // теряет кадры, пока наш UI свёрнут во время записи.
      backgroundThrottling: false,
    },
  });

  pipeRendererLogs(win.webContents);

  win.once('ready-to-show', () => {
    win?.show();
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // Меню снято ради Ctrl+R; DevTools в разработке — по F12.
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools();
    });
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.whenReady().then(() => {
  // Меню приложения не нужно, а дефолтное меню Electron — вредно: у него
  // Ctrl+R = перезагрузка окна, и она срабатывала раньше нашего Ctrl+R
  // «перемешать», теряя проект. Живы были и Ctrl+Shift+I, Ctrl+±.
  // В разработке DevTools остаются на F12.
  Menu.setApplicationMenu(null);

  handleMediaProtocol();

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
  registerTemplateHandlers();
  registerFeedbackHandlers();
  registerRecorderHandlers(() => win);
  registerImgOptHandlers();
  registerAiVideoHandlers();
  registerSplitMergeHandlers();
  registerMetadataHandlers();
  createWindow();
});

// Единственная точка, где гасятся все дочерние процессы: закрытие окна,
// app.quit(), relaunch после установки, quitAndInstall — всё проходит здесь.
app.on('before-quit', () => killAll());

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
