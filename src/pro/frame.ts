import { ADJUST_CODE, crossfadeAlpha, findPrevAdjacent, transformAt, transitionLayers, transitionSpan, type ClipTransform, type ProClip, type ProDocument } from './proTypes';

// Сборка кадра под плейхедом — общая для Viewer (превью) и экспорта.

export interface DrawItem {
  clip: ProClip;
  sourceTime: number; // тайм внутри исходника
  alpha: number; // для crossfade
  out?: boolean; // уходящий слой перехода — нужен отдельный video-элемент
  xf?: ClipTransform; // разрешённый Transform (с учётом ключей)
  blur?: { x: number; y: number; rad: number }; // моушен-блюр перехода (UV-доли)
}

// TransFx.blur -> вектор блюра (направленный вдоль движения или радиальный).
function blurVec(fx: { blur?: number; radial?: boolean; dx: number; dy: number }): { x: number; y: number; rad: number } | undefined {
  if (!fx.blur) return undefined;
  if (fx.radial) return { x: 0, y: 0, rad: fx.blur };
  const ax = Math.abs(fx.dx);
  const ay = Math.abs(fx.dy);
  if (ax < 1e-4 && ay < 1e-4) return { x: 0, y: 0, rad: fx.blur }; // без движения — радиальный (blur dissolve)
  return { x: ax >= ay ? fx.blur : 0, y: ay > ax ? fx.blur : 0, rad: 0 };
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
    // Переход на стыке: библиотека (растворение/чёрный/сдвиг/выталкивание/зум/вращение).
    for (const B of doc.clips) {
      if (B.trackId !== t.id || B.text || !B.transition) continue;
      const A = findPrevAdjacent(doc.clips, B);
      const sp = transitionSpan(B);
      if (!sp || ph < sp.s || ph >= sp.e) continue;
      const f = Math.max(0, Math.min(1, (ph - sp.s) / sp.d));
      const L = transitionLayers(B.transition.kind || 'dissolve', f);
      const W = doc.width;
      const H = doc.height;
      const bSpeed = B.speed || 1;
      const bTime = Math.max(0, B.inPoint + (ph - B.timelineStart) * bSpeed); // непрерывный пред-ролл
      const baseB = transformAt(B, ph - B.timelineStart);
      map.set(B.id, { clip: B, sourceTime: bTime, alpha: L.b.alpha, xf: { x: baseB.x + L.b.dx * W, y: baseB.y + L.b.dy * H, scale: baseB.scale * L.b.scale, rotation: baseB.rotation + L.b.rot }, blur: blurVec(L.b) });
      if (A) {
        const aSpeed = A.speed || 1;
        let aTime = A.inPoint + (ph - A.timelineStart) * aSpeed; // уходящий крутится за резом (запас исходника)
        if (A.sourceDuration) aTime = Math.min(aTime, A.sourceDuration - 0.03);
        aTime = Math.max(0, aTime);
        const baseA = transformAt(A, ph - A.timelineStart);
        map.set(A.id, { clip: A, sourceTime: aTime, alpha: L.a.alpha, out: true, xf: { x: baseA.x + L.a.dx * W, y: baseA.y + L.a.dy * H, scale: baseA.scale * L.a.scale, rotation: baseA.rotation + L.a.rot }, blur: blurVec(L.a) });
      }
      // Без смежного слева A — B просто проявляется/въезжает поверх чёрного/нижнего слоя.
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
