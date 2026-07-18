// Обработка изображений на canvas (локально): кроп/размер/поворот/отражение/фильтры/
// водяной знак + кодирование с качеством и «цель по размеру» (бинарный поиск).

export type ImgFormat = 'image/jpeg' | 'image/png' | 'image/webp';
export type CropPreset = 'free' | '1:1' | '4:3' | '16:9' | '3:2' | '9:16';
export type Rotate = 0 | 90 | 180 | 270;
export type WmPos = 'center' | 'tl' | 'tr' | 'bl' | 'br';

export interface ImgSettings {
  format: ImgFormat;
  quality: number; // 0..1
  targetKB: number | null; // цель по размеру (jpeg/webp)
  resizeEnabled: boolean;
  resizeW: number;
  resizeH: number;
  rotate: Rotate;
  flipH: boolean;
  flipV: boolean;
  crop: CropPreset;
  grayscale: boolean;
  sepia: boolean;
  invert: boolean;
  brightness: number; // %
  contrast: number; // %
  saturate: number; // %
  blur: number; // px
  sharpen: number; // 0..2 (резкость/шарпен после ресайза)
  wmText: string;
  wmPos: WmPos;
  wmSize: number; // % от ширины
}

export const DEFAULT_SETTINGS: ImgSettings = {
  format: 'image/webp',
  quality: 0.82,
  targetKB: null,
  resizeEnabled: false,
  resizeW: 0,
  resizeH: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: 'free',
  grayscale: false,
  sepia: false,
  invert: false,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  blur: 0,
  sharpen: 0,
  wmText: '',
  wmPos: 'br',
  wmSize: 5,
};

function cropRatio(c: CropPreset): number | null {
  switch (c) {
    case '1:1': return 1;
    case '4:3': return 4 / 3;
    case '16:9': return 16 / 9;
    case '3:2': return 3 / 2;
    case '9:16': return 9 / 16;
    default: return null;
  }
}

function buildFilter(s: ImgSettings): string {
  const parts: string[] = [];
  if (s.grayscale) parts.push('grayscale(1)');
  if (s.sepia) parts.push('sepia(1)');
  if (s.invert) parts.push('invert(1)');
  if (s.brightness !== 100) parts.push(`brightness(${s.brightness / 100})`);
  if (s.contrast !== 100) parts.push(`contrast(${s.contrast / 100})`);
  if (s.saturate !== 100) parts.push(`saturate(${s.saturate / 100})`);
  if (s.blur > 0) parts.push(`blur(${s.blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, s: ImgSettings) {
  const fs = Math.max(10, (s.wmSize / 100) * w);
  ctx.save();
  ctx.filter = 'none';
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const m = fs * 0.5;
  const tw = ctx.measureText(s.wmText).width;
  let x = w - tw - m;
  let y = h - fs;
  ctx.textAlign = 'left';
  if (s.wmPos === 'center') { x = (w - tw) / 2; y = h / 2; }
  else if (s.wmPos === 'tl') { x = m; y = fs; }
  else if (s.wmPos === 'tr') { x = w - tw - m; y = fs; }
  else if (s.wmPos === 'bl') { x = m; y = h - fs; }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText(s.wmText, x + 2, y + 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(s.wmText, x, y);
  ctx.restore();
}

// Резкость (unsharp): свёртка 3×3, усиливает края после апскейла. amount 0..2.
function applySharpen(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0 || w < 3 || h < 3) return;
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const sd = src.data;
  const od = out.data;
  const a = amount;
  const center = 1 + 4 * a;
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        od[i] = sd[i]; od[i + 1] = sd[i + 1]; od[i + 2] = sd[i + 2]; od[i + 3] = sd[i + 3];
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const p = i + c;
        const v = center * sd[p] - a * (sd[p - 4] + sd[p + 4] + sd[p - row] + sd[p + row]);
        od[p] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      od[i + 3] = sd[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function renderCanvas(source: CanvasImageSource, sw: number, sh: number, s: ImgSettings): HTMLCanvasElement {
  // 1. Кроп по пресету (центр).
  let cx = 0;
  let cy = 0;
  let cw = sw;
  let ch = sh;
  const r = cropRatio(s.crop);
  if (r) {
    const srcR = sw / sh;
    if (srcR > r) { cw = sh * r; cx = (sw - cw) / 2; }
    else { ch = sw / r; cy = (sh - ch) / 2; }
  }
  // 2. Базовые размеры (после кропа) + ресайз.
  let bw = Math.round(cw);
  let bh = Math.round(ch);
  if (s.resizeEnabled && s.resizeW > 0 && s.resizeH > 0) {
    bw = Math.round(s.resizeW);
    bh = Math.round(s.resizeH);
  }
  // 3. Поворот меняет местами стороны.
  const swap = s.rotate === 90 || s.rotate === 270;
  const outW = Math.max(1, swap ? bh : bw);
  const outH = Math.max(1, swap ? bw : bh);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.filter = buildFilter(s);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((s.rotate * Math.PI) / 180);
  ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
  ctx.drawImage(source, cx, cy, cw, ch, -bw / 2, -bh / 2, bw, bh);
  ctx.restore();

  if (s.sharpen > 0) applySharpen(ctx, outW, outH, s.sharpen);
  if (s.wmText.trim()) drawWatermark(ctx, outW, outH, s);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, format: ImgFormat, quality: number): Promise<Blob> {
  return new Promise((res, rej) => {
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), format, quality);
  });
}

// Кодирование с учётом «цели по размеру» (бинарный поиск качества для jpeg/webp).
export async function encode(canvas: HTMLCanvasElement, s: ImgSettings): Promise<Blob> {
  const lossy = s.format === 'image/jpeg' || s.format === 'image/webp';
  if (!s.targetKB || !lossy) return toBlob(canvas, s.format, s.quality);

  const target = s.targetKB * 1024;
  let lo = 0.2;
  let hi = 0.95;
  let best = await toBlob(canvas, s.format, hi);
  if (best.size <= target) return best;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const blob = await toBlob(canvas, s.format, mid);
    if (blob.size <= target) {
      best = blob;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

export function extForFormat(f: ImgFormat): string {
  return f === 'image/jpeg' ? 'jpg' : f === 'image/png' ? 'png' : 'webp';
}
