// Цвет интерфейса — пользователь выбирает акцент в настройках, он применяется
// ко всему приложению. Работает через CSS-переменные: и inline-стили
// (var(--accent-green)), и tailwind-класс accent-green ссылаются на них,
// поэтому подмена переменной перекрашивает интерфейс целиком.

export interface AccentPreset {
  key: string;
  label: string;
  color: string; // сам акцент
  fg: string; // текст поверх акцента — на светлых нужен тёмный, на тёмных белый
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { key: 'lime', label: 'Салатовый', color: '#ccff00', fg: '#04120c' },
  { key: 'green', label: 'Зелёный', color: '#4ade80', fg: '#04120c' },
  { key: 'mint', label: 'Мятный', color: '#3ad1c0', fg: '#04120c' },
  { key: 'cyan', label: 'Голубой', color: '#00e5ff', fg: '#04120c' },
  { key: 'blue', label: 'Синий', color: '#4d8dff', fg: '#ffffff' },
  { key: 'violet', label: 'Фиолетовый', color: '#7c5cff', fg: '#ffffff' },
  { key: 'pink', label: 'Розовый', color: '#ff5c8a', fg: '#ffffff' },
  { key: 'red', label: 'Красный', color: '#ff4444', fg: '#ffffff' },
  { key: 'orange', label: 'Оранжевый', color: '#ff6b35', fg: '#ffffff' },
  { key: 'amber', label: 'Янтарный', color: '#ffcc4d', fg: '#2b1d00' },
  { key: 'white', label: 'Белый', color: '#ffffff', fg: '#0d0d0d' },
];

const STORAGE_KEY = 'pulsar.accent';
export const DEFAULT_ACCENT = 'lime';

export function getAccentKey(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved.startsWith('#') || ACCENT_PRESETS.some((p) => p.key === saved))) return saved;
  } catch { /* приватный режим/недоступное хранилище — молча берём стандартный */ }
  return DEFAULT_ACCENT;
}

// Тёмный текст на светлом акценте и наоборот: считаем по воспринимаемой яркости,
// иначе на своём цвете надписи на кнопках сливаются с фоном.
export function contrastFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0d0d0d' : '#ffffff';
}

export function resolveAccent(key: string): { color: string; fg: string } {
  const preset = ACCENT_PRESETS.find((p) => p.key === key);
  if (preset) return { color: preset.color, fg: preset.fg };
  // Свой цвет из палитры — контраст подписи считаем сами.
  const color = key.startsWith('#') ? key : ACCENT_PRESETS[0].color;
  return { color, fg: contrastFor(color) };
}

export function applyAccent(key: string, persist = true): void {
  const { color, fg } = resolveAccent(key);
  const root = document.documentElement;
  root.style.setProperty('--accent-green', color);
  root.style.setProperty('--accent-fg', fg);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* не сохранилось — не критично */ }
  }
}

// Вызывается один раз при старте, до первой отрисовки.
export function initAccent(): void {
  applyAccent(getAccentKey(), false);
}
