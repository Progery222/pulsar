// Независимая от редактора логика генерации FFmpeg-фильтров для VUB (§5 ТЗ VUB).
import type { RangeParam, VubEffects, VubParams, VubText } from './types';

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Значение параметра для вариации idx из total. Вариации распределяются по всему
// диапазону (первая — у одного края, последняя — у другого) + лёгкий джиттер,
// чтобы N роликов гарантированно отличались, а не клались случайно рядом.
function value(p: RangeParam, idx: number, total: number): number | null {
  if (!p.enabled) return null;
  if (total <= 1) return rand(p.min, p.max);
  const span = p.max - p.min;
  const step = span / total;
  // Перемешиваем порядок полос по индексу, чтобы вариации шли не строго по возрастанию.
  const slot = (idx * 2 + 1) % total;
  const base = p.min + (slot + 0.5) * step;
  const jitter = (Math.random() - 0.5) * step;
  return clamp(base + jitter, p.min, p.max);
}

// Раскрытие Spintax: {a|b|c} -> случайный вариант (рекурсивно).
export function resolveSpintax(input: string): string {
  let out = input;
  const re = /\{([^{}]*)\}/;
  let guard = 0;
  while (re.test(out) && guard < 100) {
    out = out.replace(re, (_m, body: string) => pick(body.split('|')) ?? '');
    guard++;
  }
  return out;
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

export interface FfmpegPlan {
  videoFilters: string[]; // последовательные -vf фильтры
  audioFilters: string[]; // -af фильтры
  metadata: Record<string, string>; // случайные метаданные (заменяют очищенные)
}

const ADJ = ['Sunny', 'Calm', 'Bright', 'Urban', 'Wild', 'Soft', 'Neon', 'Golden', 'Silent', 'Fresh'];
const NOUN = ['Wave', 'Vibe', 'Story', 'Moment', 'Trip', 'Scene', 'Dream', 'Echo', 'Pulse', 'Frame'];

function randomMetadata(): Record<string, string> {
  const title = `${pick(ADJ)} ${pick(NOUN)}`;
  const uid = Math.random().toString(36).slice(2, 12);
  return {
    title,
    artist: `${pick(NOUN)} ${pick(ADJ)}`,
    comment: uid,
    encoder: `Pulsar ${1 + Math.floor(rand(0, 9))}.${Math.floor(rand(0, 9))}`,
  };
}

// Строит план фильтров для одного видео со случайными значениями в заданных диапазонах.
export function buildVubPlan(
  params: VubParams,
  effects: VubEffects,
  text: VubText,
  cleanMetadata: boolean,
  variationIndex = 0,
  variationTotal = 1
): FfmpegPlan {
  const vf: string[] = [];
  const af: string[] = [];
  const idx = variationIndex;
  const total = variationTotal;

  // --- Параметры видео (eq / unsharp / volume / speed) ---
  const brightness = value(params.brightness, idx, total); // % -> -0.5..0.5
  const contrast = value(params.contrast, idx, total); // % -> 1 + v/100
  const eqParts: string[] = [];
  if (brightness !== null) eqParts.push(`brightness=${(brightness / 100).toFixed(4)}`);
  if (contrast !== null) eqParts.push(`contrast=${(1 + contrast / 100).toFixed(4)}`);
  if (eqParts.length) vf.push(`eq=${eqParts.join(':')}`);

  const sharpness = value(params.sharpness, idx, total); // % -> luma amount
  if (sharpness !== null) vf.push(`unsharp=5:5:${(sharpness / 50).toFixed(3)}:5:5:0`);

  const volume = value(params.volume, idx, total); // % -> 1 + v/100
  if (volume !== null) af.push(`volume=${Math.max(0, 1 + volume / 100).toFixed(3)}`);

  const duration = value(params.duration, idx, total); // % длительности
  if (duration !== null) {
    const factor = 1 + duration / 100; // >1 = длиннее (медленнее)
    vf.push(`setpts=${factor.toFixed(4)}*PTS`);
    const atempo = Math.min(2, Math.max(0.5, 1 / factor));
    af.push(`atempo=${atempo.toFixed(4)}`);
  }

  // Лёгкий поворот: зум -> поворот -> центр-кроп, чтобы не было чёрных углов.
  // z = (cos|θ| + AR·sin|θ|)·запас; AR=1.78 (худший для 9:16/16:9).
  const rotDeg = value(params.rotation, idx, total);
  if (rotDeg !== null && Math.abs(rotDeg) > 0.05) {
    const rad = (rotDeg * Math.PI) / 180;
    const a = Math.abs(rad);
    const z = Math.min(1.6, (Math.cos(a) + 1.78 * Math.sin(a)) * 1.05);
    vf.push(`scale=iw*${z.toFixed(4)}:ih*${z.toFixed(4)}`);
    vf.push(`rotate=${rad.toFixed(5)}`);
    vf.push(`crop=iw/${z.toFixed(4)}:ih/${z.toFixed(4)}`);
  }

  // --- Эффекты ---
  if (effects.mirror.enabled) {
    // В режиме "Случайно" чередуем по чётности вариации: половина роликов зеркалится.
    const doMirror =
      effects.mirror.mode === 'always' ||
      (effects.mirror.mode === 'random' && (total > 1 ? idx % 2 === 0 : Math.random() < 0.5));
    if (doMirror) vf.push('hflip');
  }

  if (effects.grid.enabled) {
    const opacityPct = value({ enabled: true, min: effects.grid.opacityMin, max: effects.grid.opacityMax }, idx, total);
    const opacity = (opacityPct ?? effects.grid.opacityMin) / 100;
    const size = effects.gridSize.enabled ? effects.gridSize.size : 32;
    // Цвет сетки чередуем по индексу вариации (а не случайно).
    const colors = effects.gridColor.enabled ? effects.gridColor.colors : [];
    const colorHex = colors.length ? colors[idx % colors.length] : 'white';
    const color = colorHex.startsWith('#') ? `0x${colorHex.slice(1)}` : colorHex;
    vf.push(`drawgrid=w=${size}:h=${size}:t=1:color=${color}@${opacity.toFixed(3)}`);
  }

  if (effects.darken.enabled) {
    vf.push(`fade=t=in:st=0:d=${effects.darken.duration}`);
    if (effects.darken.audioFadeIn) af.push(`afade=t=in:st=0:d=${effects.darken.duration}`);
  }

  // --- Текст (Spintax) ---
  const resolved = text.spintax.trim() ? resolveSpintax(text.spintax) : '';
  if (resolved) {
    const y = text.position === 'top' ? 'h*0.08' : text.position === 'center' ? '(h-text_h)/2' : 'h*0.86';
    const color = text.color.startsWith('#') ? `0x${text.color.slice(1)}` : text.color;
    vf.push(
      `drawtext=text='${escapeDrawtext(resolved)}':fontsize=${text.size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}:box=1:boxcolor=black@0.35:boxborderw=8`
    );
  }

  return {
    videoFilters: vf,
    audioFilters: af,
    metadata: cleanMetadata ? randomMetadata() : {},
  };
}
