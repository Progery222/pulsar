import type { UniqualizerSettings } from '../types/uniqualizer';

// Чистые генераторы для уникализатора (без node-зависимостей). Реальные операции
// с файлом (метаданные через FFmpeg, дозапись байт) выполняются в main-процессе.

const ENCODERS = ['Lavf58.76.100', 'Lavf59.16.100', 'Lavf60.3.100', 'Lavf57.83.100'];
// Бренды без пробелов: fluent-ffmpeg разбивает аргументы по пробелам.
const BRANDS = ['isom', 'mp42', 'mp41', 'avc1', 'iso2', 'isov'];
const SPEEDS = [
  0.995, 0.996, 0.997, 0.998, 0.999, 1.001, 1.002, 1.003, 1.004, 1.005, 1.01, 1.015, 1.02,
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// UUID v4 через Math.random — работает и в renderer, и в main (где globalThis.crypto нет).
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomString(min: number, max: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const len = min + Math.floor(Math.random() * (max - min + 1));
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Метаданные (§1): случайные title/comment/creation_time/encoder/major_brand + artist/album.
export function randomMetadata(): Record<string, string> {
  const day = 86400000;
  const now = Date.now();
  const min = now - 182 * day; // ~6 месяцев назад
  const max = now - day; // вчера
  const creation_time = new Date(min + Math.random() * (max - min)).toISOString();

  return {
    title: randomString(8, 16),
    comment: uuidv4(),
    creation_time,
    encoder: ENCODERS[Math.floor(Math.random() * ENCODERS.length)],
    major_brand: BRANDS[Math.floor(Math.random() * BRANDS.length)],
    artist: randomString(5, 10),
    album: randomString(5, 12),
  };
}

// Вариация параметров кодирования (бинарный/структурный fingerprint, без потери качества).
export function uniqualizerEncoding(): {
  crf: number;
  gop: number;
  audioBitrate: string;
  faststart: boolean;
} {
  return {
    crf: 21 + Math.floor(Math.random() * 5), // 21–25 (визуально неотличимо)
    gop: 48 + Math.floor(Math.random() * 73), // интервал ключевых кадров 48–120
    audioBitrate: ['128k', '160k', '192k'][Math.floor(Math.random() * 3)],
    faststart: Math.random() < 0.5,
  };
}

// Видео/аудио фильтры уникализатора (§3–8). w,h — итоговое разрешение (для crop+scale).
export function buildUniqualizerFilters(
  s: UniqualizerSettings,
  w: number,
  h: number
): { vf: string[]; af: string[] } {
  const vf: string[] = [];
  const af: string[] = [];
  if (!s.enabled) return { vf, af };

  // Зеркальный флип (§4) — двойной hflip: визуально идентично, иной fingerprint.
  if (s.mirrorFlip) {
    vf.push('hflip', 'hflip');
  }

  // Цветовой сдвиг (§3).
  if (s.colorShift) {
    const brightness = rand(-0.03, 0.03).toFixed(3);
    const contrast = rand(0.97, 1.03).toFixed(3);
    const saturation = rand(0.96, 1.04).toFixed(3);
    const gamma = rand(0.97, 1.03).toFixed(3);
    vf.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}`);
  }

  // Шум (§5): alls 1–4.
  if (s.noise) {
    const n = 1 + Math.floor(Math.random() * 4);
    vf.push(`noise=alls=${n}:allf=t+u`);
  }

  // Обрезка краёв (§7): 1–3px с каждой стороны + scale обратно.
  if (s.cropEdges) {
    const top = 1 + Math.floor(Math.random() * 3);
    const bottom = 1 + Math.floor(Math.random() * 3);
    const left = 1 + Math.floor(Math.random() * 3);
    const right = 1 + Math.floor(Math.random() * 3);
    vf.push(`crop=iw-${left + right}:ih-${top + bottom}:${left}:${top},scale=${w}:${h}`);
  }

  // Скорость (§6): setpts + atempo=1/SPEED для синхронности аудио.
  if (s.speed) {
    const sp = SPEEDS[Math.floor(Math.random() * SPEEDS.length)];
    vf.push(`setpts=${sp}*PTS`);
    af.push(`atempo=${(1 / sp).toFixed(6)}`);
  }

  // Аудио сдвиг (§8): adelay 10–50ms.
  if (s.audioShift) {
    const delayMs = 10 + Math.floor(Math.random() * 41);
    af.push(`adelay=${delayMs}|${delayMs}`);
  }

  return { vf, af };
}

// Набор «видимых» цветовых грейдов для режима видимой вариации (каждый явно отличается).
const LOOKS = [
  'eq=brightness=0.05:saturation=1.45:contrast=1.08:gamma=0.95', // тёплый/насыщенный
  'colorbalance=rs=-0.12:bs=0.18,eq=saturation=1.15', // холодный
  'curves=preset=vintage', // винтаж
  'hue=s=0,eq=contrast=1.2', // чёрно-белый
  'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131', // сепия
  'eq=contrast=1.45:brightness=-0.04:saturation=1.25', // высокий контраст
  'curves=preset=lighter,eq=saturation=1.3', // светлый/воздушный
  'eq=saturation=1.85:contrast=1.1', // ультра-насыщенный
];

// Режим «видимая вариация»: для копии index возвращает СИЛЬНЫЕ, заметные глазу
// видеофильтры (грейд + зум + отражение + поворот оттенка). Каждая копия очевидно разная.
export function buildVisibleVariation(index: number, w: number, h: number): string[] {
  const vf: string[] = [];

  // Зеркало на нечётных копиях — самое заметное отличие.
  if (index % 2 === 1) vf.push('hflip');

  // Заметный зум, разный по копиям: 1.08–1.28.
  const zoom = (1.08 + (index % 5) * 0.05).toFixed(3);
  vf.push(`crop=iw/${zoom}:ih/${zoom},scale=${w}:${h}`);

  // Цветовой грейд из набора.
  const look = LOOKS[index % LOOKS.length];
  vf.push(look);

  // Поворот оттенка (кроме ч/б-грейда).
  if (!look.startsWith('hue=s=0')) {
    const hue = (index * 47) % 360;
    if (hue) vf.push(`hue=h=${hue}`);
  }

  return vf;
}
