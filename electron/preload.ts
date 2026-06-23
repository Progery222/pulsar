import { contextBridge, ipcRenderer } from 'electron';
import type { BeatData } from '../src/types';

// IPC bridge между renderer и main процессами (contextBridge).
const electronAPI = {
  // Системные диалоги выбора файлов (§5.2, §5.3).
  selectVideos: (): Promise<string[]> => ipcRenderer.invoke('dialog:selectVideos'),
  selectAudio: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectAudio'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  // Анализ аудио (beat detection через Python) — §9.1.
  analyzeAudio: (audioPath: string): Promise<BeatData | { error: string }> =>
    ipcRenderer.invoke('analyze-audio', audioPath),

  // Рендеринг видео (§10).
  renderVideo: (
    request: unknown
  ): Promise<{ ok: true } | { error: string } | { cancelled: true }> =>
    ipcRenderer.invoke('ffmpeg:render', request),
  cancelRender: (): Promise<{ ok: true }> => ipcRenderer.invoke('ffmpeg:cancel'),
  onExportProgress: (cb: (percent: number) => void): (() => void) => {
    const listener = (_e: unknown, percent: number) => cb(percent);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },

  // Открыть папку в проводнике (§11).
  openFolder: (folderPath: string): Promise<string> =>
    ipcRenderer.invoke('shell:openPath', folderPath),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
