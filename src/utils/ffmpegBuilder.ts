import type { ProjectState } from '../store/projectStore';

type Quality = '720p' | '1080p' | '4k';

// buildAndRender (§10): формирует запрос рендеринга и вызывает FFmpeg pipeline в
// main-процессе. Прогресс пробрасывается через onProgress.
export async function buildAndRender(
  project: ProjectState,
  outputPath: string,
  quality: Quality,
  onProgress: (percent: number) => void
): Promise<void> {
  const unsubscribe = window.electronAPI.onExportProgress(onProgress);
  try {
    const request = {
      clips: project.generatedClips.map((c) => ({
        sourceFile: c.sourceFile,
        startTime: c.startTime,
        duration: c.duration,
        effects: c.effectSlots.map((s) => s.effect),
      })),
      audioFile: project.selectedTrack?.file ?? null,
      segmentStart: project.segmentStart,
      duration: project.duration,
      format: project.format,
      fade: project.fade,
      filter: project.activeFilter,
      filterIntensity: project.filterIntensity,
      quality,
      outputPath,
    };

    const result = await window.electronAPI.renderVideo(request);
    if (result && 'error' in result) {
      throw new Error(result.error);
    }
  } finally {
    unsubscribe();
  }
}
