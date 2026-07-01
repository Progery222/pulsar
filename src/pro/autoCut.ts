import type { BeatData } from '../types';
import type { Mood, ProClip } from './proTypes';

// Auto-Cut (§5 ТЗ): раскладка видео из пула по битам аудио на видео-дорожку,
// с учётом закреплённых (Locked) клипов — их окна пропускаются, правки не трутся.

// §9.2: точки склейки в зависимости от Mood (абсолютные тайминги аудио).
function moodCutPoints(beatData: BeatData, mood: Mood): number[] {
  const { beat_times, onset_times } = beatData;
  if (mood === 'mellow') return beat_times.filter((_, i) => i % 4 === 0);
  if (mood === 'natural') return beat_times.filter((_, i) => i % 2 === 0);
  const onsets = onset_times.filter((_, i) => i % 3 === 0);
  const merged = [...beat_times, ...onsets].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of merged) if (out.length === 0 || t - out[out.length - 1] > 1e-3) out.push(t);
  return out;
}

export interface AutoCutInput {
  beatData: BeatData;
  mood: Mood;
  pool: { path: string; duration: number }[]; // источники видео
  trackId: string;
  audioStart: number; // позиция аудио-клипа на таймлайне (сек)
  audioInPoint: number; // in-point аудио внутри файла
  audioDuration: number; // длина аудио-клипа на таймлайне
  locked: { start: number; end: number }[]; // закреплённые окна на дорожке
}

export function buildAutoCut(input: AutoCutInput): Omit<ProClip, 'id'>[] {
  const { beatData, mood, pool, trackId, audioStart, audioInPoint, audioDuration, locked } = input;
  if (!pool.length) return [];

  const lo = audioInPoint;
  const hi = audioInPoint + audioDuration;
  // Точки склейки внутри окна аудио → позиции на таймлайне.
  let points = moodCutPoints(beatData, mood)
    .filter((t) => t >= lo && t <= hi)
    .map((t) => audioStart + (t - lo));
  const start0 = audioStart;
  const end0 = audioStart + audioDuration;
  if (!points.length || points[0] > start0 + 0.001) points.unshift(start0);
  if (points[points.length - 1] < end0 - 0.001) points.push(end0);
  points = Array.from(new Set(points.map((p) => Number(p.toFixed(3))))).sort((a, b) => a - b);

  const overlapsLocked = (s: number, e: number) => locked.some((L) => s < L.end - 0.001 && e > L.start + 0.001);

  const out: Omit<ProClip, 'id'>[] = [];
  const head = new Map<string, number>(); // playhead внутри исходника
  let rr = 0;
  let lastPath: string | null = null;
  let repeat = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segLen = Number((points[i + 1] - points[i]).toFixed(3));
    if (segLen <= 0.01) continue;
    if (overlapsLocked(segStart, segStart + segLen)) continue; // окно занято закреплённым клипом

    // Выбор источника: круговой, без 3+ повторов подряд.
    let pick = pool[rr % pool.length];
    for (let a = 0; a < pool.length; a++) {
      const cand = pool[(rr + a) % pool.length];
      if (cand.path === lastPath && repeat >= 2) continue;
      pick = cand;
      rr = (rr + a + 1) % pool.length;
      break;
    }
    if (pick.path === lastPath) repeat++;
    else {
      repeat = 1;
      lastPath = pick.path;
    }

    const srcDur = pick.duration > 0 ? pick.duration : 0;
    let inPoint = head.get(pick.path) ?? 0;
    if (srcDur > 0) {
      if (inPoint + segLen > srcDur) inPoint = 0;
      head.set(pick.path, inPoint + segLen);
    } else {
      // Длина источника неизвестна — не уходим за конец (иначе чёрные кадры).
      inPoint = 0;
    }

    out.push({
      trackId,
      sourceFile: pick.path,
      timelineStart: segStart,
      duration: segLen,
      inPoint: Number(inPoint.toFixed(3)),
      sourceDuration: srcDur || undefined,
    });
  }
  return out;
}
