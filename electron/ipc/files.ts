import { dialog, ipcMain } from 'electron';

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
}
