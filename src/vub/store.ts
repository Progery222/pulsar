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
  VubUpscale,
  VubHooks,
  VubHard,
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
  VubUpscale,
  VubHooks,
  VubHard,
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

  hooks: VubHooks;
  setHooks: (value: Partial<VubHooks>) => void;

  hard: VubHard;
  setHard: (value: Partial<VubHard>) => void;

  cleanMetadata: boolean;
  setCleanMetadata: (value: boolean) => void;

  nativeExport: boolean;
  setNativeExport: (value: boolean) => void;

  upscale: VubUpscale;
  setUpscale: (value: Partial<VubUpscale>) => void;

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

  // Профили: снять текущие настройки и применить сохранённый снимок.
  snapshot: () => VubSnapshot;
  loadSnapshot: (s: VubSnapshot) => void;

  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
  progress: FileProgress[];
  setProgress: (progress: FileProgress[]) => void;
  updateProgress: (id: string, value: Partial<FileProgress>) => void;
}

// Снимок всех настроек уникализатора (для сохранения/загрузки профилей).
// Без videos/outputDir/threads/progress — только «рецепт» обработки.
export interface VubSnapshot {
  params: VubParams;
  effects: VubEffects;
  watermark: VubWatermark;
  text: VubText;
  template: VubTemplate;
  hooks: VubHooks;
  hard: VubHard;
  cleanMetadata: boolean;
  nativeExport: boolean;
  upscale: VubUpscale;
  titles: TitlesStyle;
  variations: number;
  namePattern: string;
}

function fileName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

const range = (min: number, max: number): RangeParam => ({ enabled: false, min, max });
// Включённый по умолчанию параметр (самые мощные рычаги стоят сразу).
const on = (min: number, max: number): RangeParam => ({ enabled: true, min, max });

export const useVubStore = create<VubState>((set, get) => ({
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
    // ON по умолчанию — самые мощные против fingerprint:
    brightness: on(-10, 10), // + hue/colorbalance (цветовой отпечаток)
    contrast: on(-10, 10),
    rotation: on(-3, 3),
    pitch: on(-2, 2), // + 3-полосный аудио-EQ + задержка (аудио-отпечаток)
    zoom: on(3, 8), // + случайный pan (перцептивный хеш видео)
    // OFF — по вкусу:
    sharpness: range(-10, 10),
    volume: range(-20, 20),
    duration: range(-5, 5),
  },
  setParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: { ...s.params[key], ...value } } })),

  effects: {
    darken: { enabled: false, duration: 3, audioFadeIn: false },
    mirror: { enabled: true, mode: 'always' }, // ON — самый сильный слом content fingerprint
    grid: { enabled: false, opacityMin: 5, opacityMax: 15 },
    gridColor: { enabled: false, colors: [] },
    gridSize: { enabled: false, size: 32 },
  },
  setEffects: (value) => set((s) => ({ effects: { ...s.effects, ...value } })),

  watermark: { file: null, zones: [] },
  setWatermark: (value) => set((s) => ({ watermark: { ...s.watermark, ...value } })),

  text: { spintax: '', font: 'Inter', size: 32, color: '#FFFFFF', position: 'bottom' },
  setText: (value) => set((s) => ({ text: { ...s.text, ...value } })),

  template: { enabled: false, folder: null, count: 2 },
  setTemplate: (value) => set((s) => ({ template: { ...s.template, ...value } })),

  hooks: { enabled: false, folder: null },
  setHooks: (value) => set((s) => ({ hooks: { ...s.hooks, ...value } })),

  hard: { drift: false, warp: false, frameBlend: false, fpsInterp: false, audioFx: false },
  setHard: (value) => set((s) => ({ hard: { ...s.hard, ...value } })),

  cleanMetadata: true,
  setCleanMetadata: (value) => set({ cleanMetadata: value }),

  nativeExport: true, // ON — метаданные «нативного экспорта с телефона»
  setNativeExport: (value) => set({ nativeExport: value }),

  upscale: { enabled: false, target: 1920 },
  setUpscale: (value) => set((s) => ({ upscale: { ...s.upscale, ...value } })),

  titles: {
    enabled: false,
    language: 'auto',
    font: 'Montserrat',
    fontSize: 64,
    baseColor: '#FFFFFF',
    highlightColor: '#CCFF00',
    outline: 3,
    posXPct: 50,
    posYPct: 82,
    karaoke: true,
    uppercase: true,
    bold: false,
    maxWordsPerLine: 4,
    bg: { enabled: true, color: '#000000', opacity: 55, widthPct: 72, heightPct: 14, radius: 16 },
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

  snapshot: () => {
    const s = get();
    return {
      params: s.params, effects: s.effects, watermark: s.watermark, text: s.text,
      template: s.template, hooks: s.hooks, hard: s.hard, cleanMetadata: s.cleanMetadata,
      nativeExport: s.nativeExport, upscale: s.upscale, titles: s.titles,
      variations: s.variations, namePattern: s.namePattern,
    };
  },
  loadSnapshot: (snap) => set({ ...snap }),

  isProcessing: false,
  setIsProcessing: (value) => set({ isProcessing: value }),
  progress: [],
  setProgress: (progress) => set({ progress }),
  updateProgress: (id, value) =>
    set((s) => ({ progress: s.progress.map((p) => (p.id === id ? { ...p, ...value } : p)) })),
}));
