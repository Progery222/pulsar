import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'node:fs';
import path from 'node:path';

// Папка с встроенным ffmpeg — добавляем её в PATH питон-процесса, иначе librosa
// не может декодировать часть аудиоформатов (audioread backend ищет `ffmpeg` в PATH).
function ffmpegDir(): string | null {
  const p = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
  return p ? path.dirname(p) : null;
}

// Путь к Python-скрипту (dev vs упакованное приложение).
function scriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'beat_detect.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'beat_detect.py');
}

// Резолв относительного пути аудио (assets/music/...) от корня приложения/ресурсов.
function resolveAudioPath(audioPath: string): string {
  if (path.isAbsolute(audioPath)) return audioPath;
  const base = app.isPackaged ? process.resourcesPath : (process.env.APP_ROOT ?? process.cwd());
  return path.join(base, audioPath);
}

// ── Кэш бит-детекта: один и тот же трек распознаётся один раз ──────────────────
function cachePath(): string {
  return path.join(app.getPath('userData'), 'beat-cache.json');
}
function readCache(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf-8'));
  } catch {
    return {};
  }
}
function writeCache(c: Record<string, unknown>): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(c));
  } catch {
    /* noop */
  }
}
// Ключ по идентичности файла (путь + размер + дата изменения).
function fileKey(p: string): string | null {
  try {
    const st = fs.statSync(p);
    return `${p}|${st.size}|${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

// Кандидаты команды Python: лаунчер `py -3` (надёжнее Store-алиаса `python.exe`,
// который при spawn из GUI иногда зависает), затем обычные python/python3.
function pythonCandidates(): string[][] {
  return process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']];
}

// Запуск beat_detect.py перебором кандидатов Python (ENOENT -> следующий).
function runBeat(audioPath: string): Promise<unknown> {
  const ffDir = ffmpegDir();
  const env = ffDir ? { ...process.env, PATH: `${ffDir}${path.delimiter}${process.env.PATH ?? ''}` } : process.env;
  const candidates = pythonCandidates();

  return new Promise((resolve) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= candidates.length) {
        resolve({ error: 'Python не найден. Установите Python (мастер настройки).' });
        return;
      }
      const [cmd, ...pre] = candidates[idx++];
      const child = spawn(cmd, [...pre, scriptPath(), audioPath], { env });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve({ error: 'Python beat detection timeout (40s)' });
      }, 40000);
      child.stdout.on('data', (c) => (stdout += c.toString()));
      child.stderr.on('data', (c) => (stderr += c.toString()));
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          tryNext(); // эта команда не существует — пробуем следующую
          return;
        }
        resolve({ error: err.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ error: stderr.trim() || `Python exited with code ${code}` });
        }
      });
    };
    tryNext();
  });
}

// Прогрев librosa в фоне: импорт модулей (в RAM-кэш ОС) + разовая JIT-компиляция
// numba (кэшируется на диск и переиспользуется даже холодными процессами). Убирает
// основную часть ~16с холодного старта при ПЕРВОМ реальном анализе.
let warmed = false;
function warmUpBeatDetection(): void {
  if (warmed) return;
  warmed = true;
  const ffDir = ffmpegDir();
  const env = ffDir ? { ...process.env, PATH: `${ffDir}${path.delimiter}${process.env.PATH ?? ''}` } : process.env;
  const candidates = pythonCandidates();
  const code =
    'import numpy as np, librosa; y=np.random.default_rng(0).standard_normal(44100).astype("float32"); librosa.beat.beat_track(y=y, sr=22050)';
  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) return;
    const [cmd, ...pre] = candidates[idx++];
    try {
      const child = spawn(cmd, [...pre, '-c', code], { env, stdio: 'ignore' });
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') tryNext();
      });
    } catch {
      /* прогрев не критичен */
    }
  };
  tryNext();
}

// Дедуп одновременных запросов: предзагрузка (при выборе трека) и основной
// анализ (по «Далее») для одного файла разделяют один процесс, а не спавнят два.
const inflight = new Map<string, Promise<unknown>>();

export function registerAudioHandlers() {
  // Прогрев в фоне через 3с после старта — не конкурирует с запуском окна.
  setTimeout(warmUpBeatDetection, 3000);

  ipcMain.handle('analyze-audio', async (_event, audioPath: string) => {
    const resolved = resolveAudioPath(audioPath);
    const key = fileKey(resolved);

    // Кэш: тот же трек уже распознан -> мгновенно.
    if (key) {
      const cache = readCache();
      if (cache[key]) return cache[key];
    }

    // Уже идёт анализ этого файла — дождаться того же процесса.
    const flightKey = key ?? resolved;
    const existing = inflight.get(flightKey);
    if (existing) return existing;

    const p = runBeat(resolved).finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, p);
    const result = await p;

    // Кэшируем только удачный результат (есть биты).
    const r = result as { beat_times?: unknown[]; error?: string };
    if (key && r && !r.error && Array.isArray(r.beat_times) && r.beat_times.length) {
      const cache = readCache();
      cache[key] = result;
      writeCache(cache);
    }
    return result;
  });
}
