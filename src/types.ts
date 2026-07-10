// Общие типы проекта (§15 ТЗ и связанные сущности).

export type ScreenName = 'home' | 'media' | 'music' | 'processing' | 'editor';

// 9 эффектов вкладки EDIT (§7 ТЗ).
export type EffectName =
  | 'fastCut'
  | 'flash'
  | 'zoom'
  | 'prism'
  | 'rgb'
  | 'boomerang'
  | 'split'
  | 'hue'
  | 'speed'
  | 'shake'
  | 'glitch'
  | 'leak';

export const EFFECT_NAMES: EffectName[] = [
  'fastCut',
  'flash',
  'zoom',
  'prism',
  'rgb',
  'boomerang',
  'split',
  'hue',
  'speed',
  'shake',
  'glitch',
  'leak',
];

// 10 фильтров вкладки FILTERS (§8 ТЗ). «Нет» = activeFilter === null.
export type FilterName =
  | 'cinematic'
  | 'warm'
  | 'cool'
  | 'vintage'
  | 'bw'
  | 'vcr'
  | 'glitch'
  | 'film'
  | 'lightLeak'
  | 'vignette';

export const FILTER_NAMES: FilterName[] = [
  'cinematic',
  'warm',
  'cool',
  'vintage',
  'bw',
  'vcr',
  'glitch',
  'film',
  'lightLeak',
  'vignette',
];

// Настройки отдельного эффекта (мини-диалог): сила + вариант.
export interface EffectSettings {
  intensity: number; // 0..100
  variant: string;
}

export interface MediaFile {
  id: string;
  path: string;
  name: string;
  duration: number; // секунды
  thumbnail?: string; // data-URL или путь к превью
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number; // секунды
  category: string;
  file: string;
  cover?: string;
  bpm?: number;
}

// Данные beat detection от librosa (§9.1 ТЗ).
export interface BeatData {
  tempo: number;
  beat_times: number[];
  onset_times: number[];
  duration: number;
}

// Эффект, привязанный к временной метке внутри фрагмента.
export interface EffectSlot {
  effect: EffectName;
  time: number; // абсолютная временная метка (сек)
}

// Нарезанный фрагмент монтажа (§9.3 ТЗ).
export interface GeneratedClip {
  sourceFile: string;
  startTime: number; // позиция внутри исходного видео (сек)
  duration: number; // длина фрагмента (сек)
  effectSlots: EffectSlot[];
}

// Ручная правка фрагмента через Tweak (§6.2 ТЗ).
export interface TweakOverride {
  sourceFile: string;
  startTime: number;
  duration: number;
}
