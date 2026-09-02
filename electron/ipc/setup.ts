import { app, BrowserWindow, ipcMain, shell } from 'electron';
// spawn через реестр: дочерние процессы гасятся при выходе и крэше (procRegistry).
import type { ChildProcess } from 'node:child_process';
import { killTree, spawnTracked as spawn } from './procRegistry';
import path from 'node:path';
import { resolvePython, forgetPython, spawnPython } from './python';
import { hasNvidiaGpu } from './omnivoice';

function ttsScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'tts.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'tts.py');
}

function pyScript(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', name)
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', name);
}

// pip-пакет для каждого движка озвучки (OmniVoice ставится отдельной цепочкой — см. installOmniVoice).
const PIP_PACKAGE: Record<string, string[]> = {
  edge: ['edge-tts'],
  translate: ['deep-translator'],
  download: ['yt-dlp'],
  whisper: ['faster-whisper'],
  upscale: ['onnxruntime', 'pillow', 'numpy'],
};

interface SetupStatus {
  pythonOk: boolean;
  pythonVersion?: string;
  engines?: Record<string, boolean>;
  cuda?: boolean | null; // видит ли PyTorch видеокарту (null — PyTorch не установлен)
  error?: string;
}

async function checkStatus(): Promise<SetupStatus> {
  // Сначала ищем реальный интерпретатор: раньше spawn('python') попадал в
  // заглушку Microsoft Store, та молчала, и Python считался ненайденным —
  // вместе с ним блокировалась установка всех остальных движков.
  const py = await resolvePython();
  if (!py) return { pythonOk: false, error: 'Python не найден' };

  return new Promise((resolve) => {
    const child = spawn(py.cmd, [...py.args, ttsScript(), 'check'], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', () => resolve({ pythonOk: false, error: 'Python не найден' }));
    child.on('close', () => {
      try {
        // Ответ — последняя JSON-строка (библиотеки могут шуметь в stdout).
        const line = stdout.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{')) ?? '';
        const r = JSON.parse(line);
        resolve({ pythonOk: true, pythonVersion: r.python ?? py.version, engines: r.engines, cuda: r.cuda ?? null });
      } catch {
        // Python есть, но проверочный скрипт не отработал — это другая беда,
        // и говорить про «не найден» здесь было бы неправдой.
        resolve({
          pythonOk: true,
          pythonVersion: py.version,
          engines: {},
          error: 'Python ' + py.version + ' найден, но проверка движков не отработала: ' + (stderr.trim().slice(-200) || 'нет вывода'),
        });
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

// Содержательные строки лога (без спама прогресс-бара pip: глифы, скорость, eta).
function meaningfulLines(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/[\r\n]+/)) {
    const t = part.trim();
    if (!t) continue;
    if (/MB\/s|kB\/s|GB\/s|eta\s|━|╸|─|█|▒|░|[KMG]B\s*\/\s*\d/.test(t)) continue; // строки прогресс-бара
    out.push(t);
  }
  return out;
}

// Загрузчик модели (download_*.py) со стримингом прогресса: строки "PROGRESS x/y MB"
// (наш загрузчик Whisper) и бары tqdm huggingface_hub ("model.safetensors:  45%|███ | …").
function runDownloader(script: string, args: string[], startLine: string, failMsg: string): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    sendProgress({ line: startLine });
    void (async () => {
    const child = (current = await spawnPython(['-u', pyScript(script), ...args], {
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    }));
    const handle = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/[\r\n]+/)) {
        const t = line.trim();
        if (!t) continue;
        const mb = /PROGRESS\s+([\d.]+)\/([\d.]+)\s*MB/.exec(t);
        if (mb) {
          const done = parseFloat(mb[1]);
          const total = parseFloat(mb[2]);
          if (total > 0) sendProgress({ percent: Math.min(100, (done / total) * 100), line: `Модель: ${Math.round(done)}/${Math.round(total)} МБ` });
          continue;
        }
        if (t.includes('|')) {
          const pct = parsePercent(t);
          if (pct != null) sendProgress({ percent: pct, phase: t.split(':')[0].trim().slice(0, 40) });
          continue;
        }
        if (t !== 'MODEL_READY') sendProgress({ line: t });
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => resolve({ error: `Загрузчик модели недоступен: ${err.message}` }));
    child.on('close', (code) => (code === 0 ? resolve({ ok: true }) : resolve({ error: `${failMsg} (код ${code})` })));
    })().catch((err) => resolve({ error: (err as Error).message }));
  });
}

function downloadWhisperModel() {
  return runDownloader('download_whisper.py', ['--model', 'small'], 'Скачиваю модель распознавания (Whisper)…', 'Не удалось скачать модель Whisper');
}

/** Текущий процесс установки — чтобы пользователь мог её остановить. */
let current: ChildProcess | null = null;

// pip install со стримингом прогресса в renderer.
function runPip(pkgs: string[], extra: string[] = []): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    sendProgress({ line: `Устанавливаю: pip install ${[...extra, ...pkgs].join(' ')} …` });
    void (async () => {
    const child = (current = await spawnPython(
      ['-u', '-m', 'pip', 'install', '--upgrade', '--progress-bar', 'on', ...extra, ...pkgs],
      { env: { ...process.env, PYTHONUNBUFFERED: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' } }
    ));
    const handle = (chunk: Buffer) => {
      const s = chunk.toString();
      const pct = parsePercent(s);
      const lines = meaningfulLines(s);
      if (lines.length) {
        for (const line of lines) {
          const ev: ProgressEvent = { line };
          const dl = /Downloading\s+([^\s(]+)/i.exec(line);
          if (dl) ev.phase = dl[1];
          sendProgress(ev);
        }
      }
      if (pct != null) sendProgress({ percent: pct });
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => {
      sendProgress({ line: `Не удалось запустить Python/pip: ${err.message}` });
      resolve({ error: err.message });
    });
    child.on('close', (code) => (code === 0 ? resolve({ ok: true }) : resolve({ error: `pip завершился с кодом ${code}` })));
    })().catch((err) => resolve({ error: (err as Error).message }));
  });
}

// OmniVoice: PyTorch (CUDA 12.8 при NVIDIA, иначе CPU-сборка) → пакет omnivoice → веса модели (~2.5 ГБ).
async function installOmniVoice(): Promise<{ ok: true } | { error: string }> {
  const nvidia = await hasNvidiaGpu();
  sendProgress({
    line: nvidia
      ? 'Найдена видеокарта NVIDIA — ставлю PyTorch с CUDA 12.8 (~3 ГБ).'
      : 'Видеокарта NVIDIA не найдена — ставлю PyTorch для процессора (озвучка будет заметно медленнее).',
  });
  const torch = await runPip(['torch', 'torchaudio'], nvidia ? ['--index-url', 'https://download.pytorch.org/whl/cu128'] : []);
  if ('error' in torch) return torch;
  const pkgs = await runPip(['omnivoice', 'soundfile', 'huggingface_hub']);
  if ('error' in pkgs) return pkgs;
  const model = await runDownloader('download_omnivoice.py', [], 'Скачиваю модель OmniVoice (~2.5 ГБ)…', 'Не удалось скачать модель OmniVoice');
  if ('error' in model) return model;
  sendProgress({ line: 'Готово. OmniVoice установлен.', percent: 100 });
  return { ok: true };
}

// Установка движка (стриминг прогресса в renderer).
async function installEngine(engine: string): Promise<{ ok: true } | { error: string }> {
  if (engine === 'omnivoice') return installOmniVoice();
  const pkgs = PIP_PACKAGE[engine];
  if (!pkgs) return { error: `Неизвестный движок: ${engine}` };
  const p = await runPip(pkgs);
  if ('error' in p) return p;
  // Whisper: после пакета сразу скачиваем модель (иначе распознавание не заработает).
  if (engine === 'whisper') {
    const m = await downloadWhisperModel();
    if ('error' in m) return m;
  }
  sendProgress({ line: 'Готово. Движок установлен.', percent: 100 });
  return { ok: true };
}

// Установка Python через winget (Windows). После — нужен перезапуск (обновление PATH).
function installPython(): Promise<{ needsRestart: true } | { error: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ error: 'Автоустановка только для Windows. Установите Python 3.10+ с python.org' });
      return;
    }
    sendProgress({ line: 'Устанавливаю Python через winget…' });
    const child = spawn(
      'winget',
      ['install', '-e', '--id', 'Python.Python.3.12', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
      { env: { ...process.env } }
    );
    const handle = (chunk: Buffer) => {
      const s = chunk.toString();
      const pct = parsePercent(s);
      for (const line of meaningfulLines(s)) sendProgress({ line });
      if (pct != null) sendProgress({ percent: pct });
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => {
      sendProgress({ line: `winget недоступен: ${err.message}. Откройте python.org вручную.` });
      resolve({ error: 'winget недоступен' });
    });
    child.on('close', (code) => {
      if (code === 0) {
        // Кэш сбрасываем: вдруг интерпретатор появится и без перезапуска.
        forgetPython();
        sendProgress({ line: 'Python установлен. Перезапустите приложение.', percent: 100 });
        resolve({ needsRestart: true });
      } else {
        resolve({ error: `winget завершился с кодом ${code}` });
      }
    });
  });
}

export function registerSetupHandlers() {
  // Ищем интерпретатор заранее: дальше все модули берут готовый путь синхронно.
  void resolvePython();

  ipcMain.handle('setup:status', () => checkStatus());
  ipcMain.handle('setup:install', (_e, engine: string) => installEngine(engine));
  ipcMain.handle('setup:installPython', () => installPython());
  // Отмена установки: раньше 5 ГБ PyTorch нельзя было остановить — только ждать.
  ipcMain.handle('setup:cancel', () => {
    if (current) {
      killTree(current);
      current = null;
      sendProgress({ line: 'Установка остановлена.' });
    }
    return { ok: true };
  });
  ipcMain.handle('setup:openPythonSite', () => shell.openExternal('https://www.python.org/downloads/'));
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });
}
