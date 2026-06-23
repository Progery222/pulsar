import type { EffectName, GeneratedClip } from '../types';

// §9.4: расстановка эффектов по таймлайну.
export function applyEffects(
  clips: GeneratedClip[],
  activeEffects: Record<EffectName, 0 | 1 | 2>,
  beatTimes: number[]
): GeneratedClip[] {
  const out: GeneratedClip[] = clips.map((c) => ({ ...c, effectSlots: [] }));
  if (out.length === 0) return out;

  // Абсолютные старты клипов на таймлайне вывода.
  const starts: number[] = [];
  let acc = 0;
  for (const c of out) {
    starts.push(acc);
    acc += c.duration;
  }
  const total = acc;

  const nearestClip = (t: number): number => {
    const tt = Math.max(0, Math.min(t, total));
    for (let i = 0; i < out.length; i++) {
      if (tt >= starts[i] && tt < starts[i] + out[i].duration) return i;
    }
    return out.length - 1;
  };

  // Метки в пределах таймлайна вывода.
  const usable = beatTimes.filter((t) => t >= 0 && t <= total);

  for (const [effectKey, level] of Object.entries(activeEffects) as [EffectName, 0 | 1 | 2][]) {
    if (!level) continue;
    const fraction = level === 1 ? 0.2 : 0.4; // уровень 1 — 20%, уровень 2 — 40%
    const count = Math.max(1, Math.round(usable.length * fraction));

    // Случайный порядок меток.
    const shuffled = [...usable];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Выбор меток не ближе 0.5 сек друг к другу.
    const chosen: number[] = [];
    for (const t of shuffled) {
      if (chosen.length >= count) break;
      if (chosen.every((x) => Math.abs(x - t) >= 0.5)) chosen.push(t);
    }

    // Запись эффекта в effectSlots ближайшего клипа.
    for (const t of chosen) {
      out[nearestClip(t)].effectSlots.push({ effect: effectKey, time: t });
    }
  }

  return out;
}
