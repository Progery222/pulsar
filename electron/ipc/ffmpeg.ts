import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import type ffmpeg from 'fluent-ffmpeg';
import { renderProject, type RenderRequest } from './ffmpegRender';

let currentCommand: ffmpeg.FfmpegCommand | null = null;
let cancelled = false;

// Резолв относительного пути аудио (assets/music/...) от корня приложения/ресурсов —
// без этого встроенные треки не находятся (CWD ≠ каталог ресурсов в собранном приложении).
function resolveAudioPath(audioPath: string | null): string | null {
  if (!audioPath || path.isAbsolute(audioPath)) return audioPath;
  const base = app.isPackaged ? process.resourcesPath : (process.env.APP_ROOT ?? process.cwd());
  return path.join(base, audioPath);
}

export function registerFfmpegHandlers() {
  ipcMain.handle('ffmpeg:render', async (event, req: RenderRequest) => {
    cancelled = false;
    req.audioFile = resolveAudioPath(req.audioFile);
    const sender = BrowserWindow.fromWebContents(event.sender);
    try {
      await renderProject(req, {
        onProgress: (p) => sender?.webContents.send('export-progress', p),
        getCancelled: () => cancelled,
        setCommand: (cmd) => {
          currentCommand = cmd;
        },
      });
      return { ok: true };
    } catch (err) {
      if (cancelled) return { cancelled: true };
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Отмена экспорта (§14): прерывание FFmpeg-процесса.
  ipcMain.handle('ffmpeg:cancel', () => {
    cancelled = true;
    try {
      currentCommand?.kill('SIGKILL');
    } catch {
      /* noop */
    }
    return { ok: true };
  });
}
