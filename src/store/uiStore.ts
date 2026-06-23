import { create } from 'zustand';

export type Tab = 'tools' | 'edit' | 'filters';

// UI-состояние редактора (вкладка, модалка экспорта, play/pause-колбэк),
// отдельно от ProjectState (§15).
interface UIState {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  showExport: boolean;
  setShowExport: (value: boolean) => void;
  playToggle: (() => void) | null;
  setPlayToggle: (fn: (() => void) | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'tools',
  setActiveTab: (tab) => set({ activeTab: tab }),
  showExport: false,
  setShowExport: (value) => set({ showExport: value }),
  playToggle: null,
  setPlayToggle: (fn) => set({ playToggle: fn }),
}));
