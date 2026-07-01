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
  transition?: { duration: number }; // crossfade у левого края с предыдущим клипом (§5 ТЗ)
  adjust?: { filter: AdjustFilter; intensity: number }; // блок корр. слоя (для дорожки Adjustment)
}

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
