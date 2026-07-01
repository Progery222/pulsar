import { mediaUrl } from '../utils/media';
import type { BeatData } from '../types';

// Детект битов/онсетов в браузере (Web Audio) — без Python/librosa.
// Считаем энергию по окнам, положительный поток (onset), пик-пикинг по локальному порогу.
export async function detectBeats(path: string): Promise<BeatData | null> {
  try {
    const res = await fetch(mediaUrl(path));
    const bytes = await res.arrayBuffer();
    const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(bytes);
    ctx.close();

    const data = audio.getChannelData(0);
    const sr = audio.sampleRate;
    const hop = 1024;
    const frames = Math.floor(data.length / hop);
    if (frames < 4) return null;

    const energy = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0;
      const base = i * hop;
      for (let j = 0; j < hop; j++) {
        const v = data[base + j];
        s += v * v;
      }
      energy[i] = Math.sqrt(s / hop);
    }
    const flux = new Float32Array(frames);
    for (let i = 1; i < frames; i++) {
      const d = energy[i] - energy[i - 1];
      flux[i] = d > 0 ? d : 0;
    }

    const onsets: number[] = [];
    const win = 43; // ~1с окно для локального порога
    for (let i = 1; i < frames - 1; i++) {
      const lo = Math.max(0, i - win);
      const hi = Math.min(frames, i + win);
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += flux[k];
      const mean = sum / (hi - lo);
      if (flux[i] > mean * 1.6 && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > 1e-4) {
        const t = (i * hop) / sr;
        if (!onsets.length || t - onsets[onsets.length - 1] > 0.14) onsets.push(t);
      }
    }
    if (onsets.length < 2) return null;

    // Оценка темпа по медиане интервалов.
    const gaps = [];
    for (let i = 1; i < onsets.length; i++) gaps.push(onsets[i] - onsets[i - 1]);
    gaps.sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)] || 0.5;
    const tempo = med > 0 ? Math.round(60 / med) : 120;

    return { beat_times: onsets, onset_times: onsets, duration: audio.duration, tempo };
  } catch {
    return null;
  }
}
