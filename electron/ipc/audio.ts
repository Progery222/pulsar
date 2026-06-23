import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Путь к Python-скрипту (dev vs упакованное приложение).
function scriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'beat_detect.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'beat_detect.py');
}

// IPC-канал analyze-audio: запуск beat_detect.py через spawn, парсинг JSON, таймаут 30с.
export function registerAudioHandlers() {
  ipcMain.handle('analyze-audio', async (_event, audioPath: string) => {
    return new Promise((resolve) => {
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const child = spawn(pythonCmd, [scriptPath(), audioPath]);

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        resolve({ error: 'Python beat detection timeout (30s)' });
      }, 30000);

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
