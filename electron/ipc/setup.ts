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

interface ProgressEvent {
  line?: string;
  percent?: number; // 0..100 текущей загрузки
  phase?: string; // имя пакета, который качается
}

function sendProgress(ev: ProgressEvent) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('setup-progress', ev));
}

// Извлечь процент из вывода pip: "45.2/203.1 MB" либо завершающий "NN%".
function parsePercent(s: string): number | null {
  const mb = [...s.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*MB/g)];
  if (mb.length) {
    const m = mb[mb.length - 1];
    const done = parseFloat(m[1]);
    const total = parseFloat(m[2]);
    if (total > 0) return Math.min(100, (done / total) * 100);
  }
  const pct = [...s.matchAll(/(\d{1,3})%/g)];
  if (pct.length) return Math.min(100, parseInt(pct[pct.length - 1][1], 10));
  return null;
}

// Содержательные строки лога (без спама прогресс-бара pip с \r).
function meaningfulLine(s: string): string | null {
  for (const part of s.split(/[\r\n]+/)) {
    const t = part.trim();
    if (/^(Collecting|Downloading|Installing|Building|Successfully|Requirement|Using cached|ERROR|WARNING)/i.test(t)) {
      return t;
    }
  }
  return null;
}

// Установка движка через pip (стриминг прогресса в renderer).
function installEngine(engine: string): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const pkgs = PIP_PACKAGE[engine];
    if (!pkgs) {
      resolve({ error: `Неизвестный движок: ${engine}` });
      return;
    }
    sendProgress({ line: `Устанавливаю: pip install ${pkgs.join(' ')} …`, percent: 0 });
    const child = spawn(pyCmd(), ['-m', 'pip', 'install', '--upgrade', ...pkgs]);
    const handle = (chunk: Buffer) => {
      const s = chunk.toString();
      const ev: ProgressEvent = {};
      const pct = parsePercent(s);
      if (pct != null) ev.percent = pct;
      const line = meaningfulLine(s);
      if (line) {
        ev.line = line;
        const dl = /^Downloading\s+([^\s(]+)/i.exec(line);
        if (dl) ev.phase = dl[1];
      }
      if (ev.line || ev.percent != null) sendProgress(ev);
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => resolve({ error: err.message }));
    child.on('close', (code) => {
      if (code === 0) {
        sendProgress({ line: 'Готово. Движок установлен.', percent: 100 });
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
