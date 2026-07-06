import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createEmptyProDocument,
  DEFAULT_AUDIO,
  DEFAULT_COLOR,
  DEFAULT_CROP,
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
  findPrevAdjacent,
  transformAt,
  type AdjustFilter,
  type Kf,
  type KfEase,
  type KfParam,
  type Keyframes,
  type ClipCrop,
  type ClipTransform,
  type Mood,
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

let adjSeq = 0;
function nextAdjTrackId(): string {
  adjSeq += 1;
  return `ADJ${adjSeq}`;
}

// История (§6 ТЗ): стек снапшотов doc. Immer не мутирует старые doc — храним ссылки.
const HISTORY_LIMIT = 60;
const past: ProDocument[] = [];
const future: ProDocument[] = [];

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
  clipboard: ProClip[]; // буфер копирования клипов
  viewerMode: ViewerMode; // режим оверлея во Viewer (Transform/Crop)
  autoCutMood: Mood; // настроение авто-нарезки (§5 ТЗ)
  exportIn: number | null; // область экспорта (§7): in/out маркеры (сек)
  exportOut: number | null;

  // Раскладка панелей (resizable, Фаза 1).
  leftWidth: number;
  timelineHeight: number;
  rightWidth: number;
  rightOpen: boolean;
  setRightWidth: (w: number) => void;
  toggleRight: () => void;
  trackScale: number; // множитель высоты дорожек на таймлайне
  setTrackScale: (v: number) => void;

  // Текущий проект (§6 ТЗ).
  projectId: string | null;
  projectName: string;
  setProject: (id: string, name: string) => void;

  // Proxy для превью (§7 ТЗ).
  useProxy: boolean;
  proxyMap: Record<string, string>;
  setUseProxy: (v: boolean) => void;
  setProxy: (src: string, proxyPath: string) => void;

  // Действия.
  setPlayhead: (t: number) => void;
  setZoom: (pxPerSec: number) => void;
  setScrollX: (x: number) => void;
  setPlaying: (v: boolean) => void;
  setTool: (tool: ProTool) => void;
  toggleSnapping: () => void;
  setSelection: (ids: string[]) => void;
  setViewerMode: (mode: ViewerMode) => void;
  setResolution: (width: number, height: number) => void;
  updateClipTransform: (id: string, patch: Partial<ClipTransform>) => void;
  addKeyframe: (id: string, param: KfParam) => void;
  removeKeyframe: (id: string, param: KfParam, t: number) => void;
  setKeyframeEase: (id: string, param: KfParam, t: number, ease: KfEase) => void;
  clearKeyframes: (id: string) => void;
  updateClipCrop: (id: string, patch: Partial<ClipCrop>) => void;
  setLeftWidth: (w: number) => void;
  setTimelineHeight: (h: number) => void;
  resetDocument: () => void;

  // Документ.
  addClip: (clip: Omit<ProClip, 'id'>) => string;
  addTrack: (kind: 'video' | 'audio') => string;
  addLinkedAudio: (sourceFile: string, at: number, duration: number, sourceDuration?: number, linkId?: string) => void;
  unlinkClip: (id: string) => void;
  removeTrack: (trackId: string) => void;
  toggleTrackFlag: (trackId: string, flag: 'muted' | 'solo' | 'locked' | 'hidden') => void;
  moveClip: (id: string, trackId: string, timelineStart: number) => void;
  rippleInsert: (id: string, trackId: string, atTime: number) => void;
  moveClipsBy: (ids: string[], dt: number) => void;
  setClipTrim: (id: string, patch: { timelineStart: number; inPoint: number; duration: number }) => void;
  splitClipAt: (id: string, atTime: number) => void;
  mergeWithNext: (id: string) => void;
  removeClips: (ids: string[]) => void;
  rippleDeleteClips: (ids: string[]) => void;
  copyClips: (ids: string[]) => void;
  pasteClips: (atTime: number) => void;
  duplicateClips: (ids: string[]) => void;
  selectAll: () => void;
  toggleClipLock: (id: string) => void;
  setClipSpeed: (id: string, speed: number) => void;
  setClipTransition: (id: string, duration: number | null) => void;
  setTransitionKind: (id: string, kind: import('../pro/proTypes').TransitionKind) => void;
  setTransitionAlign: (id: string, align: import('../pro/proTypes').TransitionAlign) => void;
  setClipTailFade: (id: string, dur: number | null) => void;
  setAutoCutMood: (mood: Mood) => void;
  setExportIn: (t: number | null) => void;
  setExportOut: (t: number | null) => void;
  // Заменить авто-клипы на дорожке, сохранив закреплённые (Locked, §5 ТЗ).
  autoCutReplace: (trackId: string, generated: Omit<ProClip, 'id'>[]) => void;
  // Дорожка корректирующих слоёв (§5 ТЗ).
  addAdjustmentTrack: () => string;
  addAdjustmentClip: (trackId: string, start: number, duration: number, filter: AdjustFilter) => void;
  updateClipAdjust: (id: string, patch: Partial<{ filter: AdjustFilter; intensity: number }>) => void;
  updateClipAudio: (id: string, patch: Partial<import('../pro/proTypes').ClipAudio>) => void;
  updateClipColor: (id: string, patch: Partial<import('../pro/proTypes').ClipColor>) => void;
  setClipBlend: (id: string, blend: import('../pro/proTypes').BlendMode) => void;
  addTextClip: (trackId: string, start: number, duration: number) => void;
  addSubtitles: (trackId: string, lines: { start: number; duration: number; content: string }[]) => void;
  updateClipText: (id: string, patch: Partial<import('../pro/proTypes').ClipText>) => void;
  // История (§6 ТЗ). pushHistory вызывается в начале дискретного действия/жеста.
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  // Загрузка сохранённого документа (автосейв, §6 ТЗ).
  loadDocument: (doc: ProDocument) => void;
}

const MIN_DUR = 0.05; // минимальная длина клипа (сек)

// Глубокая копия дорожек ключей (иначе split/copy/duplicate делят один объект по ссылке).
function cloneKeyframes(kf?: Keyframes): Keyframes | undefined {
  if (!kf || Array.isArray(kf)) return undefined;
  const out: Keyframes = {};
  for (const p of ['x', 'y', 'scale', 'rotation'] as KfParam[]) if (kf[p]?.length) out[p] = kf[p]!.map((k) => ({ ...k }));
  return Object.keys(out).length ? out : undefined;
}

// Глубокая копия клипа (вложенные объекты — новыми ссылками).
function cloneClip(c: ProClip): ProClip {
  return {
    ...c,
    transform: c.transform ? { ...c.transform } : undefined,
    crop: c.crop ? { ...c.crop } : undefined,
    audio: c.audio ? { ...c.audio } : undefined,
    color: c.color ? { ...c.color } : undefined,
    text: c.text ? { ...c.text } : undefined,
    adjust: c.adjust ? { ...c.adjust } : undefined,
    transition: c.transition ? { ...c.transition } : undefined,
    effects: c.effects ? c.effects.map((e) => ({ ...e })) : undefined,
    keyframes: cloneKeyframes(c.keyframes),
  };
}

function upsertKf(arr: Kf[], t: number, v: number) {
  const i = arr.findIndex((k) => Math.abs(k.t - t) < 0.03);
  if (i >= 0) arr[i] = { t, v };
  else {
    arr.push({ t, v });
    arr.sort((a, b) => a.t - b.t);
  }
}

export const useProStore = create<ProState>()(
  immer((set, get) => ({
    doc: createEmptyProDocument(),

    playhead: 0,
    pxPerSec: 60,
    scrollX: 0,
    isPlaying: false,

    activeTool: 'select',
    snapping: true,
    selectedClipIds: [],
    clipboard: [],
    viewerMode: 'none',
    autoCutMood: 'natural',
    exportIn: null,
    exportOut: null,

    leftWidth: 300,
    timelineHeight: 300,
    rightWidth: 240,
    rightOpen: true,
    setRightWidth: (w) =>
      set((s) => {
        s.rightWidth = Math.min(480, Math.max(160, w));
      }),
    toggleRight: () =>
      set((s) => {
        s.rightOpen = !s.rightOpen;
      }),
    trackScale: 1,
    setTrackScale: (v) =>
      set((s) => {
        s.trackScale = Math.min(2.5, Math.max(0.6, v));
      }),

    projectId: null,
    projectName: 'Проект',
    setProject: (id, name) =>
      set((s) => {
        s.projectId = id;
        s.projectName = name;
      }),

    useProxy: false,
    proxyMap: {},
    setUseProxy: (v) =>
      set((s) => {
        s.useProxy = v;
      }),
    setProxy: (src, proxyPath) =>
      set((s) => {
        s.proxyMap[src] = proxyPath;
      }),

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
    setResolution: (width, height) =>
      set((s) => {
        s.doc.width = Math.max(16, Math.round(width));
        s.doc.height = Math.max(16, Math.round(height));
      }),
    updateClipTransform: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        const localSec = Math.max(0, s.playhead - c.timelineStart);
        const params: KfParam[] = ['x', 'y', 'scale', 'rotation'];
        for (const p of params) {
          const val = patch[p];
          if (val === undefined) continue;
          const track = c.keyframes?.[p];
          if (track && track.length) upsertKf(track, localSec, val); // в режиме ключей — обновить ключ
          else c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, [p]: val };
        }
      }),
    addKeyframe: (id, param) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        const localSec = Math.max(0, s.playhead - c.timelineStart);
        const cur = transformAt(c, localSec);
        // Старый формат ключей (массив) — сбрасываем в объект по параметрам.
        if (!c.keyframes || Array.isArray(c.keyframes)) c.keyframes = {};
        if (!c.keyframes[param]) c.keyframes[param] = [];
        upsertKf(c.keyframes[param]!, localSec, cur[param]);
      }),
    removeKeyframe: (id, param, t) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        const track = c?.keyframes?.[param];
        if (!track) return;
        const idx = track.findIndex((k) => Math.abs(k.t - t) < 0.03);
        if (idx >= 0) track.splice(idx, 1);
        if (!track.length && c!.keyframes) delete c!.keyframes[param];
      }),
    setKeyframeEase: (id, param, t, ease) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        const k = c?.keyframes?.[param]?.find((x) => Math.abs(x.t - t) < 0.03);
        if (k) k.ease = ease;
      }),
    clearKeyframes: (id) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (c) delete c.keyframes;
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
    addTrack: (kind) => {
      const id = `${kind === 'video' ? 'V' : 'A'}${nextClipId()}`;
      set((s) => {
        const num = s.doc.tracks.filter((t) => t.kind === kind && !t.isAdjustment).length + 1;
        const track = {
          id,
          kind,
          name: `${kind === 'video' ? 'V' : 'A'}${num}`,
          height: kind === 'video' ? 64 : 56,
          muted: false,
          solo: false,
          locked: false,
          hidden: false,
        };
        if (kind === 'video') {
          // Новая видео-дорожка — сверху видео-стека (под Adjustment-дорожками).
          const idx = s.doc.tracks.findIndex((t) => !(t.kind === 'video' && t.isAdjustment));
          s.doc.tracks.splice(idx === -1 ? s.doc.tracks.length : idx, 0, track);
        } else {
          s.doc.tracks.push(track);
        }
      });
      return id;
    },
    addLinkedAudio: (sourceFile, at, duration, sourceDuration, linkId) =>
      set((s) => {
        const a0 = Math.max(0, at);
        const overlaps = (tid: string) => s.doc.clips.some((c) => c.trackId === tid && a0 < c.timelineStart + c.duration - 0.01 && a0 + duration > c.timelineStart + 0.01);
        let tid = s.doc.tracks.find((t) => t.kind === 'audio' && !overlaps(t.id))?.id;
        if (!tid) {
          const num = s.doc.tracks.filter((t) => t.kind === 'audio').length + 1;
          tid = `A${nextClipId()}`;
          s.doc.tracks.push({ id: tid, kind: 'audio', name: `A${num}`, height: 56, muted: false, solo: false, locked: false, hidden: false });
        }
        s.doc.clips.push({ id: nextClipId(), trackId: tid, sourceFile, timelineStart: a0, duration, inPoint: 0, sourceDuration, linkId });
      }),
    unlinkClip: (id) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c || !c.linkId) return;
        const lk = c.linkId;
        for (const cl of s.doc.clips) if (cl.linkId === lk) delete cl.linkId;
      }),

    removeTrack: (trackId) =>
      set((s) => {
        s.doc.tracks = s.doc.tracks.filter((t) => t.id !== trackId);
        s.doc.clips = s.doc.clips.filter((c) => c.trackId !== trackId);
        s.selectedClipIds = [];
      }),
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

    rippleInsert: (id, trackId, atTime) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        const target = s.doc.tracks.find((t) => t.id === trackId);
        const cur = s.doc.tracks.find((t) => t.id === c.trackId);
        const at = Math.max(0, atTime);
        // Раздвигаем клипы на целевой дорожке, начинающиеся на/после точки вставки.
        for (const o of s.doc.clips) {
          if (o.id !== id && o.trackId === trackId && o.timelineStart >= at - 1e-4) o.timelineStart += c.duration;
        }
        if (target && cur && target.kind === cur.kind && !target.locked) c.trackId = trackId;
        c.timelineStart = at;
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
        let inPoint = Math.max(0, patch.inPoint);
        let duration = Math.max(MIN_DUR, patch.duration);
        // Не выходим за длину источника.
        if (c.sourceDuration != null) {
          inPoint = Math.min(inPoint, Math.max(0, c.sourceDuration - MIN_DUR));
          duration = Math.min(duration, c.sourceDuration - inPoint);
        }
        c.inPoint = inPoint;
        c.duration = Math.max(MIN_DUR, duration);
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
        // Ключи: правой половине — со сдвигом времени на -offset; левой — только до реза.
        const kf = Array.isArray(c.keyframes) ? undefined : c.keyframes;
        const splitKf = (side: 'l' | 'r'): Keyframes | undefined => {
          if (!kf) return undefined;
          const out: Keyframes = {};
          for (const p of ['x', 'y', 'scale', 'rotation'] as KfParam[]) {
            const arr = kf[p];
            if (!arr?.length) continue;
            const part = side === 'l' ? arr.filter((k) => k.t <= offset + 1e-4).map((k) => ({ ...k })) : arr.filter((k) => k.t >= offset - 1e-4).map((k) => ({ ...k, t: k.t - offset }));
            if (part.length) out[p] = part;
          }
          return Object.keys(out).length ? out : undefined;
        };
        const right: ProClip = {
          ...cloneClip(c),
          id: rightId,
          timelineStart: atTime,
          inPoint: c.inPoint + offset,
          duration: c.duration - offset,
          effects: rightEffects.length ? rightEffects : undefined,
          transition: undefined, // переход относится к стыку левой половины
          keyframes: splitKf('r'),
        };
        c.duration = offset;
        c.effects = leftEffects.length ? leftEffects : undefined;
        c.keyframes = splitKf('l');
        s.doc.clips.push(right);
      }),

    mergeWithNext: (id) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        // Соседний справа клип того же источника, вплотную.
        const next = s.doc.clips
          .filter((o) => o.trackId === c.trackId && o.id !== id && o.sourceFile === c.sourceFile && Math.abs(o.timelineStart - (c.timelineStart + c.duration)) < 0.05)
          .sort((a, b) => a.timelineStart - b.timelineStart)[0];
        if (!next) return;
        c.duration += next.duration;
        s.doc.clips = s.doc.clips.filter((o) => o.id !== next.id);
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

    copyClips: (ids) =>
      set((s) => {
        s.clipboard = s.doc.clips.filter((c) => ids.includes(c.id)).map((c) => cloneClip(c));
      }),
    pasteClips: (atTime) =>
      set((s) => {
        if (!s.clipboard.length) return;
        const minStart = Math.min(...s.clipboard.map((c) => c.timelineStart));
        const newIds: string[] = [];
        for (const c of s.clipboard) {
          if (!s.doc.tracks.some((t) => t.id === c.trackId)) continue; // дорожки нет — пропускаем
          const id = nextClipId();
          s.doc.clips.push({ ...cloneClip(c), id, locked: false, timelineStart: Math.max(0, atTime + (c.timelineStart - minStart)) });
          newIds.push(id);
        }
        s.selectedClipIds = newIds;
      }),
    duplicateClips: (ids) =>
      set((s) => {
        const sel = s.doc.clips.filter((c) => ids.includes(c.id));
        if (!sel.length) return;
        const minStart = Math.min(...sel.map((c) => c.timelineStart));
        const maxEnd = Math.max(...sel.map((c) => c.timelineStart + c.duration));
        const offset = maxEnd - minStart;
        const newIds: string[] = [];
        for (const c of sel) {
          const id = nextClipId();
          s.doc.clips.push({ ...cloneClip(c), id, locked: false, timelineStart: c.timelineStart + offset });
          newIds.push(id);
        }
        s.selectedClipIds = newIds;
      }),
    selectAll: () =>
      set((s) => {
        s.selectedClipIds = s.doc.clips.map((c) => c.id);
      }),
    toggleClipLock: (id) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (c) c.locked = !c.locked;
      }),
    setClipSpeed: (id, speed) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (c) c.speed = Math.min(8, Math.max(0.1, speed));
      }),
    setClipTransition: (id, duration) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        if (duration === null || duration <= 0) {
          delete c.transition;
          return;
        }
        const prev = findPrevAdjacent(s.doc.clips, c);
        // Есть смежный слева -> кроссфейд (центр, нахлёст). Нет -> появление (fade in, внутри клипа).
        const max = Math.min(c.duration, prev ? prev.duration : c.duration, 5);
        c.transition = { duration: Math.min(Math.max(0.1, duration), max), kind: c.transition?.kind ?? 'dissolve', align: c.transition?.align ?? (prev ? 'center' : 'left') };
      }),
    setTransitionAlign: (id, align) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (c?.transition) c.transition.align = align;
      }),
    setClipTailFade: (id, dur) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        if (dur === null || dur <= 0) delete c.tailFade;
        else c.tailFade = Math.min(Math.max(0.1, dur), Math.min(c.duration, 5));
      }),
    setTransitionKind: (id, kind) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (c && c.transition) c.transition.kind = kind;
      }),
    setAutoCutMood: (mood) =>
      set((s) => {
        s.autoCutMood = mood;
      }),
    setExportIn: (t) =>
      set((s) => {
        s.exportIn = t === null ? null : Math.max(0, t);
        if (s.exportIn !== null && s.exportOut !== null && s.exportOut <= s.exportIn) s.exportOut = null;
      }),
    setExportOut: (t) =>
      set((s) => {
        s.exportOut = t === null ? null : Math.max(0, t);
        if (s.exportIn !== null && s.exportOut !== null && s.exportOut <= s.exportIn) s.exportIn = null;
      }),
    autoCutReplace: (trackId, generated) =>
      set((s) => {
        // Убираем прежние авто-клипы дорожки, но НЕ трогаем закреплённые.
        s.doc.clips = s.doc.clips.filter((c) => c.trackId !== trackId || c.locked);
        for (const g of generated) s.doc.clips.push({ ...g, id: nextClipId() });
      }),

    addAdjustmentTrack: () => {
      const id = nextAdjTrackId();
      set((s) => {
        // Корр. слой располагается над видео-дорожками (§5 ТЗ) — в начало списка.
        s.doc.tracks.unshift({ id, kind: 'video', name: 'Adj', height: 40, muted: false, solo: false, locked: false, hidden: false, isAdjustment: true });
      });
      return id;
    },
    addAdjustmentClip: (trackId, start, duration, filter) =>
      set((s) => {
        s.doc.clips.push({
          id: nextClipId(),
          trackId,
          sourceFile: '',
          timelineStart: Math.max(0, start),
          duration: Math.max(0.1, duration),
          inPoint: 0,
          adjust: { filter, intensity: 1 },
        });
      }),
    updateClipAdjust: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c || !c.adjust) return;
        c.adjust = { ...c.adjust, ...patch };
      }),
    updateClipAudio: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        c.audio = { ...DEFAULT_AUDIO, ...c.audio, ...patch };
      }),
    updateClipColor: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        c.color = { ...DEFAULT_COLOR, ...c.color, ...patch };
      }),
    setClipBlend: (id, blend) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (c) c.blend = blend;
      }),
    addTextClip: (trackId, start, duration) =>
      set((s) => {
        s.doc.clips.push({ id: nextClipId(), trackId, sourceFile: '', timelineStart: Math.max(0, start), duration: Math.max(0.2, duration), inPoint: 0, text: { ...DEFAULT_TEXT } });
      }),
    updateClipText: (id, patch) =>
      set((s) => {
        const c = s.doc.clips.find((cl) => cl.id === id);
        if (!c) return;
        c.text = { ...DEFAULT_TEXT, ...c.text, ...patch };
      }),
    addSubtitles: (trackId, lines) =>
      set((s) => {
        // Стиль субтитров: снизу, крупно, с обводкой для читаемости.
        const style = { ...DEFAULT_TEXT, size: 6, y: 0.88, bold: true, outline: 0.6, outlineColor: '#000000', shadow: false, bg: false };
        for (const ln of lines) {
          s.doc.clips.push({ id: nextClipId(), trackId, sourceFile: '', timelineStart: Math.max(0, ln.start), duration: Math.max(0.3, ln.duration), inPoint: 0, text: { ...style, content: ln.content } });
        }
      }),

    pushHistory: () => {
      past.push(get().doc);
      if (past.length > HISTORY_LIMIT) past.shift();
      future.length = 0;
    },
    undo: () => {
      if (!past.length) return;
      future.push(get().doc);
      const prev = past.pop()!;
      set((s) => {
        s.doc = prev;
        s.selectedClipIds = [];
      });
    },
    redo: () => {
      if (!future.length) return;
      past.push(get().doc);
      const next = future.pop()!;
      set((s) => {
        s.doc = next;
        s.selectedClipIds = [];
      });
    },
    loadDocument: (doc) => {
      past.length = 0;
      future.length = 0;
      // Восстанавливаем счётчики id, иначе новые клипы/дорожки коллизируют с загруженными.
      for (const c of doc.clips ?? []) {
        const m = /^c(\d+)_/.exec(c.id);
        if (m) clipSeq = Math.max(clipSeq, Number(m[1]));
      }
      for (const t of doc.tracks ?? []) {
        const m = /^ADJ(\d+)$/.exec(t.id);
        if (m) adjSeq = Math.max(adjSeq, Number(m[1]));
      }
      // Миграция: старый формат ключей (массив снимков) несовместим — убираем.
      for (const c of doc.clips ?? []) {
        if (Array.isArray(c.keyframes)) delete c.keyframes;
      }
      set((s) => {
        s.doc = {
          fps: doc.fps || 30,
          width: doc.width || 1920,
          height: doc.height || 1080,
          tracks: doc.tracks ?? [],
          clips: doc.clips ?? [],
        };
        s.selectedClipIds = [];
        s.playhead = 0;
      });
    },
  }))
);
