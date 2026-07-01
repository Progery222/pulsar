import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createEmptyProDocument,
  DEFAULT_CROP,
  DEFAULT_TRANSFORM,
  type ClipCrop,
  type ClipTransform,
  type ProClip,
  type ProDocument,
  type ProTool,
  type ViewerMode,
} from '../pro/proTypes';

let clipSeq = 0;
function nextClipId(): string {
  clipSeq += 1;
  return `c${clipSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

// Стор профессионального мульти-трек монтажа (Pulsar Pro).
// Отдельно от projectStore (beat-sync). Immer-middleware для мутаций
// вложенного дерева tracks/clips. Undo/Redo (стек патчей) — Фаза 6.

export interface ProState {
  doc: ProDocument;

  // Навигация и скраббинг (§3.2 ТЗ).
  playhead: number; // сек
  pxPerSec: number; // масштаб таймлайна (zoom)
  scrollX: number; // панорамирование (сек, смещение левого края видимой зоны)
  isPlaying: boolean;

  // Редактирование.
  activeTool: ProTool;
  snapping: boolean; // прилипание (отключается клавишей N)
  selectedClipIds: string[];
  viewerMode: ViewerMode; // режим оверлея во Viewer (Transform/Crop)

  // Раскладка панелей (resizable, Фаза 1).
  leftWidth: number;
  timelineHeight: number;

  // Действия.
  setPlayhead: (t: number) => void;
  setZoom: (pxPerSec: number) => void;
  setScrollX: (x: number) => void;
  setPlaying: (v: boolean) => void;
  setTool: (tool: ProTool) => void;
  toggleSnapping: () => void;
  setSelection: (ids: string[]) => void;
  setViewerMode: (mode: ViewerMode) => void;
  updateClipTransform: (id: string, patch: Partial<ClipTransform>) => void;
  updateClipCrop: (id: string, patch: Partial<ClipCrop>) => void;
  setLeftWidth: (w: number) => void;
  setTimelineHeight: (h: number) => void;
  resetDocument: () => void;

  // Документ.
  addClip: (clip: Omit<ProClip, 'id'>) => string;
  toggleTrackFlag: (trackId: string, flag: 'muted' | 'solo' | 'locked' | 'hidden') => void;
  moveClip: (id: string, trackId: string, timelineStart: number) => void;
  moveClipsBy: (ids: string[], dt: number) => void;
  setClipTrim: (id: string, patch: { timelineStart: number; inPoint: number; duration: number }) => void;
  splitClipAt: (id: string, atTime: number) => void;
  removeClips: (ids: string[]) => void;
  rippleDeleteClips: (ids: string[]) => void;
}

const MIN_DUR = 0.05; // минимальная длина клипа (сек)

export const useProStore = create<ProState>()(
  immer((set) => ({
    doc: createEmptyProDocument(),

    playhead: 0,
    pxPerSec: 60,
    scrollX: 0,
    isPlaying: false,

    activeTool: 'select',
    snapping: true,
    selectedClipIds: [],
    viewerMode: 'none',

    leftWidth: 300,
    timelineHeight: 300,

    setPlayhead: (t) =>
      set((s) => {
        s.playhead = Math.max(0, t);
      }),
    setZoom: (pxPerSec) =>
      set((s) => {
        s.pxPerSec = Math.min(400, Math.max(4, pxPerSec));
      }),
    setScrollX: (x) =>
      set((s) => {
        s.scrollX = Math.max(0, x);
      }),
    setPlaying: (v) =>
      set((s) => {
        s.isPlaying = v;
      }),
    setTool: (tool) =>
      set((s) => {
        s.activeTool = tool;
      }),
    toggleSnapping: () =>
      set((s) => {
        s.snapping = !s.snapping;
      }),
    setSelection: (ids) =>
      set((s) => {
        s.selectedClipIds = ids;
      }),
    setViewerMode: (mode) =>
      set((s) => {
        s.viewerMode = mode;
      }),
    updateClipTransform: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, ...patch };
      }),
    updateClipCrop: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        const next = { ...DEFAULT_CROP, ...c.crop, ...patch };
        // границы 0..0.9, чтобы кроп не схлопнулся
        next.top = Math.min(0.9, Math.max(0, next.top));
        next.bottom = Math.min(0.9, Math.max(0, next.bottom));
        next.left = Math.min(0.9, Math.max(0, next.left));
        next.right = Math.min(0.9, Math.max(0, next.right));
        c.crop = next;
      }),
    setLeftWidth: (w) =>
      set((s) => {
        s.leftWidth = Math.min(520, Math.max(220, w));
      }),
    setTimelineHeight: (h) =>
      set((s) => {
        s.timelineHeight = Math.min(640, Math.max(160, h));
      }),
    resetDocument: () =>
      set((s) => {
        s.doc = createEmptyProDocument();
        s.playhead = 0;
        s.scrollX = 0;
        s.selectedClipIds = [];
      }),

    addClip: (clip) => {
      const id = nextClipId();
      set((s) => {
        s.doc.clips.push({ ...clip, id });
      });
      return id;
    },
    toggleTrackFlag: (trackId, flag) =>
      set((s) => {
        const t = s.doc.tracks.find((tr) => tr.id === trackId);
        if (t) t[flag] = !t[flag];
      }),

    moveClip: (id, trackId, timelineStart) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        const target = s.doc.tracks.find((t) => t.id === trackId);
        const cur = s.doc.tracks.find((t) => t.id === c.trackId);
        // Смена дорожки — только между дорожками того же типа.
        if (target && cur && target.kind === cur.kind && !target.locked) c.trackId = trackId;
        c.timelineStart = Math.max(0, timelineStart);
      }),

    moveClipsBy: (ids, dt) =>
      set((s) => {
        // Не даём уехать левее нуля: ограничиваем сдвиг самым левым клипом.
        const sel = s.doc.clips.filter((c) => ids.includes(c.id));
        if (!sel.length) return;
        const minStart = Math.min(...sel.map((c) => c.timelineStart));
        const applied = Math.max(dt, -minStart);
        for (const c of sel) c.timelineStart += applied;
      }),

    setClipTrim: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        c.timelineStart = Math.max(0, patch.timelineStart);
        c.inPoint = Math.max(0, patch.inPoint);
        c.duration = Math.max(MIN_DUR, patch.duration);
      }),

    splitClipAt: (id, atTime) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        const end = c.timelineStart + c.duration;
        if (atTime <= c.timelineStart + MIN_DUR || atTime >= end - MIN_DUR) return;
        const offset = atTime - c.timelineStart; // сек от начала клипа
        const rightId = nextClipId();
        const rightEffects = (c.effects ?? []).filter((ef) => ef.offset >= offset).map((ef) => ({ ...ef, offset: ef.offset - offset }));
        const leftEffects = (c.effects ?? []).filter((ef) => ef.offset < offset);
        const right: ProClip = {
          ...c,
          id: rightId,
          timelineStart: atTime,
          inPoint: c.inPoint + offset,
          duration: c.duration - offset,
          effects: rightEffects.length ? rightEffects : undefined,
        };
        c.duration = offset;
        c.effects = leftEffects.length ? leftEffects : undefined;
        s.doc.clips.push(right);
      }),

    removeClips: (ids) =>
      set((s) => {
        s.doc.clips = s.doc.clips.filter((c) => !ids.includes(c.id));
        s.selectedClipIds = s.selectedClipIds.filter((id) => !ids.includes(id));
      }),

    rippleDeleteClips: (ids) =>
      set((s) => {
        const removed = s.doc.clips.filter((c) => ids.includes(c.id));
        const tracks = Array.from(new Set(removed.map((c) => c.trackId)));
        for (const trackId of tracks) {
          const rem = removed.filter((c) => c.trackId === trackId).sort((a, b) => b.timelineStart - a.timelineStart);
          for (const r of rem) {
            for (const c of s.doc.clips) {
              if (c.trackId === trackId && !ids.includes(c.id) && c.timelineStart > r.timelineStart) {
                c.timelineStart = Math.max(0, c.timelineStart - r.duration);
              }
            }
          }
        }
        s.doc.clips = s.doc.clips.filter((c) => !ids.includes(c.id));
        s.selectedClipIds = s.selectedClipIds.filter((id) => !ids.includes(id));
      }),
  }))
);
