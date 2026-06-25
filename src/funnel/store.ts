import { create } from 'zustand';
import type { FunnelItem, FunnelProgressEvent, FunnelStage } from './types';

// Состояние модуля «Воронка»: настройки, очередь задач и прогресс обработки.
interface FunnelState {
  url: string;
  setUrl: (v: string) => void;
  targetLanguages: string[]; // выбранные коды языков
  toggleLanguage: (code: string) => void;
  uniqueize: boolean;
  setUniqueize: (v: boolean) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  running: boolean;
  setRunning: (v: boolean) => void;
  // Очередь: ключ = id задачи (включая служебную 'download').
  items: Record<string, FunnelItem>;
  applyProgress: (ev: FunnelProgressEvent) => void;
  reset: () => void;
}

export const useFunnelStore = create<FunnelState>((set) => ({
  url: '',
  setUrl: (v) => set({ url: v }),
  targetLanguages: ['en', 'es', 'fr', 'br', 'tr'],
  toggleLanguage: (code) =>
    set((s) => ({
      targetLanguages: s.targetLanguages.includes(code)
        ? s.targetLanguages.filter((c) => c !== code)
        : [...s.targetLanguages, code],
    })),
  uniqueize: true,
  setUniqueize: (v) => set({ uniqueize: v }),
  outputDir: '',
  setOutputDir: (v) => set({ outputDir: v }),
  running: false,
  setRunning: (v) => set({ running: v }),
  items: {},
  applyProgress: (ev) =>
    set((s) => {
      const prev: FunnelItem = s.items[ev.id] ?? {
        id: ev.id,
        name: ev.name ?? ev.id,
        stage: 'queued' as FunnelStage,
        percent: 0,
        outputs: [],
      };
      const next: FunnelItem = {
        ...prev,
        name: ev.name ?? prev.name,
        stage: ev.stage ?? prev.stage,
        percent: ev.percent ?? prev.percent,
        branch: ev.branch ?? prev.branch,
        stageLabel: ev.stageLabel ?? prev.stageLabel,
        error: ev.error ?? (ev.stage === 'error' ? prev.error : ev.stage ? undefined : prev.error),
        outputs: ev.output ? [...prev.outputs, ev.output] : prev.outputs,
      };
      return { items: { ...s.items, [ev.id]: next } };
    }),
  reset: () => set({ items: {} }),
}));
