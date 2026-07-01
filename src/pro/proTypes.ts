// Модель данных профессионального мульти-трек монтажа (Pulsar Pro).
// Живёт параллельно с beat-sync моделью (GeneratedClip) из ../types.
// Фаза 1: базовые сущности документа таймлайна.

import type { EffectName } from '../types';

export type ProTrackKind = 'video' | 'audio';

// Геометрия кадра клипа (Inspector → Transform, §4.1 ТЗ).
export interface ClipTransform {
  x: number; // Position X (px относительно центра)
  y: number; // Position Y
  scale: number; // 1 = 100%
  rotation: number; // градусы
}

// Кадрирование (Inspector → Crop, §4.2 ТЗ). Значения 0..1 от размера кадра.
export interface ClipCrop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// Эффект, привязанный к смещению внутри клипа (сек от начала клипа).
export interface ProEffectSlot {
  effect: EffectName;
  offset: number;
}

// Клип на таймлайне (§3.3 ТЗ).
export interface ProClip {
  id: string;
  trackId: string;
  sourceFile: string; // путь к исходному медиа
  timelineStart: number; // позиция на таймлайне (сек)
  duration: number; // длина клипа на таймлайне (сек)
  inPoint: number; // точка входа внутри источника (сек)
  sourceDuration?: number; // полная длина исходника (сек) — граница для trim
  sourceW?: number; // натуральные размеры источника — для вписывания в кадр (letterbox)
  sourceH?: number;
  transform?: ClipTransform;
  crop?: ClipCrop;
  effects?: ProEffectSlot[];
  locked?: boolean; // закреплён — Auto-Cut не перезаписывает (§5 ТЗ)
  linkId?: string; // связка видео+аудио одного источника (двигаются вместе)
  speed?: number; // скорость воспроизведения (1 = норма, 2 = вдвое быстрее)
  keyframes?: Keyframe[]; // анимация Transform по ключам (t — сек от начала клипа)
  transition?: { duration: number; kind?: TransitionKind }; // переход у стыка с предыдущим клипом (§5 ТЗ)
  adjust?: { filter: AdjustFilter; intensity: number }; // блок корр. слоя (для дорожки Adjustment)
  audio?: ClipAudio; // параметры аудио-клипа
  color?: ClipColor; // цветокоррекция видео-клипа
  text?: ClipText; // текстовый/титровый клип (sourceFile пустой)
  blend?: BlendMode; // режим наложения на нижние слои (виден в экспорте)
}

export type TransitionKind = 'dissolve' | 'fadeblack';
export const TRANSITION_KINDS: TransitionKind[] = ['dissolve', 'fadeblack'];
export const TRANSITION_LABEL: Record<TransitionKind, string> = { dissolve: 'Растворение', fadeblack: 'Через чёрный' };

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply';
export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'screen', 'multiply'];
export const BLEND_LABEL: Record<BlendMode, string> = { normal: 'Обычный', add: 'Сложение', screen: 'Экран', multiply: 'Умножение' };

// Текстовый клип (титры). x,y — доля кадра (центр текста), size — % высоты кадра.
export interface ClipText {
  content: string;
  size: number;
  color: string;
  x: number;
  y: number;
  bg: boolean; // подложка-плашка под текстом
}
export const DEFAULT_TEXT: ClipText = { content: 'Заголовок', size: 8, color: '#ffffff', x: 0.5, y: 0.85, bg: false };

// Цветокоррекция (значения -100..100, hue -180..180; 0 = нейтрально).
export interface ClipColor {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
}
export const DEFAULT_COLOR: ClipColor = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0 };

// Пресеты «луков» (быстрый цветокор в один клик, как Film Impact).
export const LOOK_PRESETS: { name: string; color: ClipColor }[] = [
  { name: 'Кино', color: { brightness: 0, contrast: 18, saturation: 8, temperature: 18, hue: 0 } },
  { name: 'Тёплый', color: { brightness: 4, contrast: 6, saturation: 8, temperature: 42, hue: 0 } },
  { name: 'Холодный', color: { brightness: 0, contrast: 8, saturation: -8, temperature: -42, hue: 0 } },
  { name: 'Винтаж', color: { brightness: 4, contrast: -8, saturation: -28, temperature: 26, hue: 0 } },
  { name: 'Драма', color: { brightness: -4, contrast: 32, saturation: -14, temperature: 6, hue: 0 } },
  { name: 'Сочный', color: { brightness: 2, contrast: 14, saturation: 42, temperature: 6, hue: 0 } },
  { name: 'Ч/Б', color: { brightness: 2, contrast: 14, saturation: -100, temperature: 0, hue: 0 } },
  { name: 'Тил&Оранж', color: { brightness: 0, contrast: 20, saturation: 14, temperature: 12, hue: -6 } },
];

// CSS-фильтр для превью из цветокора.
export function colorToCss(c?: Partial<ClipColor>): string {
  const v = { ...DEFAULT_COLOR, ...c };
  const parts = [
    `brightness(${(1 + v.brightness / 100).toFixed(3)})`,
    `contrast(${(1 + v.contrast / 100).toFixed(3)})`,
    `saturate(${(1 + v.saturation / 100).toFixed(3)})`,
  ];
  if (v.hue) parts.push(`hue-rotate(${v.hue}deg)`);
  if (v.temperature > 0) parts.push(`sepia(${(v.temperature / 200).toFixed(3)})`);
  else if (v.temperature < 0) parts.push(`hue-rotate(${(v.temperature * 0.4).toFixed(1)}deg)`, `saturate(${(1 - v.temperature / 400).toFixed(3)})`);
  return parts.join(' ');
}

// Параметры аудио (громкость/питч/фейды).
export interface ClipAudio {
  volumeDb: number; // усиление, дБ (0 = без изменений)
  pitch: number; // сдвиг тона, полутоны
  fadeIn: number; // фейд в начале, сек
  fadeOut: number; // фейд в конце, сек
}
export const DEFAULT_AUDIO: ClipAudio = { volumeDb: 0, pitch: 0, fadeIn: 0, fadeOut: 0 };

// Дорожка (§3.1 ТЗ). Видео (V1,V2…) сверху, аудио (A1,A2…) снизу.
export interface ProTrack {
  id: string;
  kind: ProTrackKind;
  name: string; // V1 / A1 …
  height: number; // px
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean; // toggle visibility (только видео)
  isAdjustment?: boolean; // дорожка корректирующих слоёв (§5 ТЗ)
}

// Документ таймлайна.
export interface ProDocument {
  tracks: ProTrack[];
  clips: ProClip[];
  fps: number; // для линейки HH:MM:SS:FF
  width: number; // разрешение проекта (для Viewer/композиции)
  height: number;
}

export type ProTool = 'select' | 'blade' | 'ripple';
export type ViewerMode = 'none' | 'transform' | 'crop';
export type Mood = 'mellow' | 'natural' | 'energetic';

// Фильтры дорожки корректирующих слоёв (§5 ТЗ), реализуемые в WebGL.
export type AdjustFilter = 'bw' | 'warm' | 'cool' | 'vibrant' | 'contrast';
export const ADJUST_FILTERS: AdjustFilter[] = ['bw', 'warm', 'cool', 'vibrant', 'contrast'];
export const ADJUST_LABEL: Record<AdjustFilter, string> = {
  bw: 'Ч/Б',
  warm: 'Тёплый',
  cool: 'Холодный',
  vibrant: 'Насыщенность',
  contrast: 'Контраст',
};
export const ADJUST_CODE: Record<AdjustFilter, number> = { bw: 1, warm: 2, cool: 3, vibrant: 4, contrast: 5 };

export const DEFAULT_TRANSFORM: ClipTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
export const DEFAULT_CROP: ClipCrop = { top: 0, bottom: 0, left: 0, right: 0 };

// Ключ анимации Transform (t — сек от начала клипа).
export interface Keyframe {
  t: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

// Transform клипа в момент localSec (сек от начала клипа) с учётом ключей.
export function transformAt(clip: ProClip, localSec: number): ClipTransform {
  const ks = clip.keyframes;
  if (!ks || !ks.length) return { ...DEFAULT_TRANSFORM, ...clip.transform };
  const s = [...ks].sort((a, b) => a.t - b.t);
  const pick = (k: Keyframe): ClipTransform => ({ x: k.x, y: k.y, scale: k.scale, rotation: k.rotation });
  if (localSec <= s[0].t) return pick(s[0]);
  const last = s[s.length - 1];
  if (localSec >= last.t) return pick(last);
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (localSec >= a.t && localSec <= b.t) {
      const f = (localSec - a.t) / ((b.t - a.t) || 1);
      const l = (u: number, v: number) => u + (v - u) * f;
      return { x: l(a.x, b.x), y: l(a.y, b.y), scale: l(a.scale, b.scale), rotation: l(a.rotation, b.rotation) };
    }
  }
  return pick(last);
}

// Предыдущий клип, вплотную примыкающий слева к данному (для crossfade).
export function findPrevAdjacent(clips: ProClip[], clip: ProClip): ProClip | null {
  const cands = clips
    .filter((c) => c.trackId === clip.trackId && c.id !== clip.id && Math.abs(c.timelineStart + c.duration - clip.timelineStart) < 0.02)
    .sort((a, b) => b.timelineStart - a.timelineStart);
  return cands[0] ?? null;
}

// Пустой документ по умолчанию: 2 видео + 2 аудио дорожки, 30 fps.
export function createEmptyProDocument(): ProDocument {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    tracks: [
      { id: 'V2', kind: 'video', name: 'V2', height: 64, muted: false, solo: false, locked: false, hidden: false },
      { id: 'V1', kind: 'video', name: 'V1', height: 64, muted: false, solo: false, locked: false, hidden: false },
      { id: 'A1', kind: 'audio', name: 'A1', height: 56, muted: false, solo: false, locked: false, hidden: false },
      { id: 'A2', kind: 'audio', name: 'A2', height: 56, muted: false, solo: false, locked: false, hidden: false },
    ],
    clips: [],
  };
}
