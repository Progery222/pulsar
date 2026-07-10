import tracksData from '../data/tracks.json';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { EFFECT_NAMES, type EffectName, type FilterName, type Track } from '../types';

// Видео-монтаж-шаблоны: «рецепт» для beat-sync движка (трек + стиль). Пользователь
// кидает N роликов → applyMontageTemplate выставляет трек+стиль и уводит в подбор
// клипов → processing → editor (тот же пайплайн beatDetection/videoSlicer/effects).

export interface MontageStyleEffect {
  level: 0 | 1 | 2;
  variant?: string;
  intensity?: number;
}

export interface MontageTemplate {
  id: string;
  name: string;
  tag: string;
  icon: string;
  accent: string;
  preview: string; // относительный путь к превью-видео (public/templates/previews/montage/*.mp4)
  uses: string; // «соцдоказательство» — счётчик использований в стиле CapCut-трендов
  trackId: string;
  mood: 'mellow' | 'natural' | 'energetic';
  transition: 'none' | 'dissolve' | 'slide' | 'zoom' | 'mix';
  filter: FilterName | null;
  filterIntensity: number;
  effects: Partial<Record<EffectName, MontageStyleEffect>>;
  format: '9:16' | '1:1' | '16:9';
  duration: number;
}

export const MONTAGE_TEMPLATES: MontageTemplate[] = [
  {
    id: 'travel-cine', name: 'Travel Cinematic', tag: 'путешествия · кино', icon: '✈️', accent: '#a9d2ff',
    preview: 'templates/previews/montage/travel-cine.mp4', uses: '1.2M',
    trackId: 'track_009', mood: 'natural', transition: 'dissolve', filter: 'cinematic', filterIntensity: 85,
    effects: { zoom: { level: 1, variant: 'in', intensity: 35 } }, format: '9:16', duration: 24,
  },
  {
    id: 'hype-beat', name: 'Hype Beat', tag: 'хайп · дроп', icon: '⚡', accent: '#ccff00',
    preview: 'templates/previews/montage/hype-beat.mp4', uses: '3.4M',
    trackId: 'track_003', mood: 'energetic', transition: 'mix', filter: 'vcr', filterIntensity: 35,
    effects: {
      fastCut: { level: 2, variant: 'strobe', intensity: 70 },
      zoom: { level: 2, variant: 'punch', intensity: 75 },
      flash: { level: 1, variant: 'white', intensity: 55 },
      rgb: { level: 1, intensity: 50 },
    }, format: '9:16', duration: 15,
  },
  {
    id: 'aesthetic', name: 'Aesthetic', tag: 'эстетика · тепло', icon: '🌸', accent: '#ffcc4d',
    preview: 'templates/previews/montage/aesthetic.mp4', uses: '2.1M',
    trackId: 'track_011', mood: 'mellow', transition: 'dissolve', filter: 'lightLeak', filterIntensity: 55,
    effects: { leak: { level: 1, intensity: 45 }, zoom: { level: 1, variant: 'in', intensity: 35 } },
    format: '9:16', duration: 18,
  },
  {
    id: 'gym', name: 'Gym Motivation', tag: 'спорт · драйв', icon: '🏋️', accent: '#ff5c8a',
    preview: 'templates/previews/montage/gym.mp4', uses: '1.8M',
    trackId: 'track_007', mood: 'energetic', transition: 'mix', filter: 'vcr', filterIntensity: 45,
    effects: {
      shake: { level: 2, intensity: 65 },
      zoom: { level: 2, variant: 'punch', intensity: 70 },
      flash: { level: 1, variant: 'white', intensity: 50 },
    }, format: '9:16', duration: 20,
  },
  {
    id: 'retro-vhs', name: 'Retro VHS', tag: 'ретро · плёнка', icon: '📼', accent: '#7c5cff',
    preview: 'templates/previews/montage/retro-vhs.mp4', uses: '890K',
    trackId: 'track_013', mood: 'natural', transition: 'dissolve', filter: 'vintage', filterIntensity: 60,
    effects: { hue: { level: 1, intensity: 30 }, prism: { level: 1, intensity: 30 } },
    format: '9:16', duration: 18,
  },
  {
    id: 'clean', name: 'Clean Recap', tag: 'чисто · воспоминания', icon: '✨', accent: '#3ad1c0',
    preview: 'templates/previews/montage/clean.mp4', uses: '1.5M',
    trackId: 'track_001', mood: 'natural', transition: 'dissolve', filter: 'cinematic', filterIntensity: 50,
    effects: { zoom: { level: 1, variant: 'in', intensity: 25 } }, format: '9:16', duration: 20,
  },
];

// Применить: выставить трек + стиль, поднять флаг skipMusic, увести в подбор клипов.
export function applyMontageTemplate(t: MontageTemplate): void {
  const s = useProjectStore.getState();
  const track = (tracksData as Track[]).find((x) => x.id === t.trackId) || null;
  s.setSelectedTrack(track);

  for (const name of EFFECT_NAMES) {
    const e = t.effects[name];
    s.setActiveEffect(name, e ? e.level : 0);
    if (e && (e.variant !== undefined || e.intensity !== undefined)) {
      s.setEffectSetting(name, {
        ...(e.variant !== undefined ? { variant: e.variant } : {}),
        ...(e.intensity !== undefined ? { intensity: e.intensity } : {}),
      });
    }
  }
  s.setMood(t.mood);
  s.setTransition(t.transition);
  s.setActiveFilter(t.filter);
  s.setFilterIntensity(t.filterIntensity);
  s.setFormat(t.format);
  s.setDuration(t.duration);

  useUIStore.getState().setSkipMusic(true);
  useUIStore.getState().setAppMode('editor');
  s.setCurrentScreen('media');
}
