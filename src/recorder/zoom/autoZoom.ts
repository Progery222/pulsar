// Авто-зум из телеметрии курсора. Детект «зависаний» (dwell) и построение зум-регионов —
// портировано из OpenScreen (MIT): timeline/zoomSuggestionUtils.ts. Трансформация кадра —
// из videoPlayback/zoomTransform.ts (computeZoomTransform). Чистые функции, без внешних депов.

import type { CursorSample, RecordedDisplay } from '../types';

export interface TelemetryPoint {
  timeMs: number;
  cx: number; // 0..1 по ширине кадра
  cy: number; // 0..1 по высоте кадра
}

export interface ZoomFocus {
  cx: number;
  cy: number;
}

export interface ZoomRegion {
  id: string;
  startMs: number;
  endMs: number;
  focus: ZoomFocus;
  scale: number;
}

export interface AppliedTransform {
  scale: number;
  x: number;
  y: number;
}

// Абсолютные экранные сэмплы → нормализованная телеметрия кадра.
export function samplesToTelemetry(samples: CursorSample[], display: RecordedDisplay | null): TelemetryPoint[] {
  if (!display) return [];
  const { x, y, width, height } = display.bounds;
  if (width <= 0 || height <= 0) return [];
  return samples.map((s) => ({
    timeMs: s.t,
    cx: Math.max(0, Math.min(1, (s.x - x) / width)),
    cy: Math.max(0, Math.min(1, (s.y - y) / height)),
  }));
}

const MIN_DWELL_DURATION_MS = 450;
const MAX_DWELL_DURATION_MS = 2600;
const DWELL_MOVE_THRESHOLD = 0.02;
const SUGGESTION_SPACING_MS = 1800;

interface DwellCandidate {
  centerTimeMs: number;
  focus: ZoomFocus;
  strength: number;
}

function detectDwellCandidates(samples: TelemetryPoint[]): DwellCandidate[] {
  if (samples.length < 2) return [];
  const out: DwellCandidate[] = [];
  let runStart = 0;
  const pushRun = (startIdx: number, endExcl: number) => {
    if (endExcl - startIdx < 2) return;
    const start = samples[startIdx];
    const end = samples[endExcl - 1];
    const dur = end.timeMs - start.timeMs;
    if (dur < MIN_DWELL_DURATION_MS || dur > MAX_DWELL_DURATION_MS) return;
    const run = samples.slice(startIdx, endExcl);
    const avgCx = run.reduce((s, p) => s + p.cx, 0) / run.length;
    const avgCy = run.reduce((s, p) => s + p.cy, 0) / run.length;
    out.push({ centerTimeMs: Math.round((start.timeMs + end.timeMs) / 2), focus: { cx: avgCx, cy: avgCy }, strength: dur });
  };
  for (let i = 1; i < samples.length; i++) {
    const d = Math.hypot(samples[i].cx - samples[i - 1].cx, samples[i].cy - samples[i - 1].cy);
    if (d > DWELL_MOVE_THRESHOLD) {
      pushRun(runStart, i);
      runStart = i;
    }
  }
  pushRun(runStart, samples.length);
  return out;
}

// Построить непересекающиеся зум-регионы из телеметрии.
export function buildAutoZoomRegions(opts: {
  telemetry: TelemetryPoint[];
  totalMs: number;
  defaultDurationMs: number;
  scale: number;
}): ZoomRegion[] {
  const { telemetry, totalMs, defaultDurationMs, scale } = opts;
  if (totalMs <= 0 || telemetry.length < 2) return [];
  const dur = Math.min(defaultDurationMs, totalMs);
  if (dur <= 0) return [];

  const candidates = detectDwellCandidates(telemetry).sort((a, b) => b.strength - a.strength);
  const reserved: { start: number; end: number }[] = [];
  const centers: number[] = [];
  const regions: ZoomRegion[] = [];
  let n = 0;

  for (const c of candidates) {
    if (centers.some((ct) => Math.abs(ct - c.centerTimeMs) < SUGGESTION_SPACING_MS)) continue;
    const centeredStart = Math.round(c.centerTimeMs - dur / 2);
    const start = Math.max(0, Math.min(centeredStart, totalMs - dur));
    const end = start + dur;
    if (reserved.some((s) => end > s.start && start < s.end)) continue;
    reserved.push({ start, end });
    centers.push(c.centerTimeMs);
    regions.push({ id: `z${n++}`, startMs: start, endMs: end, focus: c.focus, scale });
  }
  return regions.sort((a, b) => a.startMs - b.startMs);
}

// Позиция курсора (нормализованная 0..1) в момент времени — линейная интерполяция телеметрии.
export function cursorAt(telemetry: TelemetryPoint[], timeMs: number): ZoomFocus | null {
  if (telemetry.length === 0) return null;
  if (timeMs <= telemetry[0].timeMs) return { cx: telemetry[0].cx, cy: telemetry[0].cy };
  const last = telemetry[telemetry.length - 1];
  if (timeMs >= last.timeMs) return { cx: last.cx, cy: last.cy };
  // Бинарный поиск ближайшего сегмента.
  let lo = 0;
  let hi = telemetry.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (telemetry[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }
  const a = telemetry[lo];
  const b = telemetry[hi];
  const span = b.timeMs - a.timeMs || 1;
  const f = (timeMs - a.timeMs) / span;
  return { cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Прогресс зума в точке времени с плавным входом/выходом на краях региона.
const RAMP_MS = 500;
export function zoomTargetAt(regions: ZoomRegion[], timeMs: number): { scale: number; focus: ZoomFocus; progress: number } {
  for (const r of regions) {
    if (timeMs < r.startMs || timeMs > r.endMs) continue;
    const inP = Math.min(1, (timeMs - r.startMs) / RAMP_MS);
    const outP = Math.min(1, (r.endMs - timeMs) / RAMP_MS);
    const progress = easeInOut(Math.max(0, Math.min(inP, outP)));
    return { scale: r.scale, focus: r.focus, progress };
  }
  return { scale: 1, focus: { cx: 0.5, cy: 0.5 }, progress: 0 };
}

// computeZoomTransform (OpenScreen): фокус (0..1 стейджа) → трансформация камеры.
export function computeZoomTransform(stageW: number, stageH: number, zoomScale: number, zoomProgress: number, focusX: number, focusY: number): AppliedTransform {
  if (stageW <= 0 || stageH <= 0) return { scale: 1, x: 0, y: 0 };
  const progress = Math.min(1, Math.max(0, zoomProgress));
  const focusPxX = focusX * stageW;
  const focusPxY = focusY * stageH;
  const scale = 1 + (zoomScale - 1) * progress;
  const finalX = stageW / 2 - focusPxX * zoomScale;
  const finalY = stageH / 2 - focusPxY * zoomScale;
  return { scale, x: finalX * progress, y: finalY * progress };
}
