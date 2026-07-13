// Многосценовые шаблоны как ДАННЫЕ: каждая сцена — тип + контент + переход входа.
// UI показывает сцены на таймлайне, даёт менять переходы/тексты и превью вживую;
// движок (runtime.html, id='scenes') строит ровно это же → WYSIWYG.

export type Transition =
  | 'fade' | 'mirror' | 'swipe' | 'swipeUp' | 'zoom' | 'wipe' | 'text'
  | 'flash' | 'punch' | 'glitchcut';

export const TRANSITIONS: { key: Transition; label: string }[] = [
  { key: 'fade', label: 'Растворение' },
  { key: 'wipe', label: 'Плашка-свайп' },
  { key: 'text', label: 'Текст-переход' },
  { key: 'mirror', label: 'Зеркальный флип' },
  { key: 'swipe', label: 'Сдвиг вбок' },
  { key: 'swipeUp', label: 'Сдвиг вверх' },
  { key: 'zoom', label: 'Зум' },
  { key: 'flash', label: 'Засветка' },
  { key: 'punch', label: 'Зум-удар' },
  { key: 'glitchcut', label: 'Глитч-рез' },
];

export type SceneSpec =
  | { type: 'text'; dur: number; trans: Transition; kicker?: string; text: string; size?: number; align?: 'left' | 'center' }
  | { type: 'photo'; dur: number; trans: Transition; slot: number; caption?: string; from?: 'left' | 'right'; capBottom?: boolean; kenScale?: boolean }
  | { type: 'cta'; dur: number; trans: Transition; title?: string; cta?: string };

export interface SceneTemplate {
  key: string; // уникальный ключ шаблона (для UI/превью)
  name: string;
  tag: string;
  accent: string;
  preview: string;
  uses: string;
  slotCount: number; // сколько фото требует шаблон
  scenes: SceneSpec[];
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    key: 'story-reel', name: 'Story Reel', tag: 'мультисцена · переходы', accent: '#ff5c8a',
    preview: 'templates/previews/scenes-story-reel.mp4', uses: '2.4M', slotCount: 2,
    scenes: [
      { type: 'text', dur: 1.3, trans: 'fade', kicker: 'presenting', text: 'SUMMER', size: 16, align: 'left' },
      { type: 'photo', dur: 1.5, trans: 'wipe', slot: 0, caption: 'look 01', from: 'left' },
      { type: 'photo', dur: 1.5, trans: 'mirror', slot: 1, caption: 'look 02', from: 'right', capBottom: true, kenScale: true },
      { type: 'cta', dur: 1.7, trans: 'zoom', title: 'new drop', cta: 'Tap to shop' },
    ],
  },
  {
    key: 'kinetic-trio', name: 'Kinetic Trio', tag: 'драйв · текст+фото', accent: '#ccff00',
    preview: 'templates/previews/scenes-kinetic-trio.mp4', uses: '3.1M', slotCount: 2,
    scenes: [
      { type: 'text', dur: 1.1, trans: 'fade', kicker: 'drop 02', text: 'GO CRAZY', size: 15, align: 'left' },
      { type: 'photo', dur: 1.3, trans: 'swipe', slot: 0, caption: 'move 01', from: 'left' },
      { type: 'text', dur: 1.0, trans: 'swipeUp', kicker: '', text: 'LET’S GO', size: 17, align: 'center' },
      { type: 'photo', dur: 1.3, trans: 'zoom', slot: 1, caption: 'move 02', from: 'right', capBottom: true },
      { type: 'cta', dur: 1.5, trans: 'wipe', title: 'shop now', cta: 'Get it' },
    ],
  },
  {
    key: 'clip-reel', name: 'Clip Reel', tag: 'видео · драйв', accent: '#00e5ff',
    preview: 'templates/previews/scenes-clip-reel.mp4', uses: '4.0M', slotCount: 3,
    scenes: [
      { type: 'text', dur: 1.0, trans: 'fade', kicker: 'now', text: 'CLIP REEL', size: 15, align: 'center' },
      { type: 'photo', dur: 1.4, trans: 'flash', slot: 0, caption: 'clip 01', from: 'left' },
      { type: 'photo', dur: 1.4, trans: 'glitchcut', slot: 1, caption: 'clip 02', from: 'right', capBottom: true },
      { type: 'photo', dur: 1.4, trans: 'punch', slot: 2, caption: 'clip 03', from: 'left' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'follow', cta: 'Subscribe' },
    ],
  },
  {
    key: 'mirror-fashion', name: 'Mirror Fashion', tag: 'fashion · зеркала', accent: '#c8a26a',
    preview: 'templates/previews/scenes-mirror-fashion.mp4', uses: '1.6M', slotCount: 3,
    scenes: [
      { type: 'text', dur: 1.2, trans: 'fade', kicker: 'the edit', text: 'AW 2026', size: 15, align: 'center' },
      { type: 'photo', dur: 1.4, trans: 'mirror', slot: 0, caption: '01', from: 'left' },
      { type: 'photo', dur: 1.4, trans: 'mirror', slot: 1, caption: '02', from: 'right', capBottom: true },
      { type: 'photo', dur: 1.4, trans: 'mirror', slot: 2, caption: '03', from: 'left', kenScale: true },
      { type: 'cta', dur: 1.6, trans: 'zoom', title: 'quiet luxury', cta: 'Discover' },
    ],
  },
];

// Итоговая длительность = сумма длительностей сцен.
export const sceneTemplateDuration = (t: SceneTemplate): number =>
  t.scenes.reduce((s, sc) => s + sc.dur, 0);
