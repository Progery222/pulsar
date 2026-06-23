import { create } from 'zustand';
import {
  EFFECT_NAMES,
  type BeatData,
  type EffectName,
  type EffectSettings,
  type FilterName,
  type GeneratedClip,
  type MediaFile,
  type ScreenName,
  type Track,
  type TweakOverride,
} from '../types';
import { defaultVariant } from '../data/effects';
import type { UniqualizerSettings } from '../types/uniqualizer';

// Полный интерфейс состояния проекта (§15 ТЗ).
export interface ProjectState {
  // Медиа
  mediaFiles: MediaFile[]; // Список загруженных видеофайлов
  mediaOrder: string[]; // Порядок ID файлов

  // Аудио
  selectedTrack: Track | null; // Выбранный трек
  segmentStart: number; // Начало сегмента трека (сек)

  // Настройки монтажа
  mood: 'mellow' | 'natural' | 'energetic';
  duration: number; // Длительность итогового видео (сек)
  format: '9:16' | '1:1' | '16:9';
  fade: 'none' | 'in' | 'out' | 'all';

  // Громкости аудио-микса (0..1)
  volumeOriginal: number; // оригинальный звук видео
  volumeMusic: number; // выбранный трек

  // Эффекты
  activeEffects: Record<EffectName, 0 | 1 | 2>; // 0 = выкл, 1/2 = уровень
  effectSettings: Record<EffectName, EffectSettings>; // мини-настройки эффекта
  activeFilter: FilterName | null;
  filterIntensity: number; // 0–100

  // Результат генерации
  generatedClips: GeneratedClip[]; // Нарезанные фрагменты
  beatData: BeatData | null; // Данные от librosa

  // UI состояние
  currentScreen: ScreenName;
  isProcessing: boolean;
  isExporting: boolean;
  exportProgress: number; // 0–100

  // Tweak данные
  tweakOverrides: Record<string, TweakOverride>; // Ручные правки фрагментов

  // Уникализатор экспорта
  uniqualizerSettings: UniqualizerSettings;
  uniqualizerCount: number; // сколько уникальных копий создавать при экспорте
}

// Экшены store (Шаг 2 плана).
export interface ProjectActions {
  setCurrentScreen: (screen: ScreenName) => void;
  setMediaFiles: (files: MediaFile[]) => void;
  setSelectedTrack: (track: Track | null) => void;
  setMood: (mood: ProjectState['mood']) => void;
  setDuration: (duration: number) => void;
  setFormat: (format: ProjectState['format']) => void;
  setFade: (fade: ProjectState['fade']) => void;
  setActiveEffect: (effect: EffectName, level: 0 | 1 | 2) => void;
  setEffectSetting: (effect: EffectName, settings: Partial<EffectSettings>) => void;
  setActiveFilter: (filter: FilterName | null) => void;
  setFilterIntensity: (intensity: number) => void;
  setBeatData: (data: BeatData | null) => void;
  setGeneratedClips: (clips: GeneratedClip[]) => void;
  setIsProcessing: (value: boolean) => void;
  setIsExporting: (value: boolean) => void;
  setExportProgress: (progress: number) => void;
  setSegmentStart: (value: number) => void;
  setTweakOverride: (key: string, value: TweakOverride) => void;
  setVolumeOriginal: (value: number) => void;
  setVolumeMusic: (value: number) => void;
  setUniqualizerSettings: (settings: Partial<UniqualizerSettings>) => void;
  setUniqualizerCount: (count: number) => void;
}

const initialEffects = EFFECT_NAMES.reduce(
  (acc, name) => {
    acc[name] = 0;
    return acc;
  },
  {} as Record<EffectName, 0 | 1 | 2>
);

const initialEffectSettings = EFFECT_NAMES.reduce(
  (acc, name) => {
    acc[name] = { intensity: 50, variant: defaultVariant(name) };
    return acc;
  },
  {} as Record<EffectName, EffectSettings>
);

export const useProjectStore = create<ProjectState & ProjectActions>((set) => ({
  // --- Начальное состояние ---
  mediaFiles: [],
  mediaOrder: [],

  selectedTrack: null,
  segmentStart: 0,

  mood: 'natural',
  duration: 15,
  format: '9:16',
  fade: 'none',

  volumeOriginal: 0.5,
  volumeMusic: 1.0,

  activeEffects: initialEffects,
  effectSettings: initialEffectSettings,
  activeFilter: null,
  filterIntensity: 50,

  generatedClips: [],
  beatData: null,

  currentScreen: 'home',
  isProcessing: false,
  isExporting: false,
  exportProgress: 0,

  tweakOverrides: {},

  uniqualizerSettings: {
    enabled: true,
    colorShift: true,
    mirrorFlip: false,
    noise: true,
    speed: true,
    cropEdges: true,
    audioShift: true,
    visibleVariation: false,
  },
  uniqualizerCount: 1,

  // --- Экшены ---
  setCurrentScreen: (screen) => set({ currentScreen: screen }),
  setMediaFiles: (files) =>
    set({ mediaFiles: files, mediaOrder: files.map((f) => f.id) }),
  setSelectedTrack: (track) => set({ selectedTrack: track }),
  setMood: (mood) => set({ mood }),
  setDuration: (duration) => set({ duration }),
  setFormat: (format) => set({ format }),
  setFade: (fade) => set({ fade }),
  setActiveEffect: (effect, level) =>
    set((state) => ({
      activeEffects: { ...state.activeEffects, [effect]: level },
    })),
  setEffectSetting: (effect, settings) =>
    set((state) => ({
      effectSettings: {
        ...state.effectSettings,
        [effect]: { ...state.effectSettings[effect], ...settings },
      },
    })),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setFilterIntensity: (intensity) => set({ filterIntensity: intensity }),
  setBeatData: (data) => set({ beatData: data }),
  setGeneratedClips: (clips) => set({ generatedClips: clips }),
  setIsProcessing: (value) => set({ isProcessing: value }),
  setIsExporting: (value) => set({ isExporting: value }),
  setExportProgress: (progress) => set({ exportProgress: progress }),
  setSegmentStart: (value) => set({ segmentStart: value }),
  setTweakOverride: (key, value) =>
    set((state) => ({ tweakOverrides: { ...state.tweakOverrides, [key]: value } })),
  setVolumeOriginal: (value) => set({ volumeOriginal: value }),
  setVolumeMusic: (value) => set({ volumeMusic: value }),
  setUniqualizerSettings: (settings) =>
    set((state) => ({ uniqualizerSettings: { ...state.uniqualizerSettings, ...settings } })),
  setUniqualizerCount: (count) => set({ uniqualizerCount: count }),
}));
