import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// IPC модуля «Изображения» (оптимизатор): сохранение обработанных файлов в папку.
export function registerImgOptHandlers() {
  // Записать один файл в папку (имя санитизируется, только внутри выбранной папки).
  ipcMain.handle('img:writeFile', async (_e, dir: string, name: string, data: ArrayBuffer) => {
    try {
      if (!dir) return { error: 'нет папки' };
      const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) || 'image';
      const out = path.join(dir, safe);
      // Не даём выйти за пределы папки.
      if (!path.resolve(out).startsWith(path.resolve(dir))) return { error: 'bad path' };
      await fs.promises.writeFile(out, Buffer.from(data));
      return { ok: true as const, path: out };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
}
