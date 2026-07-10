import { useProjectStore } from '../store/projectStore';
import { regenerateMontage } from '../utils/regenerate';
import { EFFECT_NAMES, type EffectName, type FilterName } from '../types';

// Шаблоны монтажа «в стиле» популярных TikTok-трендов. Один клик выставляет
// ритм, эффекты, переходы, грейд, длительность и формат сразу. Музыку НЕ меняем
// (это выбор пользователя), но подсказываем подходящую категорию трека.

export interface TemplateEffect {
  level: 0 | 1 | 2;
  variant?: string;
  intensity?: number; // 0..100
}

export interface Template {
  key: string;
  title: string;
  desc: string;
  icon: string;
  duration: number; // рекомендуемая длина, сек
  format: '9:16' | '1:1' | '16:9';
  mood: 'mellow' | 'natural' | 'energetic';
  transition: 'none' | 'dissolve' | 'slide' | 'zoom' | 'mix';
  filter: FilterName | null;
  filterIntensity: number;
  effects: Partial<Record<EffectName, TemplateEffect>>;
  musicCategory?: string; // подсказка: POP/RAP/CINEMATIC/SPORT/…
}

export const TEMPLATES: Template[] = [
  {
    key: 'velocity',
    title: 'Velocity Drop',
    desc: 'Скоростной хайп: резы на каждый бит, панч-зум и вспышки на дропе.',
    icon: '⚡',
    duration: 15,
    format: '9:16',
    mood: 'energetic',
    transition: 'slide',
    filter: 'vcr',
    filterIntensity: 35,
    effects: {
      fastCut: { level: 2, variant: 'strobe', intensity: 70 },
      zoom: { level: 2, variant: 'punch', intensity: 80 },
      flash: { level: 1, variant: 'white', intensity: 55 },
      rgb: { level: 1, intensity: 50 },
    },
    musicCategory: 'RAP',
  },
  {
    key: 'aesthetic',
    title: 'Aesthetic Vibes',
    desc: 'Мягко и тепло: лёгкая засветка, плавный наезд, растворение.',
    icon: '🌸',
    duration: 15,
    format: '9:16',
    mood: 'mellow',
    transition: 'dissolve',
    filter: 'lightLeak',
    filterIntensity: 55,
    effects: {
      leak: { level: 1, intensity: 45 },
      zoom: { level: 1, variant: 'in', intensity: 35 },
    },
    musicCategory: 'ACOUSTIC',
  },
  {
    key: 'cinematic',
    title: 'Simple Cinematic',
    desc: 'Кино-грейд (matte-тени, teal-orange), спокойный ритм, мягкий наезд. Минимум эффектов.',
    icon: '🎬',
    duration: 16,
    format: '9:16',
    mood: 'mellow',
    transition: 'dissolve',
    filter: 'cinematic',
    filterIntensity: 90,
    effects: {
      zoom: { level: 1, variant: 'in', intensity: 28 },
    },
    musicCategory: 'CINEMATIC',
  },
  {
    key: 'gym',
    title: 'Gym Motivation',
    desc: 'Жёсткая энергетика: тряска камеры, панч-зум, контрастный грейд.',
    icon: '🏋️',
    duration: 20,
    format: '9:16',
    mood: 'energetic',
    transition: 'mix',
    filter: 'vcr',
    filterIntensity: 45,
    effects: {
      shake: { level: 2, intensity: 65 },
      zoom: { level: 2, variant: 'punch', intensity: 70 },
      flash: { level: 1, variant: 'white', intensity: 50 },
    },
    musicCategory: 'SPORT',
  },
  {
    key: 'travel',
    title: 'Travel Vlog',
    desc: 'Тёплый грейд, плавный зум, лёгкая призма. Для поездок и влогов.',
    icon: '✈️',
    duration: 30,
    format: '9:16',
    mood: 'natural',
    transition: 'zoom',
    filter: 'warm',
    filterIntensity: 30,
    effects: {
      zoom: { level: 1, variant: 'in', intensity: 40 },
      prism: { level: 1, intensity: 25 },
    },
    musicCategory: 'TRAVEL',
  },
  {
    key: 'glitch',
    title: 'Glitch / Cyber',
    desc: 'Цифровой глитч: RGB-смещение, призма, дёрганый грейд.',
    icon: '👾',
    duration: 15,
    format: '9:16',
    mood: 'energetic',
    transition: 'slide',
    filter: 'glitch',
    filterIntensity: 45,
    effects: {
      glitch: { level: 2, intensity: 70 },
      rgb: { level: 2, intensity: 60 },
      prism: { level: 1, intensity: 45 },
    },
    musicCategory: 'HOUSE',
  },
  {
    key: 'retro',
    title: 'Retro VHS',
    desc: 'Плёнка 90-х: винтаж-грейд, hue-ротация, мягкая призма.',
    icon: '📼',
    duration: 15,
    format: '9:16',
    mood: 'natural',
    transition: 'dissolve',
    filter: 'vintage',
    filterIntensity: 60,
    effects: {
      hue: { level: 1, intensity: 30 },
      prism: { level: 1, intensity: 30 },
    },
    musicCategory: 'FUNK',
  },
  {
    key: 'clean',
    title: 'Clean / Minimal',
    desc: 'Чисто и плавно: без эффектов, мягкое растворение по битам.',
    icon: '✨',
    duration: 15,
    format: '9:16',
    mood: 'natural',
    transition: 'dissolve',
    filter: null,
    filterIntensity: 0,
    effects: {},
    musicCategory: 'POP',
  },
];

// Применить шаблон: сбросить эффекты, выставить нужные (уровень/вариант/сила),
// mood, переходы, фильтр, длительность и формат, затем пересобрать монтаж.
export function applyTemplate(t: Template): void {
  const s = useProjectStore.getState();

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
  s.setDuration(t.duration);
  s.setFormat(t.format);

  regenerateMontage();
}
