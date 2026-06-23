import { contextBridge, ipcRenderer } from 'electron';

// IPC bridge между renderer и main процессами (contextBridge).
const electronAPI = {
  // Системные диалоги выбора файлов (§5.2, §5.3).
  selectVideos: (): Promise<string[]> => ipcRenderer.invoke('dialog:selectVideos'),
  selectAudio: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectAudio'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
