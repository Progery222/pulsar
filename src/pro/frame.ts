import { ADJUST_CODE, findPrevAdjacent, type ProClip, type ProDocument } from './proTypes';

// Сборка кадра под плейхедом — общая для Viewer (превью) и экспорта.

export interface DrawItem {
  clip: ProClip;
  sourceTime: number; // тайм внутри исходника
  alpha: number; // для crossfade
  out?: boolean; // уходящий слой перехода — нужен отдельный video-элемент
}

// Видео-слои под плейхедом, снизу вверх (hidden/solo + crossfade, §5 ТЗ).
export function buildFrame(doc: ProDocument, ph: number): DrawItem[] {
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video' && !t.isAdjustment);
  const anySolo = videoTracks.some((t) => t.solo);
  const visible = videoTracks.filter((t) => !t.hidden && (!anySolo || t.solo));
  const bottomUp = [...visible].reverse();
  const out: DrawItem[] = [];
  for (const t of bottomUp) {
    const map = new Map<string, DrawItem>();
    // Обычные активные клипы.
    for (const c of doc.clips) {
      if (c.trackId === t.id && !c.text && ph >= c.timelineStart && ph < c.timelineStart + c.duration) {
        map.set(c.id, { clip: c, sourceTime: c.inPoint + (ph - c.timelineStart), alpha: 1 });
      }
    }
    // Переход центрирован на стыке [start-d/2, start+d/2] — нахлёст в обе стороны.
    for (const B of doc.clips) {
      if (B.trackId !== t.id || B.text || !B.transition) continue;
      const d = B.transition.duration;
      const s = B.timelineStart - d / 2;
      const e = B.timelineStart + d / 2;
      if (ph < s || ph >= e) continue;
      const f = Math.max(0, Math.min(1, (ph - s) / d));
      // Входящий B: до своего начала — замороженный первый кадр (без чёрного).
      const bTime = ph >= B.timelineStart ? B.inPoint + (ph - B.timelineStart) : B.inPoint;
      map.set(B.id, { clip: B, sourceTime: bTime, alpha: f });
      const A = findPrevAdjacent(doc.clips, B);
      if (A) {
        const aEnd = A.timelineStart + A.duration;
        // Уходящий A: после своего конца — замороженный последний кадр (без чёрного).
        const aTime = ph < aEnd ? A.inPoint + (ph - A.timelineStart) : Math.max(0, A.inPoint + A.duration - 0.05);
        map.set(A.id, { clip: A, sourceTime: aTime, alpha: 1 - f, out: true });
      }
    }
    const arr = [...map.values()].sort((a, b) => (a.out ? 0 : 1) - (b.out ? 0 : 1));
    out.push(...arr);
  }
  return out;
}

// Активные текстовые клипы под плейхедом (снизу вверх), для оверлея и экспорта.
export function activeTexts(doc: ProDocument, ph: number): ProClip[] {
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video' && !t.isAdjustment && !t.hidden);
  const out: ProClip[] = [];
  for (const t of [...videoTracks].reverse()) {
    for (const c of doc.clips) {
      if (c.trackId === t.id && c.text && ph >= c.timelineStart && ph < c.timelineStart + c.duration) out.push(c);
    }
  }
  return out;
}

// Активные корр. слои под плейхедом, снизу вверх (§5 ТЗ).
export function activeAdjustments(doc: ProDocument, ph: number): { filter: number; intensity: number }[] {
  const adjTracks = doc.tracks.filter((t) => t.isAdjustment && !t.hidden);
  const bottomUp = [...adjTracks].reverse();
  const out: { filter: number; intensity: number }[] = [];
  for (const t of bottomUp) {
    for (const c of doc.clips) {
      if (c.trackId === t.id && c.adjust && ph >= c.timelineStart && ph < c.timelineStart + c.duration) {
        out.push({ filter: ADJUST_CODE[c.adjust.filter], intensity: c.adjust.intensity });
      }
    }
  }
  return out;
}
