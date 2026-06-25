import { create } from 'zustand';

export type Tab = 'tools' | 'edit' | 'filters';

// Режим приложения: стартовый экран выбора / редактор (Монтаж) / VUB (Уникализатор) /
// cleaner (Замена титров) / settings (настройки) / history (история задач).
export type AppMode = 'select' | 'editor' | 'vub' | 'cleaner' | 'settings' | 'history';

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
}));
