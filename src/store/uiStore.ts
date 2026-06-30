import { create } from 'zustand';

export type Tab = 'tools' | 'edit' | 'filters';

// Режим приложения: стартовый экран выбора / редактор (Монтаж) / VUB (Уникализатор) /
// cleaner / tts (Озвучка) / dub (Дубляж) / settings. История и Очередь — плавающие мини-окна.
export type AppMode = 'select' | 'editor' | 'vub' | 'cleaner' | 'tts' | 'dub' | 'funnel' | 'download' | 'settings';

// UI-состояние редактора (вкладка, модалка экспорта, play/pause-колбэк),
// отдельно от ProjectState (§15).
interface UIState {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  showExport: boolean;
  setShowExport: (value: boolean) => void;
  playToggle: (() => void) | null;
  setPlayToggle: (fn: (() => void) | null) => void;
  // Плавающие мини-окна.
  showQueue: boolean;
  toggleQueue: () => void;
  setShowQueue: (value: boolean) => void;
  showHistory: boolean;
  toggleHistory: () => void;
  setShowHistory: (value: boolean) => void;
  // Мастер первичной настройки / установки движков.
  showSetup: boolean;
  setShowSetup: (value: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  appMode: 'select',
  setAppMode: (mode) => set({ appMode: mode }),
  activeTab: 'tools',
  setActiveTab: (tab) => set({ activeTab: tab }),
  showExport: false,
  setShowExport: (value) => set({ showExport: value }),
  playToggle: null,
  setPlayToggle: (fn) => set({ playToggle: fn }),
  showQueue: false,
  toggleQueue: () => set((s) => ({ showQueue: !s.showQueue })),
  setShowQueue: (value) => set({ showQueue: value }),
  showHistory: false,
  toggleHistory: () => set((s) => ({ showHistory: !s.showHistory })),
  setShowHistory: (value) => set({ showHistory: value }),
  showSetup: false,
  setShowSetup: (value) => set({ showSetup: value }),
}));
