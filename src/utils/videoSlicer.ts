import type { BeatData, GeneratedClip, MediaFile } from '../types';

type Mood = 'mellow' | 'natural' | 'energetic';

// §9.2: точки склейки в зависимости от Mood.
function moodCutPoints(beatData: BeatData, mood: Mood): number[] {
  const { beat_times, onset_times } = beatData;
  if (mood === 'mellow') return beat_times.filter((_, i) => i % 4 === 0); // каждый 4-й
  if (mood === 'natural') return beat_times.filter((_, i) => i % 2 === 0); // каждый 2-й
  // energetic: все beat_times + каждый 3-й onset_times, объединить и отсортировать
  const onsets = onset_times.filter((_, i) => i % 3 === 0);
  const merged = [...beat_times, ...onsets].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of merged) {
    if (out.length === 0 || t - out[out.length - 1] > 1e-3) out.push(t);
  }
  return out;
}

// §9.3: распределение видеофрагментов по точкам склейки.
export function generateClips(
  beatData: BeatData,
  mediaFiles: MediaFile[],
  mood: Mood,
  duration: number,
  segmentStart: number,
  mediaOrder: string[]
): GeneratedClip[] {
  if (mediaFiles.length === 0) return [];

  const idToFile = new Map(mediaFiles.map((f) => [f.id, f]));
  const order = (mediaOrder.length ? mediaOrder : mediaFiles.map((f) => f.id))
    .map((id) => idToFile.get(id))
    .filter((f): f is MediaFile => Boolean(f));
  if (order.length === 0) return [];

  // 1. Точки склейки (абсолютные), 2. обрезка до segmentStart + duration,
  //    3. сдвиг на segmentStart -> таймлайн вывода 0..duration.
  let points = moodCutPoints(beatData, mood);
  const end = segmentStart + duration;
  points = points.filter((t) => t >= segmentStart && t <= end).map((t) => t - segmentStart);

  // Гарантируем границы 0 и duration.
  if (points.length === 0 || points[0] > 0.001) points.unshift(0);
  if (points[points.length - 1] < duration - 0.001) points.push(duration);
  points = Array.from(new Set(points.map((p) => Number(p.toFixed(3))))).sort((a, b) => a - b);

  const clips: GeneratedClip[] = [];
  const playhead = new Map<string, number>(); // позиция внутри исходного файла
  let lastId: string | null = null;
  let repeat = 0;
  let rr = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const segLen = Number((points[i + 1] - points[i]).toFixed(3));
    if (segLen <= 0.001) continue;

    // Выбор файла без повторения одного и того же более 2 раз подряд.
    let pick: MediaFile | null = null;
    for (let attempt = 0; attempt < order.length; attempt++) {
      const cand = order[(rr + attempt) % order.length];
      if (cand.id === lastId && repeat >= 2) continue;
      pick = cand;
      rr = (rr + attempt + 1) % order.length;
      break;
    }
    if (!pick) {
      pick = order[rr % order.length];
      rr = (rr + 1) % order.length;
    }
    if (pick.id === lastId) repeat++;
    else {
      repeat = 1;
      lastId = pick.id;
    }

    // startTime внутри исходного видео (последовательный playhead с переносом).
    const srcDur = pick.duration > 0 ? pick.duration : 0;
    let start = playhead.get(pick.id) ?? 0;
    if (srcDur > 0 && start + segLen > srcDur) start = 0;
    playhead.set(pick.id, start + segLen);

    clips.push({
      sourceFile: pick.path,
      startTime: Number(start.toFixed(3)),
      duration: segLen,
      effectSlots: [],
    });
  }

  return clips;
}
