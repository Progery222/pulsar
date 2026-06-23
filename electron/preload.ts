import { contextBridge, ipcRenderer } from 'electron';
import type { BeatData } from '../src/types';

// IPC bridge между renderer и main процессами (contextBridge).
const electronAPI = {
  // Системные диалоги выбора файлов (§5.2, §5.3).
  selectVideos: (): Promise<string[]> => ipcRenderer.invoke('dialog:selectVideos'),
  selectAudio: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectAudio'),

  // Анализ аудио (beat detection через Python) — §9.1.
  analyzeAudio: (audioPath: string): Promise<BeatData | { error: string }> =>
    ipcRenderer.invoke('analyze-audio', audioPath),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
