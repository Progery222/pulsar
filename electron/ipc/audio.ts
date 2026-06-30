import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
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
  const base = app.isPackaged
    ? process.resourcesPath
    : (process.env.APP_ROOT ?? process.cwd());
  return path.join(base, audioPath);
}

// IPC-канал analyze-audio: запуск beat_detect.py через spawn, парсинг JSON, таймаут 30с.
export function registerAudioHandlers() {
  ipcMain.handle('analyze-audio', async (_event, audioPath: string) => {
    return new Promise((resolve) => {
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const ffDir = ffmpegDir();
      const env = ffDir
        ? { ...process.env, PATH: `${ffDir}${path.delimiter}${process.env.PATH ?? ''}` }
        : process.env;
      const child = spawn(pythonCmd, [scriptPath(), resolveAudioPath(audioPath)], { env });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        resolve({ error: 'Python beat detection timeout (40s)' });
      }, 40000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
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
    });
  });
}
