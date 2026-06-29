import type { EffectName } from '../types';

// 9 эффектов вкладки EDIT (§7 ТЗ): название, иконка, FFmpeg-реализация.
// Поле ffmpeg используется в ffmpegBuilder.ts (Шаг 9). fastCut — поведение
// нарезки (сверхкороткие фрагменты), без отдельного фильтра.
export interface EffectVariant {
  key: string;
  label: string;
}

export interface EffectMeta {
  key: EffectName;
  label: string;
  icon: string;
  ffmpeg: string;
  variants: EffectVariant[]; // [] = только ползунок интенсивности
}

export const EFFECTS: EffectMeta[] = [
  {
    key: 'fastCut', label: 'Fast Cut', icon: '⚡', ffmpeg: '',
    variants: [
      { key: 'cuts', label: 'Резкие кадры' },
      { key: 'strobe', label: 'Строб' },
    ],
  },
  {
    key: 'flash', label: 'Flash', icon: '◎', ffmpeg: "geq=r='255':g='255':b='255'",
    variants: [
      { key: 'white', label: 'Белая' },
      { key: 'black', label: 'Чёрная' },
    ],
  },
  {
    key: 'zoom', label: 'Zoom', icon: '🔍', ffmpeg: '',
    variants: [
      { key: 'in', label: 'Наезд' },
      { key: 'out', label: 'Отъезд' },
      { key: 'punch', label: 'Пунч' },
    ],
  },
  { key: 'prism', label: 'Prism', icon: '🔺', ffmpeg: 'rgbashift=rh=5:bh=-5', variants: [] },
  { key: 'rgb', label: 'RGB', icon: '◐', ffmpeg: 'rgbashift=rh=8:bh=-8', variants: [] },
  { key: 'boomerang', label: 'Boomerang', icon: '↔', ffmpeg: 'reverse', variants: [] },
  {
    key: 'split', label: 'Split', icon: '▦', ffmpeg: '',
    variants: [
      { key: '2x2', label: '2×2' },
      { key: 'mirror', label: 'Зеркало' },
      { key: 'vertical', label: '2 полосы' },
    ],
  },
  { key: 'hue', label: 'Hue', icon: '🌈', ffmpeg: "hue=h='360*t'", variants: [] },
  {
    key: 'speed', label: 'Speed', icon: '⏩', ffmpeg: '',
    variants: [
      { key: 'up', label: 'Разгон' },
      { key: 'down', label: 'Замедление' },
      { key: 'constant', label: 'Постоянная' },
    ],
  },
  { key: 'shake', label: 'Shake', icon: '📳', ffmpeg: '', variants: [] },
  { key: 'glitch', label: 'Glitch', icon: '📺', ffmpeg: '', variants: [] },
  { key: 'leak', label: 'Light Leak', icon: '🔆', ffmpeg: '', variants: [] },
];

// Вариант по умолчанию для эффекта (первый из списка или 'default').
export function defaultVariant(key: EffectName): string {
  const meta = EFFECTS.find((e) => e.key === key);
  return meta?.variants[0]?.key ?? 'default';
}
