import { dialog, ipcMain, shell } from 'electron';

// IPC-обработчики для файловой системы: системные диалоги выбора файлов.
export function registerFileHandlers() {
  // Выбор видеофайлов (§5.2): фильтр .mp4, .mov, .avi
  ipcMain.handle('dialog:selectVideos', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'avi'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // Выбор аудиофайла (§5.3): фильтр .mp3, .wav, .aac
  ipcMain.handle('dialog:selectAudio', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Аудио', extensions: ['mp3', 'wav', 'aac'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Выбор файла водяного знака VUB (§4.5): PNG, GIF, MP4.
  ipcMain.handle('dialog:selectWatermark', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Водяной знак', extensions: ['png', 'gif', 'mp4'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Выбор папки для экспорта (§11).
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Открыть папку в проводнике Windows (§11).
  ipcMain.handle('shell:openPath', async (_event, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  // Показать файл в проводнике (с выделением).
  ipcMain.handle('shell:showItem', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
}
