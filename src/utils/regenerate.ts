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

// Повторная генерация со случайным порядком клипов (Shuffle в редакторе, Ctrl+R).
export function shuffleMontage() {
  const s = useProjectStore.getState();
  if (!s.beatData) return;
  const order = [...(s.mediaOrder.length ? s.mediaOrder : s.mediaFiles.map((f) => f.id))];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const clips = generateClips(s.beatData, s.mediaFiles, s.mood, s.duration, s.segmentStart, order);
  s.setGeneratedClips(applyEffects(clips, s.activeEffects, s.beatData.beat_times));
}

// Перерасстановка эффектов по текущим клипам (для EDIT: переключение/Shuffle).
export function reapplyEffects() {
  const s = useProjectStore.getState();
  if (!s.beatData) return;
  const updated = applyEffects(s.generatedClips, s.activeEffects, s.beatData.beat_times);
  s.setGeneratedClips(updated);
}
