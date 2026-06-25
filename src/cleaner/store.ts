import { create } from 'zustand';

// Состояние режима «Замена титров» (детект чужих титров/вотермарков + перекрытие).
export type CoverMethod = 'delogo' | 'blur' | 'box';

export interface CleanerVideo {
  id: string;
  path: string;
  name: string;
}

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CleanerState {
  videos: CleanerVideo[];
  addVideos: (paths: string[]) => void;
  removeVideo: (id: string) => void;

  detectTitles: boolean;
  setDetectTitles: (v: boolean) => void;
  detectWatermarks: boolean;
  setDetectWatermarks: (v: boolean) => void;
  dynamicTextOnly: boolean; // только меняющийся текст (субтитры)
  setDynamicTextOnly: (v: boolean) => void;

  coverMethod: CoverMethod;
  setCoverMethod: (m: CoverMethod) => void;
  boxColor: string;
  setBoxColor: (c: string) => void;
  boxRadius: number; // скругление сплошной плашки, px
  setBoxRadius: (v: number) => void;
  blurStrength: number; // сила блюра
  setBlurStrength: (v: number) => void;
  minConf: number;
  setMinConf: (v: number) => void;
  addTitles: boolean;
  setAddTitles: (v: boolean) => void;
  titlesAtZone: boolean; // ставить свои титры по центру найденной зоны
  setTitlesAtZone: (v: boolean) => void;
  titleZoneIndex: number; // индекс зоны для титров (ручной режим)
  setTitleZoneIndex: (v: number) => void;
  titleZonePick: 'largest' | 'lowest' | 'highest'; // выбор зоны в авто-режиме
  setTitleZonePick: (v: 'largest' | 'lowest' | 'highest') => void;

  manualZones: boolean; // использовать ручные зоны для всех роликов (вместо авто-детекта)
  setManualZones: (v: boolean) => void;
  zones: Zone[];
  setZones: (z: Zone[]) => void;
  addZone: (z: Zone) => void;
  removeZone: (i: number) => void;

  outputDir: string | null;
  setOutputDir: (v: string | null) => void;

  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  progress: CleanerProgress[];
  setProgress: (p: CleanerProgress[]) => void;
  updateProgress: (id: string, v: Partial<CleanerProgress>) => void;
}

export interface CleanerProgress {
  id: string;
  name: string;
  status: string;
  percent: number;
  info?: string;
}

function fileName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

export const useCleanerStore = create<CleanerState>((set) => ({
  videos: [],
  addVideos: (paths) =>
    set((s) => {
      const existing = new Set(s.videos.map((v) => v.id));
      const added = paths
        .filter((p) => !existing.has(p))
        .map<CleanerVideo>((p) => ({ id: p, path: p, name: fileName(p) }));
      return { videos: [...s.videos, ...added] };
    }),
  removeVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),

  detectTitles: true,
  setDetectTitles: (v) => set({ detectTitles: v }),
  detectWatermarks: true,
  setDetectWatermarks: (v) => set({ detectWatermarks: v }),
  dynamicTextOnly: true,
  setDynamicTextOnly: (v) => set({ dynamicTextOnly: v }),

  coverMethod: 'blur',
  setCoverMethod: (m) => set({ coverMethod: m }),
  boxColor: '#000000',
  setBoxColor: (c) => set({ boxColor: c }),
  boxRadius: 16,
  setBoxRadius: (v) => set({ boxRadius: v }),
  blurStrength: 16,
  setBlurStrength: (v) => set({ blurStrength: v }),
  minConf: 0.25,
  setMinConf: (v) => set({ minConf: v }),
  addTitles: false,
  setAddTitles: (v) => set({ addTitles: v }),
  titlesAtZone: true,
  setTitlesAtZone: (v) => set({ titlesAtZone: v }),
  titleZoneIndex: 0,
  setTitleZoneIndex: (v) => set({ titleZoneIndex: v }),
  titleZonePick: 'largest',
  setTitleZonePick: (v) => set({ titleZonePick: v }),

  manualZones: false,
  setManualZones: (v) => set({ manualZones: v }),
  zones: [],
  setZones: (z) => set({ zones: z }),
  addZone: (z) => set((s) => ({ zones: [...s.zones, z] })),
  removeZone: (i) => set((s) => ({ zones: s.zones.filter((_, j) => j !== i) })),

  outputDir: null,
  setOutputDir: (v) => set({ outputDir: v }),

  isProcessing: false,
  setIsProcessing: (v) => set({ isProcessing: v }),
  progress: [],
  setProgress: (p) => set({ progress: p }),
  updateProgress: (id, v) =>
    set((s) => ({ progress: s.progress.map((p) => (p.id === id ? { ...p, ...v } : p)) })),
}));
