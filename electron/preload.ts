import { contextBridge, ipcRenderer } from 'electron';

// IPC bridge между renderer и main процессами.
// Конкретные методы (analyzeAudio, выбор файлов, рендеринг) добавляются на
// последующих шагах. Здесь задаётся безопасный мост через contextBridge.
const electronAPI = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const subscription = (_event: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, subscription as never);
    return () => ipcRenderer.removeListener(channel, subscription as never);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
