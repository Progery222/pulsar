// Каталог шаблонов-композиций. preview — относительный путь к превью-видео
// (public/templates/previews/*.mp4, работает и в dev, и в prod). defaults — стартовые
// тексты/акцент, которые подставляются в редактор при выборе шаблона.

export interface TemplateDef {
  id: string;
  name: string;
  tag: string;
  preview: string;
  accent: string;
  defaults: { eyebrow?: string; title: string; subtitle: string; cta: string };
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'reel',
    name: 'Story Reel',
    tag: 'мультисцена · переходы',
    preview: 'templates/previews/reel.mp4',
    accent: '#ff5c8a',
    defaults: { eyebrow: 'presenting', title: 'SUMMER', subtitle: 'new drop', cta: 'Tap to shop' },
  },
  {
    id: 'kinetic',
    name: 'Kinetic Pop',
    tag: 'драйв · плашки',
    preview: 'templates/previews/kinetic.mp4',
    accent: '#ccff00',
    defaults: { eyebrow: 'new drop', title: 'GO', subtitle: 'crazy', cta: 'Shop now' },
  },
  {
    id: 'glitch',
    name: 'Glitch Hype',
    tag: 'глитч · rgb',
    preview: 'templates/previews/glitch.mp4',
    accent: '#00e5ff',
    defaults: { eyebrow: 'exclusive', title: 'HYPE', subtitle: 'drop 02', cta: 'Get it' },
  },
  {
    id: 'story',
    name: 'Simple Cinematic',
    tag: 'кино · эстетика',
    preview: 'templates/previews/story.mp4',
    accent: '#a9d2ff',
    defaults: { eyebrow: 'exclusive drop', title: 'SUMMER MOOD', subtitle: 'new collection 2026', cta: 'Tap to shop' },
  },
  {
    id: 'neon',
    name: 'Neon Hype',
    tag: 'неон · хайп',
    preview: 'templates/previews/neon.mp4',
    accent: '#00e5ff',
    defaults: { eyebrow: '', title: 'GO CRAZY', subtitle: 'drop 02', cta: 'Shop now' },
  },
  {
    id: 'minimal',
    name: 'Quiet Luxury',
    tag: 'минимал · fashion',
    preview: 'templates/previews/minimal.mp4',
    accent: '#c8a26a',
    defaults: { eyebrow: 'the edit', title: 'QUIET LUXURY', subtitle: 'aw 2026', cta: 'Discover' },
  },
];
