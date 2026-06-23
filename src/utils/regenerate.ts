import { useProjectStore } from '../store/projectStore';
import { generateClips } from './videoSlicer';
import { applyEffects } from './effectsEngine';

// Пересчёт монтажа с текущими настройками store (для Duration/Mood/Segment/Shuffle).
export function regenerateMontage() {
  const s = useProjectStore.getState();
  if (!s.beatData) return;
  const clips = generateClips(
    s.beatData,
    s.mediaFiles,
    s.mood,
    s.duration,
    s.segmentStart,
    s.mediaOrder
  );
  const withEffects = applyEffects(clips, s.activeEffects, s.beatData.beat_times);
  s.setGeneratedClips(withEffects);
}
