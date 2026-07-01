import { useCallback, useEffect, useRef, useState } from 'react';
import { useProStore } from '../store/proStore';
import { mediaUrl } from '../utils/media';
import type { ProTrack } from './proTypes';

// Ядро таймлайна Pulsar Pro (§3 ТЗ): дорожки, линейка HH:MM:SS:FF, playhead,
// скраббинг, zoom/pan, клипы с миниатюрами/вейвформами, виртуализация.

const HEADER_W = 132; // ширина колонки заголовков дорожек
const RULER_H = 30;
const THUMB_W = 90;

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

// Определяем длительность медиа через скрытый элемент (media:// протокол).
function probeDuration(path: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(el.duration || 0);
    el.onerror = () => resolve(0);
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
  const onRulerDown = (e: React.PointerEvent) => {
    scrubbing.current = true;
    setPlayhead(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent) => scrubbing.current && setPlayhead(timeAtClientX(ev.clientX));
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

  const playheadX = playhead * pxPerSec - scrollX;
  const contentEnd = doc.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);

  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-secondary)' }}>
      <ZoomBar contentEnd={contentEnd} />
      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
        {/* Колонка заголовков дорожек. */}
        <div style={{ width: HEADER_W, flex: '0 0 auto', borderRight: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
          <div style={{ height: RULER_H, borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)' }} />
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
          <div style={{ position: 'absolute', top: RULER_H, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
            <div style={{ transform: `translateY(${-clampedScrollY}px)`, position: 'relative' }}>
              {laneOffsets.map(({ track, y }) => (
                <Lane key={track.id} track={track} y={y} vpW={vp.w} pxPerSec={pxPerSec} scrollX={scrollX} />
              ))}
            </div>
            {!doc.clips.length && (
              <div className="flex h-full w-full items-center justify-center" style={{ position: 'absolute', inset: 0, color: 'var(--text-secondary)', fontSize: 13, pointerEvents: 'none' }}>
                Импортируйте медиа кнопкой ＋ у дорожки
              </div>
            )}
          </div>

          {/* Playhead (§3.2 ТЗ). */}
          {playheadX >= 0 && playheadX <= vp.w && (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: playheadX, width: 0, borderLeft: '1px solid var(--accent-green)', zIndex: 4, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 0, left: -5, width: 10, height: 10, background: 'var(--accent-green)', clipPath: 'polygon(0 0,100% 0,50% 100%)' }} />
            </div>
          )}
        </div>
      </div>
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

  const onImport = async () => {
    const playhead = useProStore.getState().playhead;
    if (track.kind === 'video') {
      const paths = await window.electronAPI.selectVideos();
      let at = playhead;
      for (const p of paths) {
        const dur = (await probeDuration(p, 'video')) || 3;
        addClip({ trackId: track.id, sourceFile: p, timelineStart: at, duration: dur, inPoint: 0 });
        at += dur;
      }
    } else {
      const p = await window.electronAPI.selectAudio();
      if (!p) return;
      const dur = (await probeDuration(p, 'audio')) || 3;
      addClip({ trackId: track.id, sourceFile: p, timelineStart: playhead, duration: dur, inPoint: 0 });
    }
  };

  return (
    <div style={{ height: track.height, borderBottom: '1px solid var(--border)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4, background: track.kind === 'audio' ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{track.name}</span>
        <button onClick={onImport} title="Импортировать медиа" style={miniIcon}>＋</button>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        <FlagBtn on={track.muted} onClick={() => toggle(track.id, 'muted')} title="Mute">M</FlagBtn>
        <FlagBtn on={track.solo} onClick={() => toggle(track.id, 'solo')} title="Solo">S</FlagBtn>
        <FlagBtn on={track.locked} onClick={() => toggle(track.id, 'locked')} title="Lock">L</FlagBtn>
        {track.kind === 'video' && (
          <FlagBtn on={track.hidden} onClick={() => toggle(track.id, 'hidden')} title="Скрыть видео">
            👁
          </FlagBtn>
        )}
      </div>
    </div>
  );
}

// ─── Дорожка с клипами (виртуализация) ──────────────────────────────────────

function Lane({ track, y, vpW, pxPerSec, scrollX }: { track: ProTrack; y: number; vpW: number; pxPerSec: number; scrollX: number }) {
  const clips = useProStore((s) => s.doc.clips.filter((c) => c.trackId === track.id));
  const selected = useProStore((s) => s.selectedClipIds);
  const setSelection = useProStore((s) => s.setSelection);

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
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              const multi = e.shiftKey || e.ctrlKey || e.metaKey;
              setSelection(multi ? Array.from(new Set([...selected, c.id])) : [c.id]);
            }}
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
              cursor: 'pointer',
            }}
          >
            {track.kind === 'video' ? (
              <ClipThumbs src={c.sourceFile} inPoint={subInPoint} duration={subDuration} width={visW} height={track.height - 8} />
            ) : (
              <ClipWaveform src={c.sourceFile} inPoint={subInPoint} duration={subDuration} width={visW} height={track.height - 8} />
            )}
            <span style={{ position: 'absolute', left: 4, bottom: 2, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 3, padding: '0 4px', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {c.duration.toFixed(1)}с
            </span>
          </div>
        );
      })}
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {formatTimecode(playhead, fps)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>· {contentEnd.toFixed(1)}с</span>
      {!snapping && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>· snap off (N)</span>}
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
