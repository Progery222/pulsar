import type { BeatData } from '../types';
import { mediaUrl } from './media';

// Длительность аудио через HTMLAudioElement (для fallback, если Python недоступен).
function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(audio.duration || 0);
    audio.onerror = () => resolve(0);
    audio.src = mediaUrl(audioPath);
  });
}

// Fallback (§14): равномерное разбиение трека на фрагменты по 0.5 секунды.
function fallbackBeatData(duration: number): BeatData {
  const beat_times: number[] = [];
  for (let t = 0; t < duration; t += 0.5) {
    beat_times.push(Number(t.toFixed(3)));
  }
  return {
    tempo: 120,
    beat_times,
    onset_times: [],
    duration,
  };
}

// analyzeBeat — вызывает IPC analyze-audio; при ошибке активирует fallback.
// fallbackDuration используется, когда Python недоступен и нужно знать длину трека.
export async function analyzeBeat(
  audioPath: string,
  fallbackDuration = 0
): Promise<BeatData> {
  try {
    const result = await window.electronAPI.analyzeAudio(audioPath);
    if (
      result &&
      !('error' in result) &&
      Array.isArray((result as BeatData).beat_times) &&
      (result as BeatData).beat_times.length > 0
    ) {
      return result as BeatData;
    }
    throw new Error('error' in (result ?? {}) ? (result as { error: string }).error : 'no beat data');
  } catch {
    const duration = fallbackDuration > 0 ? fallbackDuration : await getAudioDuration(audioPath);
    return fallbackBeatData(duration);
  }
}
