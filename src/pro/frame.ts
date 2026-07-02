import { ADJUST_CODE, crossfadeAlpha, findPrevAdjacent, transformAt, type ClipTransform, type ProClip, type ProDocument } from './proTypes';

// Сборка кадра под плейхедом — общая для Viewer (превью) и экспорта.

export interface DrawItem {
  clip: ProClip;
  sourceTime: number; // тайм внутри исходника
  alpha: number; // для crossfade
  out?: boolean; // уходящий слой перехода — нужен отдельный video-элемент
  xf?: ClipTransform; // разрешённый Transform (с учётом ключей)
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
        let alpha = 1;
        // Уход в чёрный у правого края (если справа нет смежного — иначе там кроссфейд).
        if (c.tailFade && c.tailFade > 0) {
          const nextAdj = doc.clips.some((o) => o.trackId === t.id && !o.text && o.id !== c.id && Math.abs(o.timelineStart - (c.timelineStart + c.duration)) < 0.06);
          if (!nextAdj) {
            const rem = c.timelineStart + c.duration - ph;
            if (rem < c.tailFade) alpha = Math.max(0, rem / c.tailFade);
          }
        }
        map.set(c.id, { clip: c, sourceTime: c.inPoint + (ph - c.timelineStart) * (c.speed || 1), alpha, xf: transformAt(c, ph - c.timelineStart) });
      }
    }
    // Переход центрирован на стыке [start-d/2, start+d/2] — нахлёст в обе стороны.
    for (const B of doc.clips) {
      if (B.trackId !== t.id || B.text || !B.transition) continue;
      const A = findPrevAdjacent(doc.clips, B);
      const cf = crossfadeAlpha(B, ph);
      if (!cf) continue;
      const { inA, outA } = cf;
      const bSpeed = B.speed || 1;
      // Входящий проигрывается непрерывно, с пред-роллом до реза (не «замороженный» первый кадр).
      const bTime = Math.max(0, B.inPoint + (ph - B.timelineStart) * bSpeed);
      map.set(B.id, { clip: B, sourceTime: bTime, alpha: inA, xf: transformAt(B, ph - B.timelineStart) });
      if (A) {
        // Кроссфейд: уходящий крутится за резом (запас исходника), иначе — рывок в центре перехода.
        const aSpeed = A.speed || 1;
        let aTime = A.inPoint + (ph - A.timelineStart) * aSpeed;
        if (A.sourceDuration) aTime = Math.min(aTime, A.sourceDuration - 0.03);
        aTime = Math.max(0, aTime);
        map.set(A.id, { clip: A, sourceTime: aTime, alpha: outA, out: true, xf: transformAt(A, ph - A.timelineStart) });
      }
      // Без смежного слева A — B просто проявляется от чёрного/нижнего слоя (fade in).
    }
    const arr = [...map.values()].sort((a, b) => (a.out ? 0 : 1) - (b.out ? 0 : 1));
    out.push(...arr);
  }
  return out;
}

// Активные текстовые клипы под плейхедом с альфой (учёт crossfade между смежными титрами).
export interface TextItem {
  clip: ProClip;
  alpha: number;
}
export function activeTexts(doc: ProDocument, ph: number): TextItem[] {
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video' && !t.isAdjustment && !t.hidden);
  const out: TextItem[] = [];
  for (const t of [...videoTracks].reverse()) {
    const map = new Map<string, number>();
    for (const c of doc.clips) {
      if (c.trackId === t.id && c.text && ph >= c.timelineStart && ph < c.timelineStart + c.duration) map.set(c.id, 1);
    }
    // Переход между смежными титрами: входящий проявляется, уходящий гаснет.
    for (const B of doc.clips) {
      if (B.trackId !== t.id || !B.text || !B.transition) continue;
      const A = findPrevAdjacent(doc.clips, B);
      if (!A) continue;
      const cf = crossfadeAlpha(B, ph);
      if (!cf) continue;
      map.set(B.id, cf.inA);
      map.set(A.id, cf.outA);
    }
    for (const [id, alpha] of map) {
      const clip = doc.clips.find((c) => c.id === id);
      if (clip && alpha > 0.001) out.push({ clip, alpha });
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
