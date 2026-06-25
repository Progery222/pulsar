// Пресеты под площадки: один клик задаёт формат кадра, разрешение и рекомендуемую длительность.
export type PresetFormat = '9:16' | '1:1' | '16:9';
export type PresetQuality = '720p' | '1080p' | '4k';

export interface PlatformPreset {
  key: string;
  label: string;
  format: PresetFormat;
  quality: PresetQuality;
  maxDuration: number; // рекомендуемый максимум длительности, сек
  note: string;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  { key: 'tiktok', label: 'TikTok', format: '9:16', quality: '1080p', maxDuration: 180, note: '9:16 • 1080p • до 3 мин' },
  { key: 'reels', label: 'Instagram Reels', format: '9:16', quality: '1080p', maxDuration: 90, note: '9:16 • 1080p • до 90 сек' },
  { key: 'shorts', label: 'YouTube Shorts', format: '9:16', quality: '1080p', maxDuration: 60, note: '9:16 • 1080p • до 60 сек' },
  { key: 'youtube', label: 'YouTube', format: '16:9', quality: '4k', maxDuration: 0, note: '16:9 • 4K • без лимита' },
  { key: 'insta_post', label: 'Instagram (квадрат)', format: '1:1', quality: '1080p', maxDuration: 60, note: '1:1 • 1080p • до 60 сек' },
];
