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
  const bottomUp = [...visible].reverse(); // doc: верхняя дорожка первой → рисуем с нижней
  const out: DrawItem[] = [];
  for (const t of bottomUp) {
    const active = doc.clips.filter((c) => c.trackId === t.id && ph >= c.timelineStart && ph < c.timelineStart + c.duration);
    for (const B of active) {
      let alphaB = 1;
      if (B.transition && ph < B.timelineStart + B.transition.duration) {
        const d = B.transition.duration;
        const f = (ph - B.timelineStart) / d;
        alphaB = f;
        const A = findPrevAdjacent(doc.clips, B);
        if (A) out.push({ clip: A, sourceTime: A.inPoint + A.duration + (ph - B.timelineStart), alpha: 1 - f, out: true });
      }
      out.push({ clip: B, sourceTime: B.inPoint + (ph - B.timelineStart), alpha: alphaB });
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
