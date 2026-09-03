import { useEffect, useState } from 'react';

/**
 * Настоящая волна трека для полос выбора фрагмента и таймлайна.
 *
 * Раньше оба места рисовали формулу `|sin(i·0.5)·cos(i·0.13)|` — одинаковую для
 * любого трека. По этой «волне» пользователь выбирал фрагмент, то есть выбирал
 * вслепую. Пики считает main (`media:waveform`, ffmpeg → PCM → максимумы,
 * ~60 точек в секунду, кэш в userData); здесь они сжимаются до нужного числа
 * столбцов и нормируются, чтобы тихий трек не выглядел плоской линией.
 */

const cache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[] | null>>();

/** Сжать пики до `buckets` столбцов: в каждом — максимум своего окна. */
export function resamplePeaks(peaks: number[], buckets: number): number[] {
  if (peaks.length === 0 || buckets <= 0) return [];
  const out = new Array<number>(buckets).fill(0);
  const per = peaks.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = from; i < to && i < peaks.length; i++) if (peaks[i] > peak) peak = peaks[i];
    out[b] = peak;
  }
  const max = Math.max(...out, 1e-6);
  // Нормировка к самому громкому месту и нижний порог: столбец нулевой высоты
  // читается как «дырка в треке», а не как тихий момент.
  return out.map((v) => Math.max(0.06, v / max));
}

async function load(src: string, buckets: number): Promise<number[] | null> {
  const key = `${src}::${buckets}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await window.electronAPI.waveform(src);
      if (!res || !Array.isArray(res.peaks) || res.peaks.length === 0) return null;
      const bars = resamplePeaks(res.peaks, buckets);
      cache.set(key, bars);
      return bars;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * Столбцы волны для трека или null, пока считается / если посчитать не вышло.
 * null — сигнал рисовать нейтральную заглушку, а не выдумывать волну.
 */
export function useWaveform(src: string | null | undefined, buckets: number): number[] | null {
  const [bars, setBars] = useState<number[] | null>(() => (src ? cache.get(`${src}::${buckets}`) ?? null : null));

  useEffect(() => {
    if (!src) {
      setBars(null);
      return;
    }
    let alive = true;
    const cached = cache.get(`${src}::${buckets}`);
    if (cached) {
      setBars(cached);
      return;
    }
    setBars(null);
    void load(src, buckets).then((b) => {
      if (alive) setBars(b);
    });
    return () => {
      alive = false;
    };
  }, [src, buckets]);

  return bars;
}

/** Нейтральная заглушка на время расчёта: ровные низкие столбцы, без «музыки». */
export const placeholderBars = (buckets: number): number[] => new Array<number>(buckets).fill(0.12);
