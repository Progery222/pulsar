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
    key: 'cinematic',
    label: 'Cinematic',
    css: 'contrast(1.06) saturate(0.92) brightness(1.02)',
    ffmpeg:
      "curves=all='0/0.03 0.25/0.22 0.5/0.5 0.75/0.78 1/0.96',colorbalance=rs=-0.06:bs=0.08:rh=0.07:bh=-0.05,eq=saturation=0.92,noise=alls=6:allf=t,vignette=PI/5",
  },
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
    ffmpeg: 'curves=r=0/0.05,eq=saturation=1.2:contrast=1.08,noise=alls=10:allf=t',
  },
  {
    key: 'glitch',
    label: 'Glitch',
    css: 'hue-rotate(20deg) saturate(1.4)',
    ffmpeg: 'rgbashift=rh=4:bh=-4,eq=saturation=1.25,noise=alls=8:allf=t',
  },
  { key: 'film', label: 'Film', css: 'contrast(1.05) sepia(0.15)', ffmpeg: "curves=all='0/0.02 0.5/0.52 1/0.98',eq=saturation=1.06,noise=alls=7:allf=t" },
  {
    key: 'lightLeak',
    label: 'Light Leak',
    css: 'brightness(1.1) saturate(1.15)',
    ffmpeg: 'eq=brightness=0.05:saturation=1.2',
  },
  { key: 'vignette', label: 'Vignette', css: 'brightness(0.95)', ffmpeg: 'vignette=angle=PI/4' },
];
