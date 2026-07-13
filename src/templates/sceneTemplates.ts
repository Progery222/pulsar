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
  | { type: 'text'; dur: number; trans: Transition; kicker?: string; text: string; size?: number; align?: 'left' | 'center'; bg?: string; color?: string }
  | { type: 'photo'; dur: number; trans: Transition; slot: number; caption?: string; from?: 'left' | 'right'; capBottom?: boolean; kenScale?: boolean }
  | { type: 'cover'; dur: number; trans: Transition; slot: number; kicker?: string; text?: string }
  | { type: 'split'; dur: number; trans: Transition; slot: number; slot2: number; caption?: string }
  | { type: 'stat'; dur: number; trans: Transition; kicker?: string; text: string; caption?: string; bg?: string }
  | { type: 'list'; dur: number; trans: Transition; title?: string; items: string[]; bg?: string }
  | { type: 'quote'; dur: number; trans: Transition; text: string; caption?: string; bg?: string }
  | { type: 'cta'; dur: number; trans: Transition; title?: string; cta?: string; bg?: string };

// Сколько медиа-слотов реально нужно шаблону (макс. индекс слота + 1).
export const templateSlotCount = (scenes: SceneSpec[]): number =>
  scenes.reduce((mx, s) => {
    if (s.type === 'photo' || s.type === 'cover') return Math.max(mx, s.slot + 1);
    if (s.type === 'split') return Math.max(mx, s.slot + 1, s.slot2 + 1);
    return mx;
  }, 0);

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
    key: 'promo-drop', name: 'Promo Drop', tag: 'товар · распродажа', accent: '#ff2d6b',
    preview: 'templates/previews/scenes-promo-drop.mp4', uses: '2.8M', slotCount: 2,
    scenes: [
      { type: 'cover', dur: 1.4, trans: 'fade', slot: 0, kicker: 'new arrival', text: 'SUMMER SALE' },
      { type: 'stat', dur: 1.2, trans: 'punch', kicker: 'up to', text: '-50%', caption: 'today only' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 1, kicker: 'limited', text: 'GRAB YOURS' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'don’t miss it', cta: 'Shop now' },
    ],
  },
  {
    key: 'top-reasons', name: 'Top Reasons', tag: 'список · инфо', accent: '#ccff00',
    preview: 'templates/previews/scenes-top-reasons.mp4', uses: '1.9M', slotCount: 1,
    scenes: [
      { type: 'text', dur: 1.2, trans: 'fade', kicker: 'why', text: '3 REASONS', size: 15, align: 'center', bg: 'linear-gradient(180deg,#f4f1ea,#e7e0d3)', color: '#141414' },
      { type: 'list', dur: 2.4, trans: 'swipeUp', title: 'why us', items: ['fast & easy', 'best price', 'loved by 10k+'] },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'proof', text: 'SEE FOR YOURSELF' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'try it', cta: 'Get started' },
    ],
  },
  {
    key: 'split-story', name: 'Split Story', tag: 'сплит · динамика', accent: '#00e5ff',
    preview: 'templates/previews/scenes-split-story.mp4', uses: '3.3M', slotCount: 3,
    scenes: [
      { type: 'text', dur: 1.1, trans: 'fade', kicker: 'this vs that', text: 'YOU DECIDE', size: 15, align: 'left' },
      { type: 'split', dur: 1.6, trans: 'swipe', slot: 0, slot2: 1, caption: 'vs' },
      { type: 'cover', dur: 1.4, trans: 'mirror', slot: 2, kicker: 'the winner', text: 'THIS ONE' },
      { type: 'quote', dur: 1.6, trans: 'flash', text: 'trust me on this', caption: '— everyone' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'your turn', cta: 'Tap in' },
    ],
  },
  {
    key: 'bold-quote', name: 'Bold Quote', tag: 'цитаты · типографика', accent: '#ffcc4d',
    preview: 'templates/previews/scenes-bold-quote.mp4', uses: '1.4M', slotCount: 1,
    scenes: [
      { type: 'quote', dur: 1.6, trans: 'fade', text: 'dream big', caption: 'day one' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'the journey', text: 'KEEP GOING' },
      { type: 'quote', dur: 1.6, trans: 'glitchcut', text: 'never stop', caption: 'no excuses', bg: '#101014' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'let’s move', cta: 'Follow' },
    ],
  },
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
