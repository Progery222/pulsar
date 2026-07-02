import { ADJUST_CODE, findPrevAdjacent, transformAt, type ClipTransform, type ProClip, type ProDocument } from './proTypes';

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
        map.set(c.id, { clip: c, sourceTime: c.inPoint + (ph - c.timelineStart) * (c.speed || 1), alpha: 1, xf: transformAt(c, ph - c.timelineStart) });
      }
    }
    // Переход центрирован на стыке [start-d/2, start+d/2] — нахлёст в обе стороны.
    for (const B of doc.clips) {
      if (B.trackId !== t.id || B.text || !B.transition) continue;
      const A = findPrevAdjacent(doc.clips, B);
      if (!A) continue; // нет смежного слева — переход не применяется (не «вылазит» в пустоту)
      const d = B.transition.duration;
      const align = B.transition.align || 'center';
      // Окно перехода относительно реза (B.timelineStart) по выравниванию.
      const s = align === 'left' ? B.timelineStart : align === 'right' ? B.timelineStart - d : B.timelineStart - d / 2;
      const e = s + d;
      if (ph < s || ph >= e) continue;
      const f = Math.max(0, Math.min(1, (ph - s) / d));
      const kind = B.transition.kind || 'dissolve';
      // Через чёрный: сначала уходящий гаснет в чёрный, затем входящий проявляется.
      const inA = kind === 'fadeblack' ? Math.max(0, 2 * f - 1) : f;
      const outA = kind === 'fadeblack' ? Math.max(0, 1 - 2 * f) : 1 - f;
      const bSpeed = B.speed || 1;
      // Входящий проигрывается непрерывно, с пред-роллом до реза (не «замороженный» первый кадр).
      const bTime = Math.max(0, B.inPoint + (ph - B.timelineStart) * bSpeed);
      map.set(B.id, { clip: B, sourceTime: bTime, alpha: inA, xf: transformAt(B, ph - B.timelineStart) });
      const aSpeed = A.speed || 1;
      // Уходящий продолжает крутиться за резом (запас исходника), иначе — рывок в центре перехода.
      let aTime = A.inPoint + (ph - A.timelineStart) * aSpeed;
      if (A.sourceDuration) aTime = Math.min(aTime, A.sourceDuration - 0.03);
      aTime = Math.max(0, aTime);
      map.set(A.id, { clip: A, sourceTime: aTime, alpha: outA, out: true, xf: transformAt(A, ph - A.timelineStart) });
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
