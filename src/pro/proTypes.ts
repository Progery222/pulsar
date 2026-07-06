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
  keyframes?: Keyframes; // анимация Transform: отдельная дорожка ключей на параметр
  transition?: { duration: number; kind?: TransitionKind; align?: TransitionAlign }; // переход/появление у левого края (§5 ТЗ)
  tailFade?: number; // уход в чёрный у правого края клипа (сек), если нет смежного справа
  adjust?: { filter: AdjustFilter; intensity: number }; // блок корр. слоя (для дорожки Adjustment)
  audio?: ClipAudio; // параметры аудио-клипа
  color?: ClipColor; // цветокоррекция видео-клипа
  text?: ClipText; // текстовый/титровый клип (sourceFile пустой)
  blend?: BlendMode; // режим наложения на нижние слои (виден в экспорте)
}

// Выравнивание перехода относительно реза: по центру / у левого клипа (кончается на резе) / у правого (начинается с реза).
export type TransitionAlign = 'center' | 'left' | 'right';
export const TRANSITION_ALIGNS: TransitionAlign[] = ['left', 'center', 'right'];
export const TRANSITION_ALIGN_LABEL: Record<TransitionAlign, string> = { center: 'По центру', left: 'У левого', right: 'У правого' };

export type TransitionKind = 'dissolve' | 'fadeblack' | 'slideL' | 'slideR' | 'slideU' | 'slideD' | 'push' | 'zoom' | 'spin' | 'whipL' | 'whipR' | 'zoomblur' | 'blurdissolve';
export const TRANSITION_KINDS: TransitionKind[] = ['dissolve', 'fadeblack', 'slideL', 'slideR', 'slideU', 'slideD', 'push', 'zoom', 'spin', 'whipL', 'whipR', 'zoomblur', 'blurdissolve'];
export const TRANSITION_LABEL: Record<TransitionKind, string> = {
  dissolve: 'Растворение',
  fadeblack: 'Через чёрный',
  slideL: 'Сдвиг ←',
  slideR: 'Сдвиг →',
  slideU: 'Сдвиг ↑',
  slideD: 'Сдвиг ↓',
  push: 'Выталкивание',
  zoom: 'Зум',
  spin: 'Вращение',
  whipL: 'Whip ← (смаз)',
  whipR: 'Whip → (смаз)',
  zoomblur: 'Zoom Blur',
  blurdissolve: 'Blur Dissolve',
};

// Эффект слоя в момент f (0..1) перехода: альфа + смещение (доля кадра) + масштаб + поворот + блюр.
export interface TransFx {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  blur?: number; // магнитуда моушен-блюра (доля кадра)
  radial?: boolean; // радиальный (zoom) вместо направленного
}
const idFx = (alpha = 1): TransFx => ({ alpha, dx: 0, dy: 0, scale: 1, rot: 0 });
const bell = (f: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, f))); // 0→1→0, пик в центре

// Раскладка перехода на входящий (b) и уходящий (a) слои. dx/dy — доля кадра.
export function transitionLayers(kind: TransitionKind, f: number): { a: TransFx; b: TransFx } {
  const e = f * f * (3 - 2 * f); // smoothstep для плавности движения
  switch (kind) {
    case 'fadeblack':
      return { a: idFx(Math.max(0, 1 - 2 * f)), b: idFx(Math.max(0, 2 * f - 1)) };
    case 'slideL':
      return { a: idFx(1), b: { alpha: 1, dx: (1 - e), dy: 0, scale: 1, rot: 0 } };
    case 'slideR':
      return { a: idFx(1), b: { alpha: 1, dx: -(1 - e), dy: 0, scale: 1, rot: 0 } };
    case 'slideU':
      return { a: idFx(1), b: { alpha: 1, dx: 0, dy: (1 - e), scale: 1, rot: 0 } };
    case 'slideD':
      return { a: idFx(1), b: { alpha: 1, dx: 0, dy: -(1 - e), scale: 1, rot: 0 } };
    case 'push':
      return { a: { alpha: 1, dx: -e, dy: 0, scale: 1, rot: 0 }, b: { alpha: 1, dx: (1 - e), dy: 0, scale: 1, rot: 0 } };
    case 'zoom':
      return { a: idFx(1), b: { alpha: f, dx: 0, dy: 0, scale: 0.3 + 0.7 * e, rot: 0 } };
    case 'spin':
      return { a: idFx(1), b: { alpha: f, dx: 0, dy: 0, scale: 0.2 + 0.8 * e, rot: (1 - e) * 200 } };
    case 'whipL': {
      const fast = Math.pow(f, 0.7);
      const bl = 0.16 * bell(f);
      return { a: { alpha: 1, dx: -fast, dy: 0, scale: 1, rot: 0, blur: bl }, b: { alpha: 1, dx: (1 - fast), dy: 0, scale: 1, rot: 0, blur: bl } };
    }
    case 'whipR': {
      const fast = Math.pow(f, 0.7);
      const bl = 0.16 * bell(f);
      return { a: { alpha: 1, dx: fast, dy: 0, scale: 1, rot: 0, blur: bl }, b: { alpha: 1, dx: -(1 - fast), dy: 0, scale: 1, rot: 0, blur: bl } };
    }
    case 'zoomblur':
      return { a: idFx(1), b: { alpha: f, dx: 0, dy: 0, scale: 0.5 + 0.5 * e, rot: 0, blur: 0.12 * bell(f), radial: true } };
    case 'blurdissolve': {
      const bl = 0.06 * bell(f);
      return { a: { alpha: 1 - f, dx: 0, dy: 0, scale: 1, rot: 0, blur: bl }, b: { alpha: f, dx: 0, dy: 0, scale: 1, rot: 0, blur: bl } };
    }
    default:
      return { a: idFx(1 - f), b: idFx(f) }; // dissolve
  }
}

export type BlendMode = 'normal' | 'add' | 'screen' | 'multiply';
export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'screen', 'multiply'];
export const BLEND_LABEL: Record<BlendMode, string> = { normal: 'Обычный', add: 'Сложение', screen: 'Экран', multiply: 'Умножение' };

// Текстовый клип (титры). x,y — доля кадра (центр текста), size — % высоты кадра.
export type TextAlign = 'left' | 'center' | 'right';
export type TextFont = 'sans' | 'serif' | 'mono' | 'display' | 'hand';
export const TEXT_FONTS: { id: TextFont; label: string; css: string }[] = [
  { id: 'sans', label: 'Sans', css: 'system-ui, "Segoe UI", Arial, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Моно', css: '"Consolas", "Courier New", monospace' },
  { id: 'display', label: 'Дисплей', css: '"Impact", "Arial Black", sans-serif' },
  { id: 'hand', label: 'Рукопись', css: '"Comic Sans MS", "Segoe Print", cursive' },
];
// f — либо id встроенного стека, либо имя системного семейства.
export function fontCss(f?: string): string {
  const b = TEXT_FONTS.find((x) => x.id === f);
  if (b) return b.css;
  if (f) return `"${f}", system-ui, sans-serif`;
  return TEXT_FONTS[0].css;
}

export interface ClipText {
  content: string;
  size: number;
  color: string;
  x: number;
  y: number;
  bg: boolean; // подложка-плашка под текстом
  font?: string; // id встроенного стека ('sans'…) или имя системного шрифта
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign;
  opacity?: number; // 0..1
  bgColor?: string; // цвет плашки
  outline?: number; // толщина обводки (px @ высота проекта / 100), 0 = нет
  outlineColor?: string;
  shadow?: boolean; // тень
  letterSpacing?: number; // трекинг (% высоты проекта на em)
  lineHeight?: number; // множитель межстрочного
  fadeIn?: number; // появление, сек (0 = мгновенно)
  fadeOut?: number; // исчезновение, сек
}
export const DEFAULT_TEXT: ClipText = {
  content: 'Заголовок',
  size: 8,
  color: '#ffffff',
  x: 0.5,
  y: 0.85,
  bg: false,
  font: 'sans',
  bold: true,
  italic: false,
  align: 'center',
  opacity: 1,
  bgColor: '#000000',
  outline: 0,
  outlineColor: '#000000',
  shadow: true,
  letterSpacing: 0,
  lineHeight: 1.15,
  fadeIn: 0,
  fadeOut: 0,
};

// Пресеты стилей текста (быстрый старт).
export const TEXT_PRESETS: { name: string; text: Partial<ClipText> }[] = [
  { name: 'Заголовок', text: { font: 'display', bold: true, size: 11, color: '#ffffff', outline: 0, shadow: true, bg: false } },
  { name: 'Субтитры', text: { font: 'sans', bold: true, size: 6, color: '#ffffff', outline: 0.6, outlineColor: '#000000', shadow: false, bg: false, y: 0.88 } },
  { name: 'Плашка', text: { font: 'sans', bold: true, size: 7, color: '#ffffff', bg: true, bgColor: '#000000', shadow: false, outline: 0 } },
  { name: 'Неон', text: { font: 'display', bold: true, size: 12, color: '#ccff00', outline: 0.4, outlineColor: '#1a1a00', shadow: true } },
  { name: 'Контур', text: { font: 'display', bold: true, size: 12, color: '#ffffff', outline: 1.2, outlineColor: '#000000', shadow: false, bg: false } },
];

// Прозрачность текста в момент localSec с учётом fade in/out.
export function textOpacityAt(t: ClipText, localSec: number, duration: number): number {
  const base = t.opacity ?? 1;
  let f = 1;
  if (t.fadeIn && t.fadeIn > 0) f = Math.min(f, Math.max(0, localSec / t.fadeIn));
  if (t.fadeOut && t.fadeOut > 0) f = Math.min(f, Math.max(0, (duration - localSec) / t.fadeOut));
  return base * Math.max(0, Math.min(1, f));
}

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

// Тип сглаживания на выходе из ключа (плавность/бизье).
export type KfEase = 'linear' | 'smooth' | 'in' | 'out';
export const KF_EASES: KfEase[] = ['linear', 'smooth', 'in', 'out'];
export const KF_EASE_LABEL: Record<KfEase, string> = { linear: 'Линейно', smooth: 'Плавно', in: 'Ускорение', out: 'Замедление' };

// Ключ одного параметра (t — сек от начала клипа, v — значение, ease — сглаживание к следующему).
export interface Kf {
  t: number;
  v: number;
  ease?: KfEase;
}
export type KfParam = 'x' | 'y' | 'scale' | 'rotation';
export const KF_PARAMS: KfParam[] = ['x', 'y', 'scale', 'rotation'];
export const KF_PARAM_LABEL: Record<KfParam, string> = { x: 'Position X', y: 'Position Y', scale: 'Scale', rotation: 'Rotation' };
// Отдельная дорожка ключей на каждый параметр.
export interface Keyframes {
  x?: Kf[];
  y?: Kf[];
  scale?: Kf[];
  rotation?: Kf[];
}

function easeF(f: number, e?: KfEase): number {
  switch (e) {
    case 'smooth':
      return f * f * (3 - 2 * f); // smoothstep (бизье-подобно)
    case 'in':
      return f * f;
    case 'out':
      return f * (2 - f);
    default:
      return f;
  }
}

function interpKf(track: Kf[], t: number): number {
  const s = [...track].sort((a, b) => a.t - b.t);
  if (t <= s[0].t) return s[0].v;
  const last = s[s.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (t >= a.t && t <= b.t) {
      let f = (t - a.t) / ((b.t - a.t) || 1);
      f = easeF(f, a.ease); // сглаживание на сегменте определяется ключом-началом
      return a.v + (b.v - a.v) * f;
    }
  }
  return last.v;
}

// Transform клипа в момент localSec с учётом ключей (каждый параметр — независимо).
export function transformAt(clip: ProClip, localSec: number): ClipTransform {
  const base = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const kf = clip.keyframes;
  if (!kf) return base;
  const g = (track: Kf[] | undefined, fb: number) => (track && track.length ? interpKf(track, localSec) : fb);
  return { x: g(kf.x, base.x), y: g(kf.y, base.y), scale: g(kf.scale, base.scale), rotation: g(kf.rotation, base.rotation) };
}

// Предыдущий клип, вплотную примыкающий слева к данному (для crossfade). Пары одного рода (текст↔текст, видео↔видео).
export function findPrevAdjacent(clips: ProClip[], clip: ProClip): ProClip | null {
  const cands = clips
    .filter((c) => c.trackId === clip.trackId && c.id !== clip.id && !!c.text === !!clip.text && Math.abs(c.timelineStart + c.duration - clip.timelineStart) < 0.06)
    .sort((a, b) => b.timelineStart - a.timelineStart);
  return cands[0] ?? null;
}

// Окно перехода на резе (относительно B.timelineStart) с учётом выравнивания.
export function transitionSpan(B: ProClip): { d: number; s: number; e: number } | null {
  if (!B.transition) return null;
  const d = B.transition.duration;
  const align = B.transition.align || 'center';
  const s = align === 'left' ? B.timelineStart : align === 'right' ? B.timelineStart - d : B.timelineStart - d / 2;
  return { d, s, e: s + d };
}

// Альфы входящего/уходящего слоёв в момент ph внутри окна перехода (null — вне окна).
export function crossfadeAlpha(B: ProClip, ph: number): { inA: number; outA: number; f: number } | null {
  const sp = transitionSpan(B);
  if (!sp || ph < sp.s || ph >= sp.e) return null;
  const f = Math.max(0, Math.min(1, (ph - sp.s) / sp.d));
  const kind = B.transition!.kind || 'dissolve';
  const inA = kind === 'fadeblack' ? Math.max(0, 2 * f - 1) : f;
  const outA = kind === 'fadeblack' ? Math.max(0, 1 - 2 * f) : 1 - f;
  return { inA, outA, f };
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
