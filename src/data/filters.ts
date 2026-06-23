import type { FilterName } from '../types';

// 10 фильтров вкладки FILTERS (§8 ТЗ).
// css — приближённое превью в UI; ffmpeg — реальная реализация в ffmpegBuilder (§10).
export interface FilterMeta {
  key: FilterName | 'none';
  label: string;
  css: string;
  ffmpeg: string;
}

export const FILTERS: FilterMeta[] = [
  { key: 'none', label: 'Нет', css: 'none', ffmpeg: '' },
  {
    key: 'warm',
    label: 'Warm',
    css: 'sepia(0.25) saturate(1.2) hue-rotate(-10deg)',
    ffmpeg: "curves=r='0/0 0.5/0.6 1/1':b='0/0 0.5/0.4 1/0.9'",
  },
  {
    key: 'cool',
    label: 'Cool',
    css: 'saturate(1.1) hue-rotate(15deg) brightness(1.02)',
    ffmpeg: "curves=r='0/0 0.5/0.4 1/0.9':b='0/0 0.5/0.6 1/1'",
  },
  {
    key: 'vintage',
    label: 'Vintage',
    css: 'sepia(0.4) contrast(0.95) saturate(0.85)',
    ffmpeg: "curves=r='0/0.1 1/0.9':g='0/0.05 1/0.85':b='0/0.1 1/0.8'",
  },
  { key: 'bw', label: 'B&W', css: 'grayscale(1)', ffmpeg: 'hue=s=0' },
  {
    key: 'vcr',
    label: 'VCR',
    css: 'saturate(1.3) contrast(1.1)',
    ffmpeg: 'noise=alls=18:allf=t,curves=r=0/0.05',
  },
  {
    key: 'glitch',
    label: 'Glitch',
    css: 'hue-rotate(20deg) saturate(1.4)',
    ffmpeg: 'noise=alls=15:allf=t,rgbashift=rh=4:bh=-4',
  },
  { key: 'film', label: 'Film', css: 'contrast(1.05) sepia(0.15)', ffmpeg: 'noise=alls=20:allf=t' },
  {
    key: 'lightLeak',
    label: 'Light Leak',
    css: 'brightness(1.1) saturate(1.15)',
    ffmpeg: 'eq=brightness=0.05:saturation=1.2',
  },
  { key: 'vignette', label: 'Vignette', css: 'brightness(0.95)', ffmpeg: 'vignette=angle=PI/4' },
];
