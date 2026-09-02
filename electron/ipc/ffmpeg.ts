import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import type ffmpeg from 'fluent-ffmpeg';
import { renderProject, type RenderRequest } from './ffmpegRender';

/**
 * Активные рендеры. Раньше был один глобальный флаг `cancelled` и один
 * `currentCommand`: второй параллельный рендер (повтор из истории, очередь)
 * сбрасывал флаг первому и перезаписывал команду — отмена убивала не тот
 * процесс, а первый оставался зомби. Теперь у каждого рендера своё состояние.
 */
interface Active { cmd: ffmpeg.FfmpegCommand | null; cancelled: boolean }
const active = new Map<number, Active>();
let nextId = 0;

// Резолв относительного пути аудио (assets/music/...) от корня приложения/ресурсов —
// без этого встроенные треки не находятся (CWD ≠ каталог ресурсов в собранном приложении).
function resolveAudioPath(audioPath: string | null): string | null {
  if (!audioPath || path.isAbsolute(audioPath)) return audioPath;
  const base = app.isPackaged ? process.resourcesPath : (process.env.APP_ROOT ?? process.cwd());
  return path.join(base, audioPath);
}

export function registerFfmpegHandlers() {
  ipcMain.handle('ffmpeg:render', async (event, req: RenderRequest) => {
    const id = ++nextId;
    const job: Active = { cmd: null, cancelled: false };
    active.set(id, job);
    req.audioFile = resolveAudioPath(req.audioFile);
    const sender = BrowserWindow.fromWebContents(event.sender);
    try {
      await renderProject(req, {
        onProgress: (p) => sender?.webContents.send('export-progress', p),
        getCancelled: () => job.cancelled,
        setCommand: (cmd) => {
          job.cmd = cmd;
        },
      });
      return { ok: true };
    } catch (err) {
      if (job.cancelled) return { cancelled: true };
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      active.delete(id);
    }
  });

  // Отмена экспорта (§14): прерывание FFmpeg-процесса. Без id — все активные:
  // интерфейс сейчас ведёт один экспорт за раз.
  ipcMain.handle('ffmpeg:cancel', (_e, id?: number) => {
    const targets = typeof id === 'number' ? [active.get(id)].filter(Boolean) : [...active.values()];
    for (const job of targets as Active[]) {
      job.cancelled = true;
      try {
        job.cmd?.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
    return { ok: true };
  });

  // На выходе — то же, что отмена: fluent-ffmpeg не в общем реестре процессов.
  app.on('before-quit', () => {
    for (const job of active.values()) {
      job.cancelled = true;
      try { job.cmd?.kill('SIGKILL'); } catch { /* noop */ }
    }
  });
}
