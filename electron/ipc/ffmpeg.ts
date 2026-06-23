import { BrowserWindow, ipcMain } from 'electron';
import type ffmpeg from 'fluent-ffmpeg';
import { renderProject, type RenderRequest } from './ffmpegRender';

let currentCommand: ffmpeg.FfmpegCommand | null = null;
let cancelled = false;

export function registerFfmpegHandlers() {
  ipcMain.handle('ffmpeg:render', async (event, req: RenderRequest) => {
    cancelled = false;
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
