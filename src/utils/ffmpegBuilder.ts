import type { ProjectState } from '../store/projectStore';

type Quality = '720p' | '1080p' | '4k';

// buildAndRender (§10): формирует запрос рендеринга и вызывает FFmpeg pipeline в
// main-процессе. Прогресс пробрасывается через onProgress.
// Возвращает true при успешном рендере, false при отмене; бросает при реальной ошибке.
type Clip = ProjectState['generatedClips'][number];

export async function buildAndRender(
  project: ProjectState,
  outputPath: string,
  quality: Quality,
  onProgress: (percent: number) => void
): Promise<boolean> {
  // Собрать запрос рендеринга для заданного порядка клипов и числа копий.
  const makeRequest = (clips: Clip[], count: number, outPath: string) => {
    // Абсолютные старты клипов на таймлайне вывода — чтобы перевести
    // effectSlots.time (абсолютное время) в clip-local `at` для импульса по биту.
    const clipStarts: number[] = [];
    let acc = 0;
    for (const c of clips) {
      clipStarts.push(acc);
      acc += c.duration;
    }
    return {
      clips: clips.map((c, i) => ({
        sourceFile: c.sourceFile,
        startTime: c.startTime,
        duration: c.duration,
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
      count,
      quality,
      transition: project.transition,
      title: project.title.text.trim() ? project.title : null,
      outputPath: outPath,
    };
  };

  const shuffled = (): Clip[] => {
    const a = [...project.generatedClips];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const uq = project.uniqualizerSettings;
  const count = Math.max(1, Math.floor(project.uniqualizerCount || 1));
  const perCopyShuffle = uq.enabled && uq.shuffleOrder && count > 1 && project.generatedClips.length > 1;

  // Обычный путь: один запрос на N копий (общий монтаж, разная уникализация).
  if (!perCopyShuffle) {
    const unsubscribe = window.electronAPI.onExportProgress(onProgress);
    try {
      const result = await window.electronAPI.renderVideo(makeRequest(project.generatedClips, count, outputPath));
      if (result && 'error' in result) throw new Error(result.error);
      return !(result && 'cancelled' in result);
    } finally {
      unsubscribe();
    }
  }

  // Перемешать порядок: N отдельных рендеров, у каждого свой случайный порядок клипов.
  const dot = outputPath.lastIndexOf('.');
  const stem = dot > 0 ? outputPath.slice(0, dot) : outputPath;
  const ext = dot > 0 ? outputPath.slice(dot) : '.mp4';
  let curIdx = 0;
  const unsubscribe = window.electronAPI.onExportProgress((p) => {
    onProgress(Math.min(100, Math.round(((curIdx + p / 100) / count) * 100)));
  });
  try {
    for (let i = 0; i < count; i++) {
      curIdx = i;
      const out = `${stem}_${i + 1}${ext}`;
      const result = await window.electronAPI.renderVideo(makeRequest(shuffled(), 1, out));
      if (result && 'error' in result) throw new Error(result.error);
      if (result && 'cancelled' in result) return false;
    }
    onProgress(100);
    return true;
  } finally {
    unsubscribe();
  }
}
