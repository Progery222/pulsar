import type { EffectName } from '../types';

// 9 эффектов вкладки EDIT (§7 ТЗ): название, иконка, FFmpeg-реализация.
// Поле ffmpeg используется в ffmpegBuilder.ts (Шаг 9). fastCut — поведение
// нарезки (сверхкороткие фрагменты), без отдельного фильтра.
export interface EffectMeta {
  key: EffectName;
  label: string;
  icon: string;
  ffmpeg: string;
}

export const EFFECTS: EffectMeta[] = [
  { key: 'fastCut', label: 'Fast Cut', icon: '⚡', ffmpeg: '' },
  { key: 'flash', label: 'Flash', icon: '◎', ffmpeg: "geq=r='255':g='255':b='255'" },
  { key: 'zoom', label: 'Zoom', icon: '🔍', ffmpeg: "zoompan=z='zoom+0.05':d=1" },
  { key: 'prism', label: 'Prism', icon: '🔺', ffmpeg: 'rgbashift=rh=5:bh=-5' },
  { key: 'rgb', label: 'RGB', icon: '◐', ffmpeg: 'split=3[r][g][b];[r]lutrgb=r=val:g=0:b=0' },
  { key: 'boomerang', label: 'Boomerang', icon: '↔', ffmpeg: 'reverse' },
  { key: 'split', label: 'Split', icon: '▦', ffmpeg: 'tile=2x2' },
  { key: 'hue', label: 'Hue', icon: '🌈', ffmpeg: "hue=h='360*t'" },
  { key: 'speed', label: 'Speed', icon: '⏩', ffmpeg: 'setpts=0.5*PTS' },
];
