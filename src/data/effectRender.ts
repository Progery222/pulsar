import type { EffectName } from '../types';

// Маппинг «эффект → FFmpeg-фильтр» для РЕНДЕРА.
//
// Источник истины по семантике — live-превью (`EditorScreen.applyVisuals`):
// каждый эффект срабатывает коротким импульсом в момент бита (окно EFFECT_WIN),
// учитывает вариант (variant) и силу (intensity 0..100). Раньше рендер игнорировал
// и тайминг, и вариант, и силу — вешал эффект на весь фрагмент и только для 5 из 9
// эффектов. Этот модуль возвращает фильтры, привязанные к моменту бита через
// `enable='between(t,A,B)'`, чтобы финальный клип совпадал с тем, что видно в превью.
//
// ВАЖНО про запятые: внутри одного filterchain запятая разделяет фильтры. Поэтому
// все выражения, содержащие запятые (between, if, ...), ОБЯЗАТЕЛЬНО берём в одинарные
// кавычки — парсер filtergraph трактует кавычки буквально и не считает такие запятые
// разделителями.

export const EFFECT_WIN = 0.35; // длительность импульса эффекта, сек (как в превью)

// Один эффект, привязанный к моменту внутри фрагмента.
export interface RenderEffectSlot {
  effect: EffectName;
  at: number; // секунды от начала фрагмента (clip-local)
  variant: string;
  intensity: number; // 0..100
}

// Округление до 3 знаков — компактные и стабильные выражения.
function r3(n: number): number {
  return Number(n.toFixed(3));
}

// Возвращает части filterchain для одного эффект-слота. Пустой массив — эффект пока
// рендерится отдельной веткой (geometry/timing) либо не имеет видеофильтра.
export function effectSlotFilters(
  slot: RenderEffectSlot,
  w: number,
  h: number,
  fps: number
): string[] {
  const a = r3(Math.max(0, slot.at));
  const b = r3(a + EFFECT_WIN);
  const k = Math.max(0, Math.min(1, slot.intensity / 100));
  const win = EFFECT_WIN;
  const gate = `between(t,${a},${b})`; // в кавычки оборачиваем при подстановке
  // Затухающая огибающая импульса: 1 в начале окна → 0 в конце.
  const env = `(1-(t-${a})/${win})`;

  switch (slot.effect) {
    case 'flash': {
      // Белая — кратковременная засветка; чёрная — затемнение. eval=frame, чтобы
      // яркость пересчитывалась покадрово по времени t.
      if (slot.variant === 'black') {
        const peak = r3(0.7 * k);
        return [`eq=brightness='-${peak}*${env}':eval=frame:enable='${gate}'`];
      }
      const peak = r3(0.5 * k);
      return [`eq=brightness='${peak}*${env}':eval=frame:enable='${gate}'`];
    }

    case 'hue': {
      // Цветовая ротация на бит + временный подъём насыщенности.
      const sat = r3(1 + k);
      return [`hue=h='((t-${a})/${win})*360':s='${sat}':enable='${gate}'`];
    }

    case 'prism': {
      // Резкое RGB-смещение. rgbashift не вычисляет выражения покадрово —
      // силу сдвига считаем заранее (в пикселях), а тайминг даёт enable.
      const sh = Math.round(4 + 4 * k);
      return [`rgbashift=rh=${sh}:bh=${-sh}:enable='${gate}'`];
    }

    case 'rgb': {
      // Более выраженное RGB-смещение (мягкий вариант в превью — но сильнее по сдвигу).
      const sh = Math.round(6 + 6 * k);
      return [`rgbashift=rh=${sh}:bh=${-sh}:enable='${gate}'`];
    }

    case 'zoom': {
      // Анимированный наезд по биту через zoompan (d=1 → каждый входной кадр = один
      // выходной, тайминг сохраняется). amount как в превью: 0.08+0.5*k.
      // Вне окна бита z=1 (без зума). Центрирование — стандартными x/y zoompan.
      const amount = r3(0.08 + 0.5 * k);
      const prog = `((it-${a})/${win})`;
      let zExpr: string;
      if (slot.variant === 'out') {
        zExpr = `1+${amount}*(1-${prog})`;
      } else if (slot.variant === 'punch') {
        zExpr = `1+${amount}*sin(${prog}*PI)`;
      } else {
        zExpr = `1+${amount}*${prog}`; // in (наезд)
      }
      const z = `if(between(it,${a},${b}),${zExpr},1)`;
      return [
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${fps}`,
      ];
    }

    // boomerang/split/fastCut/speed — A3 (geometry/timing).
    default:
      return [];
  }
}
