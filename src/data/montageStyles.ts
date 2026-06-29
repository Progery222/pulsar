import { useProjectStore } from '../store/projectStore';
import { regenerateMontage } from '../utils/regenerate';
import { EFFECT_NAMES, type EffectName, type FilterName } from '../types';

// B4: стиль-пресеты монтажа — один клик задаёт mood, набор эффектов (уровень/вариант/
// силу) и фильтр. Меняет нарезку (через mood), поэтому применяется regenerateMontage.

export interface StyleEffect {
  level: 0 | 1 | 2;
  variant?: string;
  intensity?: number; // 0..100
}

export interface MontageStyle {
  key: string;
  label: string;
  icon: string;
  mood: 'mellow' | 'natural' | 'energetic';
  filter: FilterName | null;
  filterIntensity: number;
  effects: Partial<Record<EffectName, StyleEffect>>;
}

export const MONTAGE_STYLES: MontageStyle[] = [
  {
    key: 'hype',
    label: 'TikTok Hype',
    icon: '🔥',
    mood: 'energetic',
    filter: 'glitch',
    filterIntensity: 30,
    effects: {
      fastCut: { level: 2, variant: 'strobe', intensity: 70 },
      zoom: { level: 2, variant: 'punch', intensity: 75 },
      flash: { level: 1, variant: 'white', intensity: 60 },
      rgb: { level: 1, intensity: 55 },
    },
  },
  {
    key: 'cinematic',
    label: 'Cinematic',
    icon: '🎬',
    mood: 'mellow',
    filter: 'film',
    filterIntensity: 55,
    effects: {
      zoom: { level: 1, variant: 'in', intensity: 35 },
      hue: { level: 1, intensity: 25 },
    },
  },
  {
    key: 'smooth',
    label: 'Smooth',
    icon: '🌊',
    mood: 'natural',
    filter: 'warm',
    filterIntensity: 30,
    effects: {
      zoom: { level: 1, variant: 'in', intensity: 40 },
      prism: { level: 1, intensity: 30 },
    },
  },
  {
    key: 'clean',
    label: 'Clean',
    icon: '✨',
    mood: 'natural',
    filter: null,
    filterIntensity: 0,
    effects: {},
  },
];

// Применить пресет: сбросить все эффекты, выставить нужные, фильтр и mood, пересобрать.
export function applyMontageStyle(style: MontageStyle): void {
  const s = useProjectStore.getState();

  for (const name of EFFECT_NAMES) {
    const preset = style.effects[name];
    s.setActiveEffect(name, preset ? preset.level : 0);
    if (preset?.variant !== undefined || preset?.intensity !== undefined) {
      s.setEffectSetting(name, {
        ...(preset.variant !== undefined ? { variant: preset.variant } : {}),
        ...(preset.intensity !== undefined ? { intensity: preset.intensity } : {}),
      });
    }
  }

  s.setActiveFilter(style.filter);
  s.setFilterIntensity(style.filterIntensity);
  s.setMood(style.mood);

  regenerateMontage();
}
