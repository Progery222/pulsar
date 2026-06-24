import { create } from 'zustand';
import type {
  FileProgress,
  MirrorMode,
  RangeParam,
  TitlesStyle,
  VubEffects,
  VubParams,
  VubTabKey,
  VubTemplate,
  VubText,
  VubVideo,
  VubWatermark,
} from './types';

export type {
  FileProgress,
  MirrorMode,
  RangeParam,
  TitlesStyle,
  VubEffects,
  VubParams,
  VubTabKey,
  VubTemplate,
  VubText,
  VubVideo,
  VubWatermark,
  WatermarkZone,
} from './types';

// Состояние модуля Video Unique Booster (§4 ТЗ VUB). Полностью независимо от ProjectState редактора.

interface VubState {
  activeTab: VubTabKey;
  setActiveTab: (tab: VubTabKey) => void;

  videos: VubVideo[];
  addVideos: (paths: string[]) => void;
  removeVideo: (id: string) => void;

  params: VubParams;
  setParam: (key: keyof VubParams, value: Partial<RangeParam>) => void;

  effects: VubEffects;
  setEffects: (value: Partial<VubEffects>) => void;

  watermark: VubWatermark;
  setWatermark: (value: Partial<VubWatermark>) => void;

  text: VubText;
  setText: (value: Partial<VubText>) => void;

  template: VubTemplate;
  setTemplate: (value: Partial<VubTemplate>) => void;

  cleanMetadata: boolean;
  setCleanMetadata: (value: boolean) => void;

  titles: TitlesStyle;
  setTitles: (value: Partial<TitlesStyle>) => void;

  threads: number;
  setThreads: (value: number) => void;
  variations: number; // сколько уникальных вариаций создавать на каждое видео
  setVariations: (value: number) => void;
  namePattern: string; // свой шаблон имени файлов
  setNamePattern: (value: string) => void;
  outputDir: string | null;
  setOutputDir: (value: string | null) => void;

  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
  progress: FileProgress[];
  setProgress: (progress: FileProgress[]) => void;
  updateProgress: (id: string, value: Partial<FileProgress>) => void;
}

function fileName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

const range = (min: number, max: number): RangeParam => ({ enabled: false, min, max });

export const useVubStore = create<VubState>((set) => ({
  activeTab: 'videos',
  setActiveTab: (tab) => set({ activeTab: tab }),

  videos: [],
  addVideos: (paths) =>
    set((s) => {
      const existing = new Set(s.videos.map((v) => v.id));
      const added = paths
        .filter((p) => !existing.has(p))
        .map<VubVideo>((p) => ({ id: p, path: p, name: fileName(p) }));
      return { videos: [...s.videos, ...added] };
    }),
  removeVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),

  params: {
    brightness: range(-10, 10),
    contrast: range(-10, 10),
    sharpness: range(-10, 10),
    volume: range(-20, 20),
    duration: range(-5, 5),
  },
  setParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: { ...s.params[key], ...value } } })),

  effects: {
    darken: { enabled: false, duration: 3, audioFadeIn: false },
    mirror: { enabled: false, mode: 'random' },
    grid: { enabled: false, opacityMin: 5, opacityMax: 15 },
    gridColor: { enabled: false, colors: [] },
    gridSize: { enabled: false, size: 32 },
  },
  setEffects: (value) => set((s) => ({ effects: { ...s.effects, ...value } })),

  watermark: { file: null, zones: [] },
  setWatermark: (value) => set((s) => ({ watermark: { ...s.watermark, ...value } })),

  text: { spintax: '', font: 'Inter', size: 32, color: '#FFFFFF', position: 'bottom' },
  setText: (value) => set((s) => ({ text: { ...s.text, ...value } })),

  template: { folder: null, everySeconds: 10 },
  setTemplate: (value) => set((s) => ({ template: { ...s.template, ...value } })),

  cleanMetadata: true,
  setCleanMetadata: (value) => set({ cleanMetadata: value }),

  titles: {
    enabled: false,
    language: 'auto',
    font: 'Arial',
    fontSize: 64,
    baseColor: '#FFFFFF',
    highlightColor: '#CCFF00',
    outline: 3,
    position: 'bottom',
    karaoke: true,
    uppercase: true,
    maxWordsPerLine: 4,
  },
  setTitles: (value) => set((s) => ({ titles: { ...s.titles, ...value } })),

  threads: Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2)),
  setThreads: (value) => set({ threads: value }),
  variations: 1,
  setVariations: (value) => set({ variations: Math.max(1, value) }),
  namePattern: '',
  setNamePattern: (value) => set({ namePattern: value }),
  outputDir: null,
  setOutputDir: (value) => set({ outputDir: value }),

  isProcessing: false,
  setIsProcessing: (value) => set({ isProcessing: value }),
  progress: [],
  setProgress: (progress) => set({ progress }),
  updateProgress: (id, value) =>
    set((s) => ({ progress: s.progress.map((p) => (p.id === id ? { ...p, ...value } : p)) })),
}));
