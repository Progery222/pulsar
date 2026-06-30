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
  transition: 'none' | 'dissolve' | 'slide' | 'zoom' | 'mix'; // переходы между клипами
  title: { text: string; position: 'top' | 'center' | 'bottom'; color: string; size: number; box: boolean }; // заголовок-текст

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
  setTransition: (transition: ProjectState['transition']) => void;
  setTitle: (value: Partial<ProjectState['title']>) => void;
  setActiveEffect: (effect: EffectName, level: 0 | 1 | 2) => void;
  setEffectSetting: (effect: EffectName, settings: Partial<EffectSettings>) => void;
  setActiveFilter: (filter: FilterName | null) => void;
  setFilterIntensity: (intensity: number) => void;
  setBeatData: (data: BeatData | null) => void;
  setGeneratedClips: (clips: GeneratedClip[]) => void;
  reorderClips: (from: number, to: number) => void; // ручная перестановка клипов (таймлайн)
  removeClip: (index: number) => void; // удалить клип
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

// Перестановка/удаление клипов с сохранением эффектов: фиксируем смещение каждого
// эффекта внутри клипа, меняем порядок, затем пересчитываем абсолютные времена.
function remapClipOrder(
  clips: GeneratedClip[],
  transform: (arr: GeneratedClip[]) => GeneratedClip[]
): GeneratedClip[] {
  const starts: number[] = [];
  let acc = 0;
  for (const c of clips) {
    starts.push(acc);
    acc += c.duration;
  }
  const offMap = new Map<GeneratedClip, { effect: EffectName; off: number }[]>();
  clips.forEach((c, i) => {
    offMap.set(
      c,
      c.effectSlots.map((e) => ({ effect: e.effect, off: Math.max(0, e.time - starts[i]) }))
    );
  });
  const arranged = transform([...clips]);
  let nacc = 0;
  return arranged.map((c) => {
    const start = nacc;
    nacc += c.duration;
    const offs = offMap.get(c) ?? [];
    return {
      ...c,
      effectSlots: offs.map((o) => ({ effect: o.effect, time: Number((start + o.off).toFixed(3)) })),
    };
  });
}

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
  transition: 'none',
  title: { text: '', position: 'bottom', color: '#FFFFFF', size: 64, box: true },

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
  setTransition: (transition) => set({ transition }),
  setTitle: (value) => set((s) => ({ title: { ...s.title, ...value } })),
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
  reorderClips: (from, to) =>
    set((s) => {
      const clips = s.generatedClips;
      if (from < 0 || to < 0 || from >= clips.length || to >= clips.length || from === to) return {};
      const result = remapClipOrder(clips, (arr) => {
        const a = [...arr];
        const [m] = a.splice(from, 1);
        a.splice(to, 0, m);
        return a;
      });
      return { generatedClips: result };
    }),
  removeClip: (index) =>
    set((s) => {
      const clips = s.generatedClips;
      if (index < 0 || index >= clips.length || clips.length <= 1) return {};
      const result = remapClipOrder(clips, (arr) => arr.filter((_, i) => i !== index));
      const newDuration = result.reduce((acc, c) => acc + c.duration, 0);
      return { generatedClips: result, duration: Number(newDuration.toFixed(3)) };
    }),
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
