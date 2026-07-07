import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { analyzeBeat, fallbackBeatData } from '../utils/beatDetection';
import { generateClips } from '../utils/videoSlicer';
import { applyEffects } from '../utils/effectsEngine';

const STEPS = [
  'Анализируем аудио...',
  'Нарезаем клипы...',
  'Применяем эффекты...',
  'Готово!',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ProcessingScreen (§5.4): analyzeBeat -> generateClips -> applyEffects -> EditorScreen.
export default function ProcessingScreen() {
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    // Запуск ровно один раз (ref переживает двойной монтаж StrictMode в dev).
    // Никакого `cancelled`: cleanup при StrictMode-размонтировании иначе блокировал
    // финальный переход и экран «Синхронизируем…» висел на «Готово».
    if (ran.current) return;
    ran.current = true;
    const s = useProjectStore.getState();

    async function run() {
      s.setIsProcessing(true);

      // 1. Анализ аудио. Без выбранного трека анализ пропускаем — берём
      // равномерную сетку сразу (не ждём Python/таймаут).
      setStepIdx(0);
      setProgress(10);
      const beatData = s.selectedTrack
        ? await analyzeBeat(s.selectedTrack.file, s.selectedTrack.duration ?? 0)
        : fallbackBeatData(s.duration && s.duration > 0 ? s.duration : 30);
      setProgress(40);

      // 2. Нарезка клипов
      setStepIdx(1);
      const clips = generateClips(
        beatData,
        s.mediaFiles,
        s.mood,
        s.duration,
        s.segmentStart,
        s.mediaOrder
      );
      setProgress(70);

      // 3. Расстановка эффектов
      setStepIdx(2);
      const withEffects = applyEffects(clips, s.activeEffects, beatData.beat_times);
      setProgress(100);
      setStepIdx(3);

      // Сохранение результата в store
      s.setBeatData(beatData);
      s.setGeneratedClips(withEffects);
      s.setIsProcessing(false);

      await sleep(300);
      s.setCurrentScreen('editor');
    }

    // Никакой сбой на этапе обработки не должен оставлять пользователя на экране
    // «Синхронизируем...» навсегда. При ошибке логируем и всё равно уходим в редактор.
    run().catch((err) => {
      console.error('processing failed:', err);
      s.setIsProcessing(false);
      s.setCurrentScreen('editor');
    });
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-bg-primary">
      <div
        className="animate-pulse-circle rounded-full"
        style={{ width: 80, height: 80, backgroundColor: 'var(--accent-green)' }}
      />

      <p className="mt-10 text-text-primary" style={{ fontSize: 18 }}>
        Синхронизируем видео с ритмом...
      </p>

      {/* Линейный прогресс-бар 320px */}
      <div
        className="mt-6 overflow-hidden rounded-full bg-bg-tertiary"
        style={{ width: 320, height: 6 }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress}%`, backgroundColor: 'var(--accent-green)' }}
        />
      </div>

      <p className="mt-4 text-text-secondary" style={{ fontSize: 14 }}>
        {STEPS[stepIdx]}
      </p>
    </div>
  );
}
