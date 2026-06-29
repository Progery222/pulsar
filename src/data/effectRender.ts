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

// Темп клипа по слоту speed (1 = без изменения). Применяется ко всему фрагменту,
// потому что менять скорость импульсом внутри бит-сетки невозможно без рассинхрона:
// фрагмент по-прежнему выдаёт ровно clip.duration на выходе (через setpts + atempo),
// а ускорение/замедление выражается в том, сколько исходника он проигрывает.
export function clipSpeedRate(slots: RenderEffectSlot[]): number {
  const s = slots.find((x) => x.effect === 'speed');
  if (!s) return 1;
  const k = Math.max(0, Math.min(1, s.intensity / 100));
  if (s.variant === 'down') return r3(1 - 0.4 * k); // 0.6..1.0
  if (s.variant === 'constant') return r3(1 + 0.4 * k); // 1.0..1.4
  return r3(1 + 0.6 * k); // up: 1.0..1.6
}

// Граф split (2×2 / зеркало / 2 полосы) от метки [base] к [v]. Целый фрагмент.
function splitGraph(variant: string, w: number, h: number): string {
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  if (variant === '2x2') {
    return `[base]scale=${hw}:${hh},split=4[a][b][c][d];[a][b]hstack=inputs=2[t];[c][d]hstack=inputs=2[bt];[t][bt]vstack=inputs=2[v]`;
  }
  if (variant === 'vertical') {
    return `[base]scale=${w}:${hh},split=2[t][b];[t][b]vstack=inputs=2[v]`;
  }
  // mirror: левая половина + её зеркало справа.
  return `[base]crop=${hw}:${h}:0:0,split=2[l][r];[r]hflip[rf];[l][rf]hstack=inputs=2[v]`;
}

// Полный видео-граф фрагмента: от [0:v] к [v]. Включает scaleChain, импульсные
// эффекты, опциональный setpts (speed) и опциональный split (geometry).
// Возвращает rate, чтобы вызывающий код согласовал аудио (atempo) и тайминг.
export function buildClipVideoGraph(
  slots: RenderEffectSlot[],
  scaleChain: string,
  w: number,
  h: number,
  fps: number
): { graph: string; rate: number } {
  const rate = clipSpeedRate(slots);
  const linear: string[] = [scaleChain];
  for (const slot of slots) linear.push(...effectSlotFilters(slot, w, h, fps));
  if (rate !== 1) linear.push(`setpts=(PTS-STARTPTS)/${rate}`);
  const vchain = linear.join(',');

  const split = slots.find((s) => s.effect === 'split');
  if (!split) return { graph: `[0:v]${vchain}[v]`, rate };
  return { graph: `[0:v]${vchain}[base];${splitGraph(split.variant, w, h)}`, rate };
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

    case 'fastCut': {
      // Стробоскопический акцент по биту. 'strobe' — мигание яркостью; 'cuts' —
      // более жёсткий стук с подскоком контраста. Оба — линейная цепочка с
      // покадровым eval и гейтом по окну бита (тайминг-нейтрально, без рассинхрона).
      const n = Math.max(2, Math.round(4 + k * 10)); // число вспышек в окне
      const period = r3(win / (2 * n));
      const phase = `mod(floor((t-${a})/${period}),2)`;
      if (slot.variant === 'cuts') {
        const br = r3(0.18 * k);
        const ct = r3(0.6 * k);
        return [
          `eq=brightness='${br}*${phase}':contrast='1+${ct}*${phase}':eval=frame:enable='${gate}'`,
        ];
      }
      const br = r3(0.45 * k);
      return [`eq=brightness='${br}*${phase}':eval=frame:enable='${gate}'`];
    }

    case 'boomerang': {
      // Аппроксимация «реверса»: настоящий разворот сегмента возможен только на
      // уровне фрагмента (структурно), что ломает тайминг бит-сетки. Здесь даём
      // узнаваемый «глитч-толчок» — ротация оттенка + RGB-сдвиг в окне бита.
      const sh = Math.round(5 + 5 * k);
      return [
        `hue=h='((t-${a})/${win})*180':enable='${gate}'`,
        `rgbashift=rh=${sh}:bh=${-sh}:enable='${gate}'`,
      ];
    }

    // split — geometry (целый фрагмент, отдельный граф). speed — изменение темпа
    // (обрабатывается на уровне фрагмента в ffmpegRender, не как импульс).
    default:
      return [];
  }
}
