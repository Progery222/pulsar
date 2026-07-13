// Многосценовые шаблоны как ДАННЫЕ: каждая сцена — тип + контент + переход входа.
// UI показывает сцены на таймлайне, даёт менять переходы/тексты и превью вживую;
// движок (runtime.html, id='scenes') строит ровно это же → WYSIWYG.

export type Transition =
  | 'fade' | 'mirror' | 'swipe' | 'swipeUp' | 'zoom' | 'wipe' | 'text'
  | 'flash' | 'punch' | 'glitchcut';

// Глобальные фильтры-грейды (ключи совпадают с FILTERS в runtime.html).
export const FILTERS: { key: string; label: string }[] = [
  { key: 'none', label: 'Без фильтра' },
  { key: 'vivid', label: 'Сочный' },
  { key: 'warm', label: 'Тёплый' },
  { key: 'cool', label: 'Холодный' },
  { key: 'vintage', label: 'Винтаж' },
  { key: 'bw', label: 'Ч/Б' },
  { key: 'vhs', label: 'VHS' },
  { key: 'cinema', label: 'Кино' },
];

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
  | { type: 'beforeafter'; dur: number; trans: Transition; slot: number; slot2: number; text?: string; caption?: string }
  | { type: 'price'; dur: number; trans: Transition; slot?: number; text?: string; old?: string; price?: string; badge?: string }
  | { type: 'countdown'; dur: number; trans: Transition; count?: number; caption?: string; bg?: string }
  | { type: 'hook'; dur: number; trans: Transition; text: string; hint?: string; slot?: number; pos?: 'top' | 'center'; bg?: string }
  | { type: 'cta'; dur: number; trans: Transition; title?: string; cta?: string; bg?: string };

// Сколько медиа-слотов реально нужно шаблону (макс. индекс слота + 1).
export const templateSlotCount = (scenes: SceneSpec[]): number =>
  scenes.reduce((mx, s) => {
    if (s.type === 'photo' || s.type === 'cover') return Math.max(mx, s.slot + 1);
    if (s.type === 'split' || s.type === 'beforeafter') return Math.max(mx, s.slot + 1, s.slot2 + 1);
    if ((s.type === 'price' || s.type === 'hook') && s.slot != null) return Math.max(mx, s.slot + 1);
    return mx;
  }, 0);

export interface SceneTemplate {
  key: string; // уникальный ключ шаблона (для UI/превью)
  name: string;
  tag: string;
  accent: string;
  preview: string;
  uses?: string;
  slotCount: number; // сколько фото требует шаблон
  music?: string; // трек-пресет по умолчанию (id из tracks.json)
  filter?: string; // фильтр-грейд по умолчанию (ключ из FILTERS)
  scenes: SceneSpec[];
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    key: 'pov-story', name: 'POV Hook', tag: 'TikTok · зацеп', accent: '#ff5c8a',
    preview: 'templates/previews/scenes-pov-story.mp4', slotCount: 2, music: 'track_017', filter: 'warm',
    scenes: [
      { type: 'hook', dur: 1.6, trans: 'fade', slot: 0, pos: 'top', text: 'POV: ты нашёл приём, о котором молчат', hint: 'смотри до конца 👀' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 1, kicker: 'вот он', text: 'СМОТРИ' },
      { type: 'list', dur: 2.2, trans: 'swipeUp', title: 'в 3 шага', items: ['выбери шаблон', 'добавь клипы', 'выложи в тренд'] },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'твой ход', cta: 'Подпишись 🔥' },
    ],
  },
  {
    key: 'this-or-that', name: 'This or That', tag: 'TikTok · вовлечение', accent: '#00e5ff',
    preview: 'templates/previews/scenes-this-or-that.mp4', slotCount: 2, music: 'track_007', filter: 'vivid',
    scenes: [
      { type: 'hook', dur: 1.5, trans: 'fade', pos: 'center', text: 'ты за кого?', hint: 'пиши в комменты 👇' },
      { type: 'split', dur: 1.7, trans: 'swipe', slot: 0, slot2: 1, caption: 'или' },
      { type: 'cover', dur: 1.3, trans: 'mirror', slot: 0, kicker: 'выбор за тобой', text: 'РЕШАЙ' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'команда A или B?', cta: 'Коммент 🔥' },
    ],
  },
  {
    key: 'three-tips', name: '3 Tips', tag: 'TikTok · польза', accent: '#ccff00',
    preview: 'templates/previews/scenes-three-tips.mp4', slotCount: 1, music: 'track_001', filter: 'none',
    scenes: [
      { type: 'hook', dur: 1.6, trans: 'fade', pos: 'top', text: '3 вещи, которые я узнал слишком поздно', hint: 'сохрани 🔖' },
      { type: 'list', dur: 2.4, trans: 'swipeUp', title: 'сохрани', items: ['делай проще', 'не бойся начать', 'выкладывай каждый день'] },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'бонус', text: 'ЕЩЁ ОДНО' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'нужна 2 часть?', cta: 'Подпишись 🔥' },
    ],
  },
  {
    key: 'wait-for-it', name: 'Wait For It', tag: 'TikTok · интрига', accent: '#7c5cff',
    preview: 'templates/previews/scenes-wait-for-it.mp4', slotCount: 1, music: 'track_015', filter: 'vhs',
    scenes: [
      { type: 'hook', dur: 1.4, trans: 'fade', pos: 'center', text: 'подожди...', hint: '👀' },
      { type: 'countdown', dur: 1.5, trans: 'punch', count: 3, caption: 'готов?' },
      { type: 'cover', dur: 1.5, trans: 'glitchcut', slot: 0, kicker: 'бум', text: 'ВОТ ОНО' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'ещё такое?', cta: 'Подпишись' },
    ],
  },
  {
    key: 'tag-friend', name: 'Tag a Friend', tag: 'TikTok · охваты', accent: '#ffcc4d',
    preview: 'templates/previews/scenes-tag-friend.mp4', slotCount: 1, music: 'track_011', filter: 'warm',
    scenes: [
      { type: 'hook', dur: 1.6, trans: 'fade', pos: 'top', text: 'отметь того, кому это нужно', hint: '👇 отметь друга' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'зацени', text: 'ЕМУ ЗАЙДЁТ' },
      { type: 'quote', dur: 1.4, trans: 'flash', text: 'делись хорошим', caption: '— ты, наверное' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'разнеси это', cta: 'Отметь друга 🔥' },
    ],
  },
  {
    key: 'photo-dump', name: 'Photo Dump', tag: 'TikTok · эстетика', accent: '#c8a26a',
    preview: 'templates/previews/scenes-photo-dump.mp4', slotCount: 4, music: 'track_012', filter: 'vintage',
    scenes: [
      { type: 'cover', dur: 1.3, trans: 'fade', slot: 0, kicker: 'дамп', text: '01' },
      { type: 'cover', dur: 1.3, trans: 'fade', slot: 1, kicker: '', text: '02' },
      { type: 'cover', dur: 1.3, trans: 'fade', slot: 2, kicker: '', text: '03' },
      { type: 'cover', dur: 1.3, trans: 'fade', slot: 3, kicker: '', text: '04' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'какое зашло?', cta: 'Коммент 💛' },
    ],
  },
  {
    key: 'flash-sale', name: 'Flash Sale', tag: 'ценник · отсчёт', accent: '#ff2d6b',
    preview: 'templates/previews/scenes-flash-sale.mp4', uses: '', slotCount: 2, music: 'track_002',
    scenes: [
      { type: 'countdown', dur: 1.6, trans: 'fade', count: 3, caption: 'sale starts in' },
      { type: 'price', dur: 1.8, trans: 'punch', slot: 0, text: 'SNEAKERS', old: '$120', price: '$59', badge: '-50%' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 1, kicker: 'limited stock', text: 'GRAB IT' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'today only', cta: 'Shop now' },
    ],
  },
  {
    key: 'glow-up', name: 'Glow Up', tag: 'до/после · трансформация', accent: '#3ad1c0',
    preview: 'templates/previews/scenes-glow-up.mp4', uses: '', slotCount: 3, music: 'track_011',
    scenes: [
      { type: 'text', dur: 1.0, trans: 'fade', kicker: 'the results', text: 'GLOW UP', size: 15, align: 'center' },
      { type: 'beforeafter', dur: 1.9, trans: 'wipe', slot: 0, slot2: 1, text: 'before', caption: 'after' },
      { type: 'cover', dur: 1.4, trans: 'mirror', slot: 2, kicker: 'day 30', text: 'NEW YOU' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'your turn', cta: 'Start now' },
    ],
  },
  {
    key: 'promo-drop', name: 'Promo Drop', tag: 'товар · распродажа', accent: '#ff2d6b',
    preview: 'templates/previews/scenes-promo-drop.mp4', uses: '2.8M', slotCount: 2, music: 'track_001',
    scenes: [
      { type: 'cover', dur: 1.4, trans: 'fade', slot: 0, kicker: 'new arrival', text: 'SUMMER SALE' },
      { type: 'stat', dur: 1.2, trans: 'punch', kicker: 'up to', text: '-50%', caption: 'today only' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 1, kicker: 'limited', text: 'GRAB YOURS' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'don’t miss it', cta: 'Shop now' },
    ],
  },
  {
    key: 'top-reasons', name: 'Top Reasons', tag: 'список · инфо', accent: '#ccff00',
    preview: 'templates/previews/scenes-top-reasons.mp4', uses: '1.9M', slotCount: 1, music: 'track_017',
    scenes: [
      { type: 'text', dur: 1.2, trans: 'fade', kicker: 'why', text: '3 REASONS', size: 15, align: 'center', bg: 'linear-gradient(180deg,#f4f1ea,#e7e0d3)', color: '#141414' },
      { type: 'list', dur: 2.4, trans: 'swipeUp', title: 'why us', items: ['fast & easy', 'best price', 'loved by 10k+'] },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'proof', text: 'SEE FOR YOURSELF' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'try it', cta: 'Get started' },
    ],
  },
  {
    key: 'split-story', name: 'Split Story', tag: 'сплит · динамика', accent: '#00e5ff',
    preview: 'templates/previews/scenes-split-story.mp4', uses: '3.3M', slotCount: 3, music: 'track_007',
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
    preview: 'templates/previews/scenes-bold-quote.mp4', uses: '1.4M', slotCount: 1, music: 'track_005',
    scenes: [
      { type: 'quote', dur: 1.6, trans: 'fade', text: 'dream big', caption: 'day one' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'the journey', text: 'KEEP GOING' },
      { type: 'quote', dur: 1.6, trans: 'glitchcut', text: 'never stop', caption: 'no excuses', bg: '#101014' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'let’s move', cta: 'Follow' },
    ],
  },
  {
    key: 'story-reel', name: 'Story Reel', tag: 'мультисцена · переходы', accent: '#ff5c8a',
    preview: 'templates/previews/scenes-story-reel.mp4', uses: '2.4M', slotCount: 2, music: 'track_009',
    scenes: [
      { type: 'text', dur: 1.3, trans: 'fade', kicker: 'presenting', text: 'SUMMER', size: 16, align: 'left' },
      { type: 'photo', dur: 1.5, trans: 'wipe', slot: 0, caption: 'look 01', from: 'left' },
      { type: 'photo', dur: 1.5, trans: 'mirror', slot: 1, caption: 'look 02', from: 'right', capBottom: true, kenScale: true },
      { type: 'cta', dur: 1.7, trans: 'zoom', title: 'new drop', cta: 'Tap to shop' },
    ],
  },
  {
    key: 'kinetic-trio', name: 'Kinetic Trio', tag: 'драйв · текст+фото', accent: '#ccff00',
    preview: 'templates/previews/scenes-kinetic-trio.mp4', uses: '3.1M', slotCount: 2, music: 'track_008',
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
    preview: 'templates/previews/scenes-clip-reel.mp4', uses: '4.0M', slotCount: 3, music: 'track_015',
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
    preview: 'templates/previews/scenes-mirror-fashion.mp4', uses: '1.6M', slotCount: 3, music: 'track_006',
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
