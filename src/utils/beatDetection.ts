import type { BeatData } from '../types';
import { mediaUrl } from './media';

// Длительность аудио через HTMLAudioElement (для fallback, если Python недоступен).
// С жёстким таймаутом: если метаданные не загрузились и onerror не сработал
// (например, кастомный протокол не отдаёт файл), возвращаем 0, а не виснем навсегда.
function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let done = false;
    const finish = (v: number) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(0), 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(audio.duration || 0);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      finish(0);
    };
    audio.src = mediaUrl(audioPath);
  });
}

// Fallback (§14): равномерное разбиение трека на фрагменты по 0.5 секунды.
// Помечается явно: результат — не ритм, и пользователь обязан об этом узнать,
// иначе он получает ролик не в такт под экраном «Готово!».
export function fallbackBeatData(duration: number, reason = 'нет трека'): BeatData {
  const beat_times: number[] = [];
  for (let t = 0; t < duration; t += 0.5) {
    beat_times.push(Number(t.toFixed(3)));
  }
  return { tempo: 120, beat_times, onset_times: [], duration, fallback: true, fallbackReason: reason };
}

// analyzeBeat — вызывает IPC analyze-audio; при ошибке активирует fallback.
// fallbackDuration используется, когда Python недоступен и нужно знать длину трека.
export async function analyzeBeat(
  audioPath: string,
  fallbackDuration = 0
): Promise<BeatData> {
  try {
    // Клиентский предел: librosa холодно стартует ~16с (импорт numba/scipy),
    // поэтому 10с не хватало и реальный бит-детект всегда падал в fallback.
    // Даём 30с — успевает и холодный старт, и анализ; при настоящем зависании
    // всё равно уходим в равномерную сетку, а не виснем.
    const timeoutMs = 30000;
    const result = await Promise.race([
      window.electronAPI.analyzeAudio(audioPath),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('beat analysis timeout (client 10s)')), timeoutMs)
      ),
    ]);
    if (
      result &&
      !('error' in result) &&
      Array.isArray((result as BeatData).beat_times) &&
      (result as BeatData).beat_times.length > 0
    ) {
      return result as BeatData;
    }
    throw new Error('error' in (result ?? {}) ? (result as { error: string }).error : 'no beat data');
  } catch (err) {
    const duration = fallbackDuration > 0 ? fallbackDuration : await getAudioDuration(audioPath);
    const message = err instanceof Error ? err.message : String(err);
    const reason = /timeout/i.test(message)
      ? 'анализ ритма не уложился в 30 секунд'
      : /python/i.test(message)
        ? 'не установлен анализ ритма (Python)'
        : 'анализ ритма не удался';
    return fallbackBeatData(duration, reason);
  }
}
