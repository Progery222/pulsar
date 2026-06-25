import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';

function ttsScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'tts.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'tts.py');
}

function pyCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

// pip-пакет для каждого движка озвучки.
const PIP_PACKAGE: Record<string, string[]> = {
  xtts: ['coqui-tts'],
  silero: ['silero', 'torch', 'soundfile'],
  kokoro: ['kokoro', 'soundfile'],
};

interface SetupStatus {
  pythonOk: boolean;
  pythonVersion?: string;
  engines?: Record<string, boolean>;
  error?: string;
}

function checkStatus(): Promise<SetupStatus> {
  return new Promise((resolve) => {
    const child = spawn(pyCmd(), [ttsScript(), 'check']);
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.on('error', () => resolve({ pythonOk: false, error: 'Python не найден' }));
    child.on('close', () => {
      try {
        const r = JSON.parse(stdout.trim());
        resolve({ pythonOk: true, pythonVersion: r.python, engines: r.engines });
      } catch {
        resolve({ pythonOk: false, error: 'Python не найден или недоступен' });
      }
    });
  });
}

function sendProgress(line: string) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('setup-progress', line));
}

// Установка движка через pip (стриминг логов в renderer).
function installEngine(engine: string): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const pkgs = PIP_PACKAGE[engine];
    if (!pkgs) {
      resolve({ error: `Неизвестный движок: ${engine}` });
      return;
    }
    sendProgress(`Устанавливаю: pip install ${pkgs.join(' ')} …`);
    const child = spawn(pyCmd(), ['-m', 'pip', 'install', '--upgrade', ...pkgs]);
    child.stdout.on('data', (c) => sendProgress(c.toString().trimEnd()));
    child.stderr.on('data', (c) => sendProgress(c.toString().trimEnd()));
    child.on('error', (err) => resolve({ error: err.message }));
    child.on('close', (code) => {
      if (code === 0) {
        sendProgress('Готово. Движок установлен.');
        resolve({ ok: true });
      } else {
        resolve({ error: `pip завершился с кодом ${code}` });
      }
    });
  });
}

export function registerSetupHandlers() {
  ipcMain.handle('setup:status', () => checkStatus());
  ipcMain.handle('setup:install', (_e, engine: string) => installEngine(engine));
}
