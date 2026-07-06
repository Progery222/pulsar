import { useProjectStore } from "../../../stores/project-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { toast } from "../../../stores/notification-store";

/**
 * Настоящий cross-dissolve с перехлёстом: clipB (и всё, что правее на дорожке)
 * сдвигается влево так, чтобы clipB заходил под конец clipA на длительность
 * перехода. В зоне перехлёста оба клипа содержат текущее время, поэтому в
 * превью/экспорте берутся реальные кадры обоих (а не «замороженные» края).
 */
export async function applyCrossfadeOverlap(
  clipAId: string,
  clipBId: string,
  trackId: string,
): Promise<void> {
  const store = useProjectStore.getState();
  const project = store.project;
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const clipA = track.clips.find((c) => c.id === clipAId);
  const clipB = track.clips.find((c) => c.id === clipBId);
  if (!clipA || !clipB) return;

  const clipAEnd = clipA.startTime + clipA.duration;
  const dur = Math.max(
    0.1,
    Math.min(0.5, clipA.duration * 0.5, clipB.duration * 0.5),
  );

  // Сдвигаем clipB и все клипы правее него на дорожке так, чтобы clipB начинался
  // в (clipAEnd - dur). delta закрывает зазор (если был) и создаёт перехлёст.
  const newBStart = clipAEnd - dur;
  const delta = clipB.startTime - newBStart;
  if (delta > 0.0001) {
    const following = [...track.clips]
      .filter((c) => c.startTime >= clipB.startTime - 0.0001)
      .sort((a, b) => a.startTime - b.startTime);
    store.beginHistoryGroup?.("crossfade");
    for (const c of following) {
      await store.moveClip(c.id, Math.max(0, c.startTime - delta), track.id);
    }
  } else {
    store.beginHistoryGroup?.("crossfade");
  }

  const bridge = getTransitionBridge();
  bridge.initialize(project.settings.width, project.settings.height);
  const a = { ...clipA, trackId: track.id };
  const b = { ...clipB, startTime: newBStart, trackId: track.id };
  const result = bridge.createTransition(
    a,
    b,
    "crossfade",
    dur,
    bridge.getDefaultParams("crossfade"),
  );

  if (result.success && result.transitionId) {
    const t = bridge.getTransition(result.transitionId);
    if (t) {
      store.addClipTransition(t);
      store.endHistoryGroup?.();
      toast.success("Кроссфейд добавлен", `${dur.toFixed(1)} c, перехлёст`);
      return;
    }
  }
  store.endHistoryGroup?.();
  toast.error("Кроссфейд", result.error || "Не удалось добавить переход");
}
