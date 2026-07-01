import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createEmptyProDocument, type ProClip, type ProDocument, type ProTool } from '../pro/proTypes';

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
  setLeftWidth: (w: number) => void;
  setTimelineHeight: (h: number) => void;
  resetDocument: () => void;

  // Документ.
  addClip: (clip: Omit<ProClip, 'id'>) => string;
  toggleTrackFlag: (trackId: string, flag: 'muted' | 'solo' | 'locked' | 'hidden') => void;
}

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
  }))
);
