import { contextBridge, ipcRenderer } from 'electron';
import type { BeatData } from '../src/types';
import type { VubProcessRequest, VubProgressEvent } from '../src/vub/types';

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

  // --- Модуль VUB (§4–5 ТЗ VUB) ---
  selectWatermark: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectWatermark'),
  getVubApiKey: (): Promise<string> => ipcRenderer.invoke('vub:getKey'),
  setVubApiKey: (key: string): Promise<{ ok: true }> => ipcRenderer.invoke('vub:setKey', key),
  testVubTranscribe: (
    videoPath: string,
    language: string
  ): Promise<{ ok: true; count: number; text: string } | { error: string }> =>
    ipcRenderer.invoke('vub:testTranscribe', videoPath, language),
  onVubWarning: (cb: (message: string) => void): (() => void) => {
    const listener = (_e: unknown, message: string) => cb(message);
    ipcRenderer.on('vub-warning', listener);
    return () => ipcRenderer.removeListener('vub-warning', listener);
  },
  processVub: (request: VubProcessRequest): Promise<{ ok: true }> =>
    ipcRenderer.invoke('vub:process', request),
  cancelVub: (): Promise<{ ok: true }> => ipcRenderer.invoke('vub:cancel'),
  onVubProgress: (cb: (event: VubProgressEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: VubProgressEvent) => cb(event);
    ipcRenderer.on('vub-progress', listener);
    return () => ipcRenderer.removeListener('vub-progress', listener);
  },

  // --- Режим «Замена титров» ---
  processCleaner: (request: unknown): Promise<{ ok: true }> =>
    ipcRenderer.invoke('cleaner:process', request),
  detectCleanerOne: (
    payload: { videoPath: string; detectTitles: boolean; detectWatermarks: boolean }
  ): Promise<{ width: number; height: number; boxes: { x: number; y: number; w: number; h: number; conf?: number }[]; error?: string }> =>
    ipcRenderer.invoke('cleaner:detectOne', payload),
  cancelCleaner: (): Promise<{ ok: true }> => ipcRenderer.invoke('cleaner:cancel'),
  onCleanerProgress: (
    cb: (e: { id: string; status: string; percent: number; info?: string }) => void
  ): (() => void) => {
    const listener = (_e: unknown, payload: { id: string; status: string; percent: number; info?: string }) =>
      cb(payload);
    ipcRenderer.on('cleaner-progress', listener);
    return () => ipcRenderer.removeListener('cleaner-progress', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
