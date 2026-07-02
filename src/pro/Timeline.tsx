import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProStore } from '../store/proStore';
import { isAudioFile, isVideoFile, mediaUrl } from '../utils/media';
import { ADJUST_LABEL, type ProTrack } from './proTypes';

// Ядро таймлайна Pulsar Pro (§3 ТЗ): дорожки, линейка HH:MM:SS:FF, playhead,
// скраббинг, zoom/pan, клипы с миниатюрами/вейвформами, виртуализация.

const HEADER_W = 132; // ширина колонки заголовков дорожек
const RULER_H = 30;
const THUMB_W = 90;

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}
const MenuCtx = createContext<(x: number, y: number, items: MenuItem[]) => void>(() => {});

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// Таймкод HH:MM:SS:FF (кадры).
function formatTimecode(t: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(t * fps));
  const frames = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(frames)}`;
}

// Динамический шаг делений линейки: ~90px между major-тиками.
function chooseTickStep(pxPerSec: number, fps: number): number {
  const frame = 1 / fps;
  const cand = [frame, frame * 2, frame * 5, frame * 10, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const step of cand) {
    if (step * pxPerSec >= 90) return step;
  }
  return cand[cand.length - 1];
}

// Зум относительно плейхеда (§3.2 ТЗ): экранная позиция плейхеда неизменна.
export function zoomAtPlayhead(nextPx: number) {
  const st = useProStore.getState();
  const clamped = clamp(nextPx, 4, 400);
  const playheadX = st.playhead * st.pxPerSec - st.scrollX;
  st.setZoom(clamped);
  st.setScrollX(st.playhead * clamped - playheadX);
}

// Метаданные медиа (длительность + размеры) через скрытый элемент (media://).
function probeMeta(path: string, kind: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement;
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve({ duration: el.duration || 0, width: el.videoWidth || 0, height: el.videoHeight || 0 });
    el.onerror = () => resolve({ duration: 0, width: 0, height: 0 });
    el.src = mediaUrl(path);
  });
}

export default function Timeline() {
  const doc = useProStore((s) => s.doc);
  const pxPerSec = useProStore((s) => s.pxPerSec);
  const scrollX = useProStore((s) => s.scrollX);
  const playhead = useProStore((s) => s.playhead);
  const setScrollX = useProStore((s) => s.setScrollX);
  const setPlayhead = useProStore((s) => s.setPlayhead);
  const activeTool = useProStore((s) => s.activeTool);
  const exportIn = useProStore((s) => s.exportIn);
  const exportOut = useProStore((s) => s.exportOut);

  const rightRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [scrollY, setScrollY] = useState(0);

  // Раскладка дорожек по вертикали.
  const laneOffsets: { track: ProTrack; y: number }[] = [];
  let cy = 0;
  for (const track of doc.tracks) {
    laneOffsets.push({ track, y: cy });
    cy += track.height;
  }
  const tracksTotalH = cy;
  const tracksViewH = Math.max(0, vp.h - RULER_H);
  const maxScrollY = Math.max(0, tracksTotalH - tracksViewH);
  const clampedScrollY = clamp(scrollY, 0, maxScrollY);

  // Измерение вьюпорта.
  useEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Колесо: Alt → зум относительно плейхеда; иначе пан (X — deltaX, Y — deltaY).
  useEffect(() => {
    const el = rightRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.altKey) {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAtPlayhead(useProStore.getState().pxPerSec * factor);
      } else {
        const st = useProStore.getState();
        if (e.deltaX) st.setScrollX(st.scrollX + e.deltaX);
        setScrollY((y) => y + e.deltaY);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Скраббинг по линейке / клик = переход плейхеда (§3.2 ТЗ).
  const scrubbing = useRef(false);
  const timeAtClientX = useCallback(
    (clientX: number) => {
      const el = rightRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return (clientX - rect.left + useProStore.getState().scrollX) / useProStore.getState().pxPerSec;
    },
    []
  );

  // Прилипание (§3.3 ТЗ): к краям других клипов, плейхеду и нулю. Отключается N.
  const snapTime = (t: number, exclude: Set<string>): number => {
    const st = useProStore.getState();
    if (!st.snapping) return t;
    const thresh = 8 / st.pxPerSec;
    const points = [0, st.playhead];
    for (const c of st.doc.clips) {
      if (exclude.has(c.id)) continue;
      points.push(c.timelineStart, c.timelineStart + c.duration);
    }
    let best = t;
    let bd = thresh;
    for (const p of points) {
      const d = Math.abs(p - t);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  // Магнит плейхеда к краям клипов и нулю (при включённом snap).
  const snapPlayheadTime = (t: number): number => {
    const st = useProStore.getState();
    if (!st.snapping) return t;
    const thresh = 8 / st.pxPerSec;
    let best = t;
    let bd = thresh;
    const points = [0];
    for (const c of st.doc.clips) points.push(c.timelineStart, c.timelineStart + c.duration);
    for (const p of points) {
      const d = Math.abs(p - t);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  // Дорожка под курсором (для перемещения между дорожками).
  const trackAtClientY = (clientY: number): string | null => {
    const el = rightRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const yInTracks = clientY - rect.top - RULER_H + clampedScrollY;
    for (const { track, y } of laneOffsets) {
      if (yInTracks >= y && yInTracks < y + track.height) return track.id;
    }
    return null;
  };

  // Позиция реза под курсором (для инструмента Blade).
  const [bladeX, setBladeX] = useState<number | null>(null);

  // Контекстное меню (ПКМ).
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenu = useCallback((x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), []);

  // Marquee-выделение (лассо, §3.3 ТЗ) — координаты относительно зоны дорожек.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const onMarqueeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // клики по клипам гасят всплытие (stopPropagation)
    e.preventDefault();
    const el = rightRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top - RULER_H };
    setMarquee({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    const move = (ev: PointerEvent) => setMarquee({ x0: start.x, y0: start.y, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top - RULER_H });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const x1 = ev.clientX - rect.left;
      const y1 = ev.clientY - rect.top - RULER_H;
      finalizeMarquee(start.x, start.y, x1, y1);
      setMarquee(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const finalizeMarquee = (x0: number, y0: number, x1: number, y1: number) => {
    const st = useProStore.getState();
    if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
      st.setSelection([]); // клик по пустому — снять выделение
      return;
    }
    const t0 = (Math.min(x0, x1) + st.scrollX) / st.pxPerSec;
    const t1 = (Math.max(x0, x1) + st.scrollX) / st.pxPerSec;
    const cy0 = Math.min(y0, y1) + clampedScrollY;
    const cy1 = Math.max(y0, y1) + clampedScrollY;
    const hitTracks = laneOffsets.filter(({ track, y }) => !(y + track.height < cy0 || y > cy1)).map((l) => l.track.id);
    const ids = st.doc.clips
      .filter((c) => hitTracks.includes(c.trackId) && !(c.timelineStart + c.duration < t0 || c.timelineStart > t1))
      .map((c) => c.id);
    st.setSelection(ids);
  };
  const onRulerDown = (e: React.PointerEvent) => {
    scrubbing.current = true;
    setPlayhead(snapPlayheadTime(timeAtClientX(e.clientX)));
    const move = (ev: PointerEvent) => scrubbing.current && setPlayhead(snapPlayheadTime(timeAtClientX(ev.clientX)));
    const up = () => {
      scrubbing.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Пан средней кнопкой мыши (§3.2 ТЗ).
  const onAreaPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      const st = useProStore.getState();
      st.setScrollX(st.scrollX - (ev.clientX - last.x));
      setScrollY((y) => y - (ev.clientY - last.y));
      last = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Приём файла, перетащенного из Media, на таймлайн.
  const onDrop = async (e: React.DragEvent) => {
    const path = e.dataTransfer.getData('application/x-pulsar-path');
    if (!path) return;
    e.preventDefault();
    const st = useProStore.getState();
    const kind = isVideoFile(path) ? 'video' : isAudioFile(path) ? 'audio' : null;
    if (!kind) return;
    // Дорожка под курсором; если её нет/не тот тип (напр. перенос выше всех) — создаём новую.
    let trackId = trackAtClientY(e.clientY) ?? '';
    const track = st.doc.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== kind || track.isAdjustment) trackId = st.addTrack(kind);
    const at = Math.max(0, snapTime(timeAtClientX(e.clientX), new Set()));
    const meta = await probeMeta(path, kind);
    const dur = meta.duration || 3;
    st.pushHistory();
    const linkId = kind === 'video' ? 'lk' + Math.random().toString(36).slice(2, 8) : undefined;
    st.addClip({ trackId, sourceFile: path, timelineStart: at, duration: dur, inPoint: 0, sourceDuration: dur, sourceW: kind === 'video' ? meta.width || undefined : undefined, sourceH: kind === 'video' ? meta.height || undefined : undefined, linkId });
    if (kind === 'video') useProStore.getState().addLinkedAudio(path, at, dur, dur, linkId);
  };

  const playheadX = playhead * pxPerSec - scrollX;
  const contentEnd = doc.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);

  const onEmptyContext = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    const st = useProStore.getState();
    const t = timeAtClientX(e.clientX);
    openMenu(e.clientX, e.clientY, [
      { label: '＋ Видео-дорожка', onClick: () => { st.pushHistory(); st.addTrack('video'); } },
      { label: '＋ Аудио-дорожка', onClick: () => { st.pushHistory(); st.addTrack('audio'); } },
      { label: 'Вставить в плейхед', onClick: () => { st.pushHistory(); st.pasteClips(t); } },
    ]);
  };

  return (
    <MenuCtx.Provider value={openMenu}>
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-secondary)', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <ZoomBar contentEnd={contentEnd} />
      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
        <ToolColumn />
        {/* Колонка заголовков дорожек. */}
        <div style={{ width: HEADER_W, flex: '0 0 auto', borderRight: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
          <div style={{ height: RULER_H, borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
            <button onClick={() => { useProStore.getState().pushHistory(); useProStore.getState().addTrack('video'); }} title="Добавить видео-дорожку" style={addTrackBtn}>＋V</button>
            <button onClick={() => { useProStore.getState().pushHistory(); useProStore.getState().addTrack('audio'); }} title="Добавить аудио-дорожку" style={addTrackBtn}>＋A</button>
          </div>
          <div style={{ transform: `translateY(${-clampedScrollY}px)` }}>
            {laneOffsets.map(({ track }) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>
        </div>

        {/* Правая зона: линейка + клипы + playhead. */}
        <div
          ref={rightRef}
          onPointerDown={onAreaPointerDown}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-pulsar-path')) e.preventDefault(); }}
          onDrop={onDrop}
          style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: 'var(--bg-primary)' }}
        >
          {/* Линейка времени. */}
          <div
            onPointerDown={onRulerDown}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: RULER_H, borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)', cursor: 'text', zIndex: 3 }}
          >
            <Ruler vpW={vp.w} pxPerSec={pxPerSec} scrollX={scrollX} fps={doc.fps} />
          </div>

          {/* Дорожки с клипами. */}
          <div
            onPointerDown={onMarqueeDown}
            onContextMenu={onEmptyContext}
            onPointerMove={(e) => {
              if (activeTool !== 'blade') { if (bladeX !== null) setBladeX(null); return; }
              const r = rightRef.current;
              if (r) setBladeX(e.clientX - r.getBoundingClientRect().left);
            }}
            onPointerLeave={() => setBladeX(null)}
            style={{ position: 'absolute', top: RULER_H, left: 0, right: 0, bottom: 0, overflow: 'hidden', cursor: activeTool === 'blade' ? 'crosshair' : 'default' }}
          >
            <div style={{ transform: `translateY(${-clampedScrollY}px)`, position: 'relative' }}>
              {laneOffsets.map(({ track, y }) => (
                <Lane
                  key={track.id}
                  track={track}
                  y={y}
                  vpW={vp.w}
                  pxPerSec={pxPerSec}
                  scrollX={scrollX}
                  timeAt={timeAtClientX}
                  snap={snapTime}
                  trackAt={trackAtClientY}
                />
              ))}
            </div>
            {marquee && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                  border: '1px solid var(--accent-green)',
                  background: 'rgba(204,255,0,0.12)',
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            )}
            {!doc.clips.length && (
              <div className="flex h-full w-full items-center justify-center" style={{ position: 'absolute', inset: 0, color: 'var(--text-secondary)', fontSize: 13, pointerEvents: 'none' }}>
                Импортируйте медиа кнопкой ＋ у дорожки
              </div>
            )}
          </div>

          {/* Область экспорта (in/out, §7 ТЗ). */}
          {(exportIn != null || exportOut != null) && (() => {
            const a = (exportIn ?? 0) * pxPerSec - scrollX;
            const b = (exportOut ?? contentEnd) * pxPerSec - scrollX;
            const l = Math.max(0, Math.min(a, b));
            const r = Math.min(vp.w, Math.max(a, b));
            if (r <= 0 || l >= vp.w) return null;
            return (
              <>
                <div style={{ position: 'absolute', top: RULER_H, bottom: 0, left: l, width: r - l, background: 'rgba(204,255,0,0.08)', borderLeft: '1px solid var(--accent-green)', borderRight: '1px solid var(--accent-green)', zIndex: 3, pointerEvents: 'none' }} />
              </>
            );
          })()}

          {/* Playhead (§3.2 ТЗ). */}
          {playheadX >= 0 && playheadX <= vp.w && (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: playheadX, width: 0, borderLeft: '1px solid var(--accent-green)', zIndex: 4, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 0, left: -5, width: 10, height: 10, background: 'var(--accent-green)', clipPath: 'polygon(0 0,100% 0,50% 100%)' }} />
            </div>
          )}

          {/* Линия реза под курсором (инструмент Blade). */}
          {activeTool === 'blade' && bladeX !== null && bladeX >= 0 && bladeX <= vp.w && (
            <div style={{ position: 'absolute', top: RULER_H, bottom: 0, left: bladeX, width: 0, borderLeft: '1px dashed #ff5b5b', zIndex: 6, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 1, left: -7, fontSize: 12 }}>🔪</div>
            </div>
          )}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
    </MenuCtx.Provider>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  // Прижимаем меню к экрану, чтобы пункты не уходили под низ/правый край.
  const estH = items.length * 32 + 8;
  const estW = 210;
  const top = Math.max(8, Math.min(y, window.innerHeight - estH - 8));
  const left = Math.max(8, Math.min(x, window.innerWidth - estW - 8));
  return (
    <>
      <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
      <div style={{ position: 'fixed', top, left, minWidth: 190, maxWidth: estW, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 4, zIndex: 2001, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', maxHeight: '90vh', overflow: 'auto' }}>
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => { it.onClick(); onClose(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: 12.5, borderRadius: 6, border: 'none', background: 'transparent', color: it.danger ? 'var(--danger, #ff6b6b)' : 'var(--text-primary)', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

// ─── Колонка инструментов (§2 ТЗ) ───────────────────────────────────────────

function ToolColumn() {
  const activeTool = useProStore((s) => s.activeTool);
  const setTool = useProStore((s) => s.setTool);
  const snapping = useProStore((s) => s.snapping);
  const toggleSnapping = useProStore((s) => s.toggleSnapping);
  const I = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const cell = (active: boolean): React.CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
    background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
  });
  const splitAtPlayhead = () => {
    const st = useProStore.getState();
    const ph = st.playhead;
    const targets = st.selectedClipIds.length ? st.doc.clips.filter((c) => st.selectedClipIds.includes(c.id)) : st.doc.clips.slice();
    st.pushHistory();
    for (const c of targets) if (ph > c.timelineStart && ph < c.timelineStart + c.duration) st.splitClipAt(c.id, ph);
  };
  const fitZoom = () => {
    const st = useProStore.getState();
    const end = st.doc.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0) || 10;
    st.setScrollX(0);
    st.setZoom(Math.max(4, 900 / end));
  };
  const div = <div style={{ width: 22, height: 1, background: 'var(--border)', margin: '2px 0' }} />;
  return (
    <div style={{ width: 40, flex: '0 0 auto', borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 8, overflow: 'auto' }}>
      <button onClick={() => setTool('select')} title="Курсор — выделение/перемещение (V)" style={cell(activeTool === 'select')}>
        <svg {...I}><path d="M3 3l7 18 2.5-7.5L20 11z" /></svg>
      </button>
      <button onClick={() => setTool('blade')} title="Лезвие — разрезать клип (C/B)" style={cell(activeTool === 'blade')}>
        <svg {...I}><path d="M4 4l10 10" /><circle cx="17" cy="17" r="3" /><path d="M14 14l6-6" /></svg>
      </button>
      {div}
      <button onClick={splitAtPlayhead} title="Разрезать по плейхеду (Ctrl+K)" style={cell(false)}>
        <svg {...I}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
      </button>
      <button onClick={() => useProStore.getState().undo()} title="Отменить (Ctrl+Z)" style={cell(false)}>
        <svg {...I}><path d="M3 7v6h6" /><path d="M3.5 13a9 9 0 1 0 2.6-6.4L3 9" /></svg>
      </button>
      <button onClick={() => useProStore.getState().redo()} title="Повторить (Ctrl+Shift+Z)" style={cell(false)}>
        <svg {...I}><path d="M21 7v6h-6" /><path d="M20.5 13a9 9 0 1 1-2.6-6.4L21 9" /></svg>
      </button>
      <button onClick={fitZoom} title="Вписать масштаб" style={cell(false)}>
        <svg {...I}><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
      </button>
      {div}
      <button onClick={toggleSnapping} title="Магнит — прилипание (N)" style={cell(snapping)}>
        <svg {...I}><path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="6" y1="4" x2="10" y2="4" /><line x1="14" y1="4" x2="18" y2="4" /></svg>
      </button>
    </div>
  );
}

// ─── Линейка ──────────────────────────────────────────────────────────────

function Ruler({ vpW, pxPerSec, scrollX, fps }: { vpW: number; pxPerSec: number; scrollX: number; fps: number }) {
  if (vpW <= 0) return null;
  const step = chooseTickStep(pxPerSec, fps);
  const firstTime = scrollX / pxPerSec;
  const lastTime = (scrollX + vpW) / pxPerSec;
  const firstTick = Math.floor(firstTime / step) * step;
  const ticks: number[] = [];
  for (let t = firstTick; t <= lastTime; t += step) ticks.push(t);
  return (
    <>
      {ticks.map((t, i) => {
        const x = t * pxPerSec - scrollX;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0 }}>
            <div style={{ position: 'absolute', bottom: 0, width: 1, height: 8, background: 'var(--border)' }} />
            <span style={{ position: 'absolute', top: 5, left: 4, fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {formatTimecode(Math.max(0, t), fps)}
            </span>
          </div>
        );
      })}
    </>
  );
}

// ─── Заголовок дорожки ──────────────────────────────────────────────────────

function TrackHeader({ track }: { track: ProTrack }) {
  const toggle = useProStore((s) => s.toggleTrackFlag);
  const addClip = useProStore((s) => s.addClip);
  const addAdjustmentClip = useProStore((s) => s.addAdjustmentClip);
  const removeTrack = useProStore((s) => s.removeTrack);
  const openMenu = useContext(MenuCtx);
  const flag = (name: 'muted' | 'solo' | 'locked' | 'hidden') => {
    useProStore.getState().pushHistory();
    toggle(track.id, name);
  };
  const onDelete = () => {
    if (!window.confirm(`Удалить дорожку ${track.name} и её клипы?`)) return;
    useProStore.getState().pushHistory();
    removeTrack(track.id);
  };
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const st = useProStore.getState();
    openMenu(e.clientX, e.clientY, [
      { label: track.isAdjustment ? 'Добавить блок' : 'Импортировать медиа сюда', onClick: onImport },
      { label: '＋ Видео-дорожка', onClick: () => { st.pushHistory(); st.addTrack('video'); } },
      { label: '＋ Аудио-дорожка', onClick: () => { st.pushHistory(); st.addTrack('audio'); } },
      { label: track.muted ? 'Включить звук' : 'Заглушить (Mute)', onClick: () => flag('muted') },
      { label: track.solo ? 'Solo выкл' : 'Solo', onClick: () => flag('solo') },
      { label: track.locked ? 'Разблокировать' : 'Заблокировать (Lock)', onClick: () => flag('locked') },
      { label: 'Удалить дорожку', danger: true, onClick: onDelete },
    ]);
  };

  const onImport = async () => {
    const playhead = useProStore.getState().playhead;
    if (track.isAdjustment) {
      useProStore.getState().pushHistory();
      addAdjustmentClip(track.id, playhead, 3, 'warm');
      return;
    }
    if (track.kind === 'video') {
      const paths = await window.electronAPI.selectVideos();
      if (!paths.length) return;
      const st = useProStore.getState();
      st.pushHistory();
      let at = playhead;
      for (const p of paths) {
        const meta = await probeMeta(p, 'video');
        const dur = meta.duration || 3;
        const linkId = 'lk' + Math.random().toString(36).slice(2, 8);
        addClip({ trackId: track.id, sourceFile: p, timelineStart: at, duration: dur, inPoint: 0, sourceDuration: dur, sourceW: meta.width || undefined, sourceH: meta.height || undefined, linkId });
        st.addLinkedAudio(p, at, dur, dur, linkId);
        at += dur;
      }
    } else {
      const p = await window.electronAPI.selectAudio();
      if (!p) return;
      useProStore.getState().pushHistory();
      const dur = (await probeMeta(p, 'audio')).duration || 3;
      addClip({ trackId: track.id, sourceFile: p, timelineStart: playhead, duration: dur, inPoint: 0, sourceDuration: dur });
    }
  };

  return (
    <div onContextMenu={onContext} style={{ height: track.height, borderBottom: '1px solid var(--border)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4, background: track.kind === 'audio' ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="ПКМ — меню дорожки">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{track.name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>⋯</span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        <FlagBtn on={track.muted} onClick={() => flag('muted')} title="Mute">M</FlagBtn>
        <FlagBtn on={track.solo} onClick={() => flag('solo')} title="Solo">S</FlagBtn>
        <FlagBtn on={track.locked} onClick={() => flag('locked')} title="Lock">L</FlagBtn>
        {track.kind === 'video' && (
          <FlagBtn on={track.hidden} onClick={() => flag('hidden')} title="Скрыть видео">
            👁
          </FlagBtn>
        )}
      </div>
    </div>
  );
}

// ─── Дорожка с клипами (виртуализация) ──────────────────────────────────────

interface LaneHelpers {
  timeAt: (clientX: number) => number;
  snap: (t: number, exclude: Set<string>) => number;
  trackAt: (clientY: number) => string | null;
}

function Lane({ track, y, vpW, pxPerSec, scrollX, timeAt, snap, trackAt }: { track: ProTrack; y: number; vpW: number; pxPerSec: number; scrollX: number } & LaneHelpers) {
  const clips = useProStore(useShallow((s) => s.doc.clips.filter((c) => c.trackId === track.id)));
  const selected = useProStore((s) => s.selectedClipIds);
  const openMenu = useContext(MenuCtx);

  const onClipContext = (e: React.MouseEvent, c: (typeof clips)[number]) => {
    e.preventDefault();
    e.stopPropagation();
    const st = useProStore.getState();
    if (!st.selectedClipIds.includes(c.id)) st.setSelection([c.id]);
    const ids = useProStore.getState().selectedClipIds;
    const ph = st.playhead;
    const canSplit = ph > c.timelineStart && ph < c.timelineStart + c.duration;
    const isVideo = track.kind === 'video' && !track.isAdjustment;
    // Соседние клипы одного рода по обе стороны (с допуском на микро-зазор) — кроссфейд на видео/аудио/тексте.
    const NEAR = 0.12;
    const canX = !track.isAdjustment;
    const kin = (o: (typeof clips)[number]) => !!o.text === !!c.text; // текст↔текст, видео↔видео (аудио — свой трек)
    const leftAdj = canX ? clips.filter((o) => o.id !== c.id && kin(o) && o.timelineStart < c.timelineStart && o.timelineStart + o.duration <= c.timelineStart + NEAR).sort((a, b) => b.timelineStart + b.duration - (a.timelineStart + a.duration))[0] : undefined;
    const rightAdj = canX ? clips.filter((o) => o.id !== c.id && kin(o) && o.timelineStart > c.timelineStart && o.timelineStart >= c.timelineStart + c.duration - NEAR).sort((a, b) => a.timelineStart - b.timelineStart)[0] : undefined;
    // Добавить кроссфейд: подтягиваем правый клип вплотную к левому и ставим переход на правом.
    const addXfade = (rightClip: (typeof clips)[number], leftClip: (typeof clips)[number]) => {
      st.pushHistory();
      const flush = leftClip.timelineStart + leftClip.duration;
      if (Math.abs(rightClip.timelineStart - flush) > 0.001) st.moveClip(rightClip.id, rightClip.trackId, flush);
      st.setClipTransition(rightClip.id, 0.5);
    };
    openMenu(e.clientX, e.clientY, [
      ...(canSplit ? [{ label: 'Разрезать по плейхеду (Ctrl+K)', onClick: () => { st.pushHistory(); st.splitClipAt(c.id, ph); } }] : []),
      ...(clips.some((o) => o.sourceFile === c.sourceFile && o.id !== c.id && Math.abs(o.timelineStart - (c.timelineStart + c.duration)) < 0.05)
        ? [{ label: 'Склеить со следующим', onClick: () => { st.pushHistory(); st.mergeWithNext(c.id); } }]
        : []),
      ...(leftAdj && !c.transition ? [{ label: '⇄ Кросс-фейд (слева)', onClick: () => addXfade(c, leftAdj) }] : []),
      ...(rightAdj && !rightAdj.transition ? [{ label: '⇄ Кросс-фейд (справа)', onClick: () => addXfade(rightAdj, c) }] : []),
      ...(c.transition ? [{ label: 'Убрать переход', onClick: () => { st.pushHistory(); st.setClipTransition(c.id, null); } }] : []),
      ...(c.linkId ? [{ label: 'Разделить видео/аудио', onClick: () => { st.pushHistory(); st.unlinkClip(c.id); } }] : []),
      { label: 'Копировать (Ctrl+C)', onClick: () => st.copyClips(ids) },
      { label: 'Дублировать (Ctrl+D)', onClick: () => { st.pushHistory(); st.duplicateClips(ids); } },
      ...(isVideo
        ? [{ label: 'Отделить аудио', onClick: () => {
            st.pushHistory();
            const atid = st.doc.tracks.find((t) => t.kind === 'audio')?.id ?? st.addTrack('audio');
            st.addClip({ trackId: atid, sourceFile: c.sourceFile, timelineStart: c.timelineStart, duration: c.duration, inPoint: c.inPoint, sourceDuration: c.sourceDuration });
          } }]
        : []),
      { label: c.locked ? 'Открепить' : 'Закрепить', onClick: () => { st.pushHistory(); st.toggleClipLock(c.id); } },
      ...(c.sourceFile ? [{ label: 'Показать файл в проводнике', onClick: () => window.electronAPI.showItemInFolder(c.sourceFile) }] : []),
      { label: 'Удалить (Del)', danger: true, onClick: () => { st.pushHistory(); st.removeClips(ids); } },
      { label: 'Удалить со сдвигом (Shift+Del)', danger: true, onClick: () => { st.pushHistory(); st.rippleDeleteClips(ids); } },
    ]);
  };

  // Перемещение клипа (Move, §3.3): вдоль таймлайна + между дорожками, с прилипанием.
  const onBodyDown = (e: React.PointerEvent, c: (typeof clips)[number]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const st = useProStore.getState();
    if (st.activeTool === 'blade') {
      st.pushHistory();
      st.splitClipAt(c.id, timeAt(e.clientX));
      return;
    }
    const multi = e.shiftKey; // множественное — Shift; Ctrl зарезервирован под вставку
    const insertMode = e.ctrlKey || e.metaKey; // Ctrl+перетаскивание — вставка между клипами (раздвинуть)
    let sel = st.selectedClipIds;
    if (multi) sel = sel.includes(c.id) ? sel : [...sel, c.id];
    else if (!sel.includes(c.id)) sel = [c.id];
    st.setSelection(sel);

    // Связанные (видео+аудио одного источника) двигаются вместе.
    const linked = new Set(sel);
    for (const id of sel) {
      const c0 = st.doc.clips.find((x) => x.id === id);
      if (c0?.linkId) for (const x of st.doc.clips) if (x.linkId === c0.linkId) linked.add(x.id);
    }
    const movingIds = [...linked];
    const startTime = timeAt(e.clientX);
    const origStart = new Map(st.doc.clips.filter((cl) => movingIds.includes(cl.id)).map((cl) => [cl.id, cl.timelineStart]));
    const minOrig = Math.min(...origStart.values());
    const origPrimary = c.timelineStart;
    const dur = c.duration;
    const exclude = new Set(movingIds);
    let pushed = false;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (!pushed) {
        useProStore.getState().pushHistory();
        pushed = true;
      }
      moved = true;
      const dt = timeAt(ev.clientX) - startTime;
      const raw = origPrimary + dt;
      const snapStart = snap(raw, exclude);
      const snapEnd = snap(raw + dur, exclude) - dur;
      const target = Math.abs(snapEnd - raw) < Math.abs(snapStart - raw) ? snapEnd : snapStart;
      let applied = target - origPrimary;
      applied = Math.max(applied, -minOrig); // не левее нуля
      const cur = useProStore.getState();
      // Захваченный клип может сменить дорожку по вертикали (как в Premiere);
      // связанные (аудио) остаются на своих — двигаются только по времени.
      const primaryTid = trackAt(ev.clientY) || c.trackId;
      if (movingIds.length === 1) {
        cur.moveClip(c.id, primaryTid, origPrimary + applied);
      } else {
        for (const id of movingIds) {
          const os = origStart.get(id) ?? 0;
          const clip = cur.doc.clips.find((x) => x.id === id);
          if (!clip) continue;
          cur.moveClip(id, id === c.id ? primaryTid : clip.trackId, os + applied);
        }
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Клик без движения по одному из выделенных — оставить выделенным только его.
      if (!moved && !multi && movingIds.length > 1) useProStore.getState().setSelection([c.id]);
      // Ctrl+перетаскивание одного клипа — вставка: раздвигаем клипы на дорожке.
      if (insertMode && moved && movingIds.length === 1) {
        const cur = useProStore.getState();
        const clip = cur.doc.clips.find((x) => x.id === c.id);
        if (clip) cur.rippleInsert(c.id, clip.trackId, clip.timelineStart);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Подрезка краёв (Trim, §3.3): левый край меняет in-point+старт, правый — длину.
  const onGripDown = (e: React.PointerEvent, c: (typeof clips)[number], side: 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const st = useProStore.getState();
    if (st.activeTool === 'blade') {
      st.splitClipAt(c.id, timeAt(e.clientX));
      return;
    }
    st.setSelection([c.id]);
    const startTime = timeAt(e.clientX);
    const orig = { start: c.timelineStart, inPoint: c.inPoint, duration: c.duration, srcDur: c.sourceDuration };
    const exclude = new Set([c.id]);
    let pushed = false;
    const move = (ev: PointerEvent) => {
      if (!pushed) {
        useProStore.getState().pushHistory();
        pushed = true;
      }
      const dt = timeAt(ev.clientX) - startTime;
      const cur = useProStore.getState();
      if (side === 'l') {
        let newStart = snap(orig.start + dt, exclude);
        newStart = Math.max(orig.start - orig.inPoint, newStart); // in-point >= 0
        newStart = Math.min(newStart, orig.start + orig.duration - 0.05); // длина >= min
        const shift = newStart - orig.start;
        cur.setClipTrim(c.id, { timelineStart: newStart, inPoint: orig.inPoint + shift, duration: orig.duration - shift });
      } else {
        let newEnd = snap(orig.start + orig.duration + dt, exclude);
        newEnd = Math.max(newEnd, orig.start + 0.05);
        let dur2 = newEnd - orig.start;
        if (orig.srcDur) dur2 = Math.min(dur2, orig.srcDur - orig.inPoint); // не длиннее источника
        cur.setClipTrim(c.id, { timelineStart: orig.start, inPoint: orig.inPoint, duration: dur2 });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Создание перехода на стыке: тянем ⇄ вправо — задаём длину; клик без движения = 0.5с.
  const onTransitionCreate = (e: React.PointerEvent, c: (typeof clips)[number]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    useProStore.getState().pushHistory();
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      // Куда тянешь — там и переход: вправо (в правый клип) = 'left', влево (в левый) = 'right', клик = 'center'.
      const dx = timeAt(ev.clientX) - c.timelineStart;
      const align = dx > 0.02 ? 'left' : dx < -0.02 ? 'right' : 'center';
      const dur = align === 'center' ? Math.abs(dx) * 2 : Math.abs(dx);
      const st = useProStore.getState();
      st.setClipTransition(c.id, Math.max(0.1, dur));
      st.setTransitionAlign(c.id, align);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) useProStore.getState().setClipTransition(c.id, 0.5);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Длина crossfade — симметрично от стыка (тянуть любой край в любую сторону = нахлёст).
  const onTransitionResize = (e: React.PointerEvent, c: (typeof clips)[number]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    let pushed = false;
    const move = (ev: PointerEvent) => {
      if (!pushed) {
        useProStore.getState().pushHistory();
        pushed = true;
      }
      const align = c.transition?.align || 'center';
      const dx = Math.abs(timeAt(ev.clientX) - c.timelineStart);
      const dur = align === 'center' ? dx * 2 : dx;
      useProStore.getState().setClipTransition(c.id, Math.max(0.1, dur));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div style={{ position: 'absolute', top: y, left: 0, right: 0, height: track.height, borderBottom: '1px solid var(--border)' }}>
      {clips.map((c) => {
        const clipStartX = c.timelineStart * pxPerSec - scrollX;
        const clipW = c.duration * pxPerSec;
        const clipEndX = clipStartX + clipW;
        if (vpW > 0 && (clipEndX < 0 || clipStartX > vpW)) return null; // виртуализация

        const visL = Math.max(clipStartX, 0);
        const visR = Math.min(clipEndX, vpW || clipEndX);
        const visW = Math.max(1, visR - visL);
        const tOffL = (visL - clipStartX) / pxPerSec;
        const subInPoint = c.inPoint + tOffL;
        const subDuration = visW / pxPerSec;
        const isSel = selected.includes(c.id);
        const trueLeft = clipStartX >= 0;
        const trueRight = clipEndX <= (vpW || clipEndX);

        return (
          <div
            key={c.id}
            onPointerDown={(e) => onBodyDown(e, c)}
            onContextMenu={(e) => onClipContext(e, c)}
            style={{
              position: 'absolute',
              left: visL,
              width: visW,
              top: 3,
              height: track.height - 6,
              background: track.kind === 'audio' ? 'rgba(80,140,255,0.18)' : 'var(--bg-tertiary)',
              border: `1px solid ${isSel ? 'var(--accent-green)' : 'var(--border)'}`,
              borderLeftWidth: trueLeft ? (isSel ? 2 : 1) : 0,
              borderRightWidth: trueRight ? (isSel ? 2 : 1) : 0,
              borderRadius: 5,
              overflow: 'hidden',
              cursor: 'grab',
            }}
          >
            {c.text ? (
              <div style={{ width: visW, height: track.height - 8, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', background: 'rgba(255,200,60,0.28)', color: '#fff', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>T {c.text.content}</div>
            ) : track.isAdjustment ? (
              <AdjustBlock label={c.adjust ? ADJUST_LABEL[c.adjust.filter] : 'Adj'} width={visW} height={track.height - 8} />
            ) : track.kind === 'video' ? (
              <ClipThumbs src={c.sourceFile} inPoint={subInPoint} duration={subDuration} width={visW} height={track.height - 8} />
            ) : (
              <ClipWaveform src={c.sourceFile} inPoint={subInPoint} duration={subDuration} width={visW} height={track.height - 8} />
            )}
            <span style={{ position: 'absolute', left: 4, bottom: 2, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 3, padding: '0 4px', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {c.duration.toFixed(1)}с
            </span>
            {c.locked && <span style={{ position: 'absolute', right: 4, top: 2, fontSize: 11, pointerEvents: 'none' }}>🔒</span>}
            {trueLeft && <div onPointerDown={(e) => onGripDown(e, c, 'l')} style={gripStyle('l')} title="Подрезать слева" />}
            {trueRight && <div onPointerDown={(e) => onGripDown(e, c, 'r')} style={gripStyle('r')} title="Подрезать справа" />}
          </div>
        );
      })}

      {/* Переходы по центру стыка (поверх клипов, нахлёст в обе стороны). */}
      {clips.map((c) => {
        const hasPrev = clips.some((o) => o.id !== c.id && o.trackId === c.trackId && Math.abs(o.timelineStart + o.duration - c.timelineStart) < 0.05);
        if (!hasPrev) return null; // без смежного слева перехода нет (не рисуем «висящий» блок)
        const bx = c.timelineStart * pxPerSec - scrollX;
        if (vpW > 0 && (bx < -60 || bx > vpW + 60)) return null;
        if (c.transition) {
          const w = c.transition.duration * pxPerSec;
          const align = c.transition.align || 'center';
          const left = align === 'left' ? bx : align === 'right' ? bx - w : bx - w / 2;
          return (
            <div key={'tr' + c.id} onContextMenu={(e) => onClipContext(e, c)} style={{ position: 'absolute', left, top: 3, height: track.height - 6, width: w, background: 'repeating-linear-gradient(45deg, rgba(204,255,0,0.30), rgba(204,255,0,0.30) 4px, transparent 4px, transparent 8px)', border: '1px solid var(--accent-green)', borderRadius: 4, zIndex: 5 }}>
              <div onPointerDown={(e) => onTransitionResize(e, c)} style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} title="Длина перехода" />
              <div onPointerDown={(e) => onTransitionResize(e, c)} style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} title="Длина перехода" />
              <button onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); useProStore.getState().pushHistory(); useProStore.getState().setClipTransition(c.id, null); }} title="Убрать переход" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, cursor: 'pointer', padding: 0 }}>✕</button>
            </div>
          );
        }
        return (
          <button key={'add' + c.id} onPointerDown={(e) => onTransitionCreate(e, c)} onContextMenu={(e) => onClipContext(e, c)} title="Переход (crossfade): клик — 0.5с, тяни в стороны — нахлёст, ПКМ — меню" style={{ position: 'absolute', left: bx - 9, top: track.height / 2 - 9, width: 18, height: 18, borderRadius: '50%', background: 'rgba(13,13,13,0.7)', border: '1px solid var(--accent-green)', color: 'var(--accent-green)', fontSize: 11, lineHeight: 1, cursor: 'ew-resize', zIndex: 5, padding: 0 }}>⇄</button>
        );
      })}
    </div>
  );
}

function gripStyle(side: 'l' | 'r'): React.CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side === 'l' ? 'left' : 'right']: 0,
    width: 12,
    cursor: 'ew-resize',
    zIndex: 8, // выше блоков перехода (5), чтобы край всегда можно было схватить
    background: `linear-gradient(${side === 'l' ? 'to right' : 'to left'}, rgba(204,255,0,0.5), transparent)`,
  };
}

// Блок корректирующего слоя (фильтр) на таймлайне.
function AdjustBlock({ label, width, height }: { label: string; width: number; height: number }) {
  return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(180,120,255,0.28)', color: '#fff', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      ✦ {label}
    </div>
  );
}

// Полоса миниатюр по видимой части клипа.
function ClipThumbs({ src, inPoint, duration, width, height }: { src: string; inPoint: number; duration: number; width: number; height: number }) {
  const n = clamp(Math.round(width / THUMB_W), 1, 40);
  const cellW = width / n;
  return (
    <div style={{ display: 'flex', width, height }}>
      {Array.from({ length: n }, (_, i) => (
        <Thumb key={i} src={src} time={inPoint + ((i + 0.5) / n) * duration} width={cellW} height={height} />
      ))}
    </div>
  );
}

function Thumb({ src, time, width, height }: { src: string; time: number; width: number; height: number }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.electronAPI.thumb(src, Math.max(0, time)).then((p) => alive && setThumb(p));
    return () => {
      alive = false;
    };
  }, [src, Math.round(time * 4)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ width, height, flex: '0 0 auto', background: '#000', overflow: 'hidden' }}>
      {thumb && <img src={mediaUrl(thumb)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </div>
  );
}

// Вейвформа по видимой части аудиоклипа (canvas).
function ClipWaveform({ src, inPoint, duration, width, height }: { src: string; inPoint: number; duration: number; width: number; height: number }) {
  const [wf, setWf] = useState<{ peaks: number[]; duration: number } | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    window.electronAPI.waveform(src).then((w) => alive && setWf(w));
    return () => {
      alive = false;
    };
  }, [src]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.floor(width * dpr));
    c.height = Math.max(1, Math.floor(height * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (!wf || !wf.peaks.length) return;
    ctx.fillStyle = 'rgba(120,170,255,0.85)';
    const pps = wf.peaks.length / (wf.duration || 1);
    const startP = Math.floor(inPoint * pps);
    const spanP = Math.max(1, Math.floor(duration * pps));
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const p = wf.peaks[startP + Math.floor((x / width) * spanP)] || 0;
      const h = p * mid;
      ctx.fillRect(x, mid - h, 1, Math.max(1, h * 2));
    }
  }, [wf, width, height, inPoint, duration]);
  return <canvas ref={ref} style={{ width, height, display: 'block' }} />;
}

// ─── Панель zoom ────────────────────────────────────────────────────────────

function ZoomBar({ contentEnd }: { contentEnd: number }) {
  const pxPerSec = useProStore((s) => s.pxPerSec);
  const playhead = useProStore((s) => s.playhead);
  const fps = useProStore((s) => s.doc.fps);
  const snapping = useProStore((s) => s.snapping);
  const exportIn = useProStore((s) => s.exportIn);
  const exportOut = useProStore((s) => s.exportOut);
  const setExportIn = useProStore((s) => s.setExportIn);
  const setExportOut = useProStore((s) => s.setExportOut);
  const rangeSet = exportIn != null || exportOut != null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {formatTimecode(playhead, fps)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>· {contentEnd.toFixed(1)}с</span>
      {!snapping && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>· snap off (N)</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
        <button onClick={() => setExportIn(useProStore.getState().playhead)} title="Начало области экспорта (I)" style={zoomBtn}>I</button>
        <button onClick={() => setExportOut(useProStore.getState().playhead)} title="Конец области экспорта (O)" style={zoomBtn}>O</button>
        {rangeSet && (
          <button onClick={() => { setExportIn(null); setExportOut(null); }} title="Сбросить область экспорта" style={{ ...zoomBtn, width: 'auto', padding: '0 6px' }}>
            диапазон ✕
          </button>
        )}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => zoomAtPlayhead(pxPerSec / 1.3)} style={zoomBtn} title="Уменьшить (-)">−</button>
        <input
          type="range"
          min={4}
          max={400}
          value={pxPerSec}
          onChange={(e) => zoomAtPlayhead(Number(e.target.value))}
          style={{ width: 140 }}
        />
        <button onClick={() => zoomAtPlayhead(pxPerSec * 1.3)} style={zoomBtn} title="Увеличить (+)">+</button>
      </div>
    </div>
  );
}

const miniIcon: React.CSSProperties = {
  marginLeft: 'auto',
  width: 20,
  height: 20,
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  fontSize: 13,
  lineHeight: 1,
  cursor: 'pointer',
};

const addTrackBtn: React.CSSProperties = {
  flex: 1,
  height: 20,
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: 11,
  cursor: 'pointer',
  padding: 0,
};

const zoomBtn: React.CSSProperties = {
  width: 24,
  height: 22,
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  fontSize: 15,
  lineHeight: 1,
  cursor: 'pointer',
};

const FlagBtn = ({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: 22,
      height: 20,
      borderRadius: 4,
      border: '1px solid var(--border)',
      background: on ? 'var(--accent-green)' : 'var(--bg-tertiary)',
      color: on ? 'var(--bg-primary)' : 'var(--text-secondary)',
      fontSize: 11,
      cursor: 'pointer',
      padding: 0,
    }}
  >
    {children}
  </button>
);
