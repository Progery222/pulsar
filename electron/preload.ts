import { contextBridge, ipcRenderer } from 'electron';
import type { BeatData } from '../src/types';
import type { VubProcessRequest, VubProgressEvent } from '../src/vub/types';
import type { FunnelStartRequest, FunnelProgressEvent } from '../src/funnel/types';

// IPC bridge между renderer и main процессами (contextBridge).
const electronAPI = {
  // Системные диалоги выбора файлов (§5.2, §5.3).
  selectVideos: (): Promise<string[]> => ipcRenderer.invoke('dialog:selectVideos'),
  selectAudio: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectAudio'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  // Листинг директории для бокового файлового проводника (dir null = диски/home).
  listDir: (
    dir: string | null
  ): Promise<{ entries: { name: string; path: string; isDir: boolean }[]; parent: string | null; home: string; error?: string }> =>
    ipcRenderer.invoke('fs:listDir', dir),

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

  // Показать файл в проводнике с выделением.
  showItemInFolder: (filePath: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('shell:showItem', filePath),

  // Режим GPU-кодирования (auto/gpu/cpu).
  getGpuMode: (): Promise<'auto' | 'gpu' | 'cpu'> => ipcRenderer.invoke('settings:getGpuMode'),
  setGpuMode: (mode: 'auto' | 'gpu' | 'cpu'): Promise<{ ok: true }> =>
    ipcRenderer.invoke('settings:setGpuMode', mode),

  // Выход из приложения.
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  // Авто-обновление по интернету.
  appVersion: (): Promise<string> => ipcRenderer.invoke('update:version'),
  checkUpdate: (): Promise<{ ok: true; version: string | null } | { error: string }> =>
    ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<{ ok: true } | { error: string }> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<{ ok: true }> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (
    cb: (s: { state: string; version?: string; percent?: number; error?: string }) => void
  ): (() => void) => {
    const listener = (_e: unknown, s: { state: string; version?: string; percent?: number; error?: string }) => cb(s);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },

  // Универсальные настройки приложения.
  getSetting: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown): Promise<{ ok: true }> =>
    ipcRenderer.invoke('settings:set', key, value),

  // Озвучка (TTS).
  ttsEngines: (): Promise<{ ok: true; engines: Record<string, string> } | { error: string }> =>
    ipcRenderer.invoke('tts:engines'),
  ttsSynth: (
    request: unknown
  ): Promise<{ ok: true; out: string } | { error: string }> => ipcRenderer.invoke('tts:synth', request),
  ttsSample: (
    request: unknown
  ): Promise<{ ok: true; out: string } | { error: string }> => ipcRenderer.invoke('tts:sample', request),

  // Дубляж видео.
  dubRun: (request: unknown): Promise<{ ok: true; out: string } | { error: string }> =>
    ipcRenderer.invoke('dub:run', request),
  onDubProgress: (cb: (e: { stage: string; percent: number }) => void): (() => void) => {
    const listener = (_e: unknown, ev: { stage: string; percent: number }) => cb(ev);
    ipcRenderer.on('dub-progress', listener);
    return () => ipcRenderer.removeListener('dub-progress', listener);
  },

  // Первичная настройка / установка движков.
  setupStatus: (): Promise<{ pythonOk: boolean; pythonVersion?: string; engines?: Record<string, boolean>; error?: string }> =>
    ipcRenderer.invoke('setup:status'),
  setupInstall: (engine: string): Promise<{ ok: true } | { error: string }> =>
    ipcRenderer.invoke('setup:install', engine),
  setupInstallPython: (): Promise<{ needsRestart: true } | { error: string }> =>
    ipcRenderer.invoke('setup:installPython'),
  openPythonSite: (): Promise<void> => ipcRenderer.invoke('setup:openPythonSite'),
  relaunchApp: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  onSetupProgress: (cb: (ev: { line?: string; percent?: number; phase?: string }) => void): (() => void) => {
    const listener = (_e: unknown, ev: { line?: string; percent?: number; phase?: string }) => cb(ev);
    ipcRenderer.on('setup-progress', listener);
    return () => ipcRenderer.removeListener('setup-progress', listener);
  },

  // История выполненных задач.
  historyList: (): Promise<unknown[]> => ipcRenderer.invoke('history:list'),
  historyAdd: (entry: unknown): Promise<{ ok: true }> => ipcRenderer.invoke('history:add', entry),
  historyRemove: (id: string): Promise<{ ok: true }> => ipcRenderer.invoke('history:remove', id),
  historyClear: (): Promise<{ ok: true }> => ipcRenderer.invoke('history:clear'),

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

  // Скачивание видео по ссылке (TikTok, YouTube, Instagram, …). baseDir — необязательная папка.
  downloadVideo: (url: string, baseDir?: string): Promise<{ ok: true; path: string } | { error: string }> =>
    ipcRenderer.invoke('download:url', url, baseDir),
  onDownloadProgress: (
    cb: (e: { stage?: string; percent?: number; line?: string }) => void
  ): (() => void) => {
    const listener = (_e: unknown, ev: { stage?: string; percent?: number; line?: string }) => cb(ev);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },

  // --- Модуль «Воронка» (Funnel) ---
  getOpenRouterKey: (): Promise<string> => ipcRenderer.invoke('funnel:getKey'),
  setOpenRouterKey: (key: string): Promise<{ ok: true }> => ipcRenderer.invoke('funnel:setKey', key),
  funnelStart: (request: FunnelStartRequest): Promise<{ ok: true } | { error: string }> =>
    ipcRenderer.invoke('funnel:start', request),
  funnelCancel: (): Promise<{ ok: true }> => ipcRenderer.invoke('funnel:cancel'),
  onFunnelProgress: (cb: (e: FunnelProgressEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: FunnelProgressEvent) => cb(ev);
    ipcRenderer.on('funnel-progress', listener);
    return () => ipcRenderer.removeListener('funnel-progress', listener);
  },

  // --- Режим «Замена титров» ---
  processCleaner: (request: unknown): Promise<{ ok: true }> =>
    ipcRenderer.invoke('cleaner:process', request),
  detectCleanerOne: (
    payload: { videoPath: string; detectTitles: boolean; detectWatermarks: boolean; dynamicTextOnly?: boolean }
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
