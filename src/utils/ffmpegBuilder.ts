import type { ProjectState } from '../store/projectStore';

type Quality = '720p' | '1080p' | '4k';

// buildAndRender (§10): формирует запрос рендеринга и вызывает FFmpeg pipeline в
// main-процессе. Прогресс пробрасывается через onProgress.
// Возвращает true при успешном рендере, false при отмене; бросает при реальной ошибке.
export async function buildAndRender(
  project: ProjectState,
  outputPath: string,
  quality: Quality,
  onProgress: (percent: number) => void
): Promise<boolean> {
  const unsubscribe = window.electronAPI.onExportProgress(onProgress);
  try {
    // Абсолютные старты клипов на таймлайне вывода — чтобы перевести
    // effectSlots.time (абсолютное время) в clip-local `at` для импульса по биту.
    const clipStarts: number[] = [];
    {
      let acc = 0;
      for (const c of project.generatedClips) {
        clipStarts.push(acc);
        acc += c.duration;
      }
    }
    const request = {
      clips: project.generatedClips.map((c, i) => ({
        sourceFile: c.sourceFile,
        startTime: c.startTime,
        duration: c.duration,
        // Полные данные эффекта: момент относительно начала клипа, вариант и сила.
        // Рендер использует их, чтобы повторить тайминг/вариант/интенсивность превью.
        effects: c.effectSlots.map((s) => ({
          effect: s.effect,
          at: Math.max(0, Number((s.time - clipStarts[i]).toFixed(3))),
          variant: project.effectSettings[s.effect]?.variant ?? 'default',
          intensity: project.effectSettings[s.effect]?.intensity ?? 50,
        })),
      })),
      audioFile: project.selectedTrack?.file ?? null,
      segmentStart: project.segmentStart,
      duration: project.duration,
      format: project.format,
      fade: project.fade,
      filter: project.activeFilter,
      filterIntensity: project.filterIntensity,
      volumeOriginal: project.volumeOriginal,
      volumeMusic: project.volumeMusic,
      uniqualizer: project.uniqualizerSettings,
      count: project.uniqualizerCount,
      quality,
      transition: project.transition,
      outputPath,
    };

    const result = await window.electronAPI.renderVideo(request);
    if (result && 'error' in result) {
      throw new Error(result.error);
    }
    return !(result && 'cancelled' in result);
  } finally {
    unsubscribe();
  }
}
