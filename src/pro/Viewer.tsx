import { useEffect, useRef, useState } from 'react';
import { useProStore } from '../store/proStore';
import { Compositor, frameCorners, VideoPool } from './compositor';
import { buildFrame, activeAdjustments } from './frame';
import { runProExport } from './exporter';
import { showToast } from '../store/toastStore';
import { DEFAULT_CROP, DEFAULT_TRANSFORM, type ProClip, type ProDocument } from './proTypes';

// Viewer (§4, §7 ТЗ): WebGL-компоновщик слоёв в реальном времени + оверлеи Transform/Crop.

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

export default function Viewer() {
  const doc = useProStore((s) => s.doc);
  const viewerMode = useProStore((s) => s.viewerMode);
  const setViewerMode = useProStore((s) => s.setViewerMode);
  const isPlaying = useProStore((s) => s.isPlaying);
  const setPlaying = useProStore((s) => s.setPlaying);
  const setPlayhead = useProStore((s) => s.setPlayhead);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compRef = useRef<Compositor | null>(null);
  const poolRef = useRef<VideoPool | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [exp, setExp] = useState<{ phase: string; cur: number; total: number } | null>(null);

  const onExport = async () => {
    if (exp) return;
    setExp({ phase: 'capture', cur: 0, total: 1 });
    try {
      const res = await runProExport(useProStore.getState().doc, (phase, cur, total) => setExp({ phase, cur, total }));
      if (res.ok) showToast('Экспорт готов: ' + (res.outPath ?? ''));
      else if (res.error) showToast('Ошибка экспорта: ' + res.error);
    } catch {
      showToast('Ошибка экспорта');
    } finally {
      setExp(null);
    }
  };

  // Размер контейнера под letterbox.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Инициализация WebGL + пула, петля рендера.
  useEffect(() => {
    if (!canvasRef.current) return;
    const comp = new Compositor(canvasRef.current);
    const pool = new VideoPool();
    compRef.current = comp;
    poolRef.current = pool;
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      const dt = (ts - last) / 1000;
      last = ts;
      const st = useProStore.getState();
      let ph = st.playhead;
      const d = st.doc;
      const contentEnd = d.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);
      if (st.isPlaying) {
        ph += dt;
        if (ph >= contentEnd) {
          ph = contentEnd;
          st.setPlaying(false);
        }
        st.setPlayhead(ph);
      }
      const items = buildFrame(d, ph);
      const activeSrc = new Set<string>();
      const drawList: { clip: ProClip; video: HTMLVideoElement; alpha: number }[] = [];
      for (const it of items) {
        const v = pool.get(it.clip.sourceFile);
        activeSrc.add(it.clip.sourceFile);
        const srcTime = Math.max(0, it.sourceTime);
        if (st.isPlaying) {
          if (v.paused) v.play().catch(() => {});
          if (Math.abs(v.currentTime - srcTime) > 0.25) v.currentTime = srcTime;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - srcTime) > 0.04) v.currentTime = srcTime;
        }
        drawList.push({ clip: it.clip, video: v, alpha: it.alpha });
      }
      pool.pauseExcept(activeSrc);
      comp.render(d, drawList, activeAdjustments(d, ph));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      pool.dispose();
      comp.dispose();
    };
  }, []);

  // Letterbox: буфер canvas = разрешение проекта, CSS — вписанный прямоугольник.
  const aspect = doc.width / doc.height;
  let dispW = box.w;
  let dispH = box.w / aspect;
  if (dispH > box.h) {
    dispH = box.h;
    dispW = box.h * aspect;
  }
  const scale = dispW / doc.width || 1;

  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-primary)', position: 'relative' }}>
      {/* Панель режимов оверлея. */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <ModeBtn active={viewerMode === 'transform'} onClick={() => setViewerMode(viewerMode === 'transform' ? 'none' : 'transform')}>
          Transform
        </ModeBtn>
        <ModeBtn active={viewerMode === 'crop'} onClick={() => setViewerMode(viewerMode === 'crop' ? 'none' : 'crop')}>
          Crop
        </ModeBtn>
        <button
          onClick={onExport}
          disabled={!!exp}
          style={{ marginLeft: 'auto', padding: '5px 14px', fontSize: 12.5, borderRadius: 7, cursor: exp ? 'default' : 'pointer', color: 'var(--bg-primary)', background: 'var(--accent-green)', border: '1px solid var(--border)', opacity: exp ? 0.6 : 1 }}
        >
          {exp ? 'Экспорт…' : 'Экспорт ⬇'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>
          {doc.width}×{doc.height}
        </span>
      </div>

      {/* Окно предпросмотра. */}
      <div ref={wrapRef} className="flex flex-1 items-center justify-center" style={{ position: 'relative', minHeight: 0, overflow: 'hidden', padding: 12 }}>
        <div style={{ position: 'relative', width: dispW, height: dispH }}>
          <canvas ref={canvasRef} width={doc.width} height={doc.height} style={{ width: dispW, height: dispH, display: 'block', background: '#000' }} />
          {viewerMode === 'transform' && <TransformOverlay doc={doc} scale={scale} />}
          {viewerMode === 'crop' && <CropOverlay doc={doc} scale={scale} />}
        </div>
      </div>

      {/* Транспорт. */}
      <div className="flex items-center justify-center" style={{ gap: 14, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
        <Transport label="⏮" title="В начало" onClick={() => setPlayhead(0)} />
        <Transport label={isPlaying ? '⏸' : '▶'} title="Play / Pause (Space)" primary onClick={() => setPlaying(!isPlaying)} />
        <Transport label="⏭" title="В конец" onClick={() => { const e = useProStore.getState().doc.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0); setPlayhead(e); }} />
      </div>

      {exp && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: 320, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>
              {exp.phase === 'encode' ? 'Кодирование видео…' : `Рендер кадров ${exp.cur}/${exp.total}`}
            </div>
            <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${exp.phase === 'encode' ? 100 : Math.round((exp.cur / exp.total) * 100)}%`, background: 'var(--accent-green)', transition: 'width 0.1s' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Первый выделенный видео-клип (для оверлея).
function useSelectedVideoClip(doc: ProDocument): ProClip | null {
  const sel = useProStore((s) => s.selectedClipIds);
  const videoTrackIds = new Set(doc.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  for (const id of sel) {
    const c = doc.clips.find((cl) => cl.id === id);
    if (c && videoTrackIds.has(c.trackId)) return c;
  }
  return null;
}

// ─── Transform (bounding box + ручки, §4.1 ТЗ) ──────────────────────────────

function TransformOverlay({ doc, scale }: { doc: ProDocument; scale: number }) {
  const clip = useSelectedVideoClip(doc);
  const rootRef = useRef<SVGSVGElement>(null);
  if (!clip) return <HintOverlay text="Выделите видео-клип для Transform" />;

  const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const { pos } = frameCorners(doc, clip, false);
  const dc = pos.map(([x, y]) => [x * scale, y * scale]);
  const cxD = (doc.width / 2 + t.x) * scale;
  const cyD = (doc.height / 2 + t.y) * scale;
  const topMid = [(dc[0][0] + dc[1][0]) / 2, (dc[0][1] + dc[1][1]) / 2];
  const dirLen = Math.hypot(topMid[0] - cxD, topMid[1] - cyD) || 1;
  const rotH = [topMid[0] + ((topMid[0] - cxD) / dirLen) * 26, topMid[1] + ((topMid[1] - cyD) / dirLen) * 26];

  const projAt = (clientX: number, clientY: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };
  const drag = (onMove: (ev: PointerEvent) => void) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    useProStore.getState().pushHistory();
    const up = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  };

  const onMove = () => {
    let last: { x: number; y: number } | null = null;
    return drag((ev) => {
      const st = useProStore.getState();
      if (!last) last = { x: ev.clientX, y: ev.clientY };
      const dx = (ev.clientX - last.x) / scale;
      const dy = (ev.clientY - last.y) / scale;
      last = { x: ev.clientX, y: ev.clientY };
      const ct = { ...DEFAULT_TRANSFORM, ...st.doc.clips.find((c) => c.id === clip.id)?.transform };
      st.updateClipTransform(clip.id, { x: ct.x + dx, y: ct.y + dy });
    });
  };

  const onScale = () => {
    const t0 = { ...DEFAULT_TRANSFORM, ...clip.transform };
    const cX = doc.width / 2 + t0.x;
    const cY = doc.height / 2 + t0.y;
    let d0 = 1;
    return drag((ev) => {
      const p = projAt(ev.clientX, ev.clientY);
      const d = Math.hypot(p.x - cX, p.y - cY);
      if (d0 === 1) d0 = d || 1;
      useProStore.getState().updateClipTransform(clip.id, { scale: Math.max(0.05, t0.scale * (d / d0)) });
    });
  };

  const onRotate = () => {
    const t0 = { ...DEFAULT_TRANSFORM, ...clip.transform };
    const cX = doc.width / 2 + t0.x;
    const cY = doc.height / 2 + t0.y;
    let a0: number | null = null;
    return drag((ev) => {
      const p = projAt(ev.clientX, ev.clientY);
      const a = Math.atan2(p.y - cY, p.x - cX);
      if (a0 === null) a0 = a;
      const deg = ((a - a0) * 180) / Math.PI;
      useProStore.getState().updateClipTransform(clip.id, { rotation: t0.rotation + deg });
    });
  };

  return (
    <svg ref={rootRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
      <polygon
        points={dc.map((p) => p.join(',')).join(' ')}
        fill="rgba(204,255,0,0.05)"
        stroke="var(--accent-green)"
        strokeWidth={1.5}
        style={{ cursor: 'move' }}
        onPointerDown={onMove()}
      />
      <line x1={topMid[0]} y1={topMid[1]} x2={rotH[0]} y2={rotH[1]} stroke="var(--accent-green)" strokeWidth={1.5} />
      <circle cx={rotH[0]} cy={rotH[1]} r={6} fill="var(--accent-green)" style={{ cursor: 'grab' }} onPointerDown={onRotate()} />
      {dc.map((p, i) => (
        <rect key={i} x={p[0] - 5} y={p[1] - 5} width={10} height={10} fill="#fff" stroke="var(--accent-green)" strokeWidth={1.5} style={{ cursor: 'nwse-resize' }} onPointerDown={onScale()} />
      ))}
    </svg>
  );
}

// ─── Crop (§4.2 ТЗ) ─────────────────────────────────────────────────────────

function CropOverlay({ doc, scale }: { doc: ProDocument; scale: number }) {
  const clip = useSelectedVideoClip(doc);
  const rootRef = useRef<SVGSVGElement>(null);
  if (!clip) return <HintOverlay text="Выделите видео-клип для Crop" />;

  const cr = { ...DEFAULT_CROP, ...clip.crop };
  const W = doc.width;
  const H = doc.height;
  const x0 = W * cr.left * scale;
  const x1 = W * (1 - cr.right) * scale;
  const y0 = H * cr.top * scale;
  const y1 = H * (1 - cr.bottom) * scale;

  const projFrac = (clientX: number, clientY: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { fx: (clientX - r.left) / scale / W, fy: (clientY - r.top) / scale / H };
  };
  const dragEdge = (side: 'top' | 'bottom' | 'left' | 'right') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    useProStore.getState().pushHistory();
    const move = (ev: PointerEvent) => {
      const { fx, fy } = projFrac(ev.clientX, ev.clientY);
      const st = useProStore.getState();
      if (side === 'left') st.updateClipCrop(clip.id, { left: clamp(fx, 0, 0.9) });
      else if (side === 'right') st.updateClipCrop(clip.id, { right: clamp(1 - fx, 0, 0.9) });
      else if (side === 'top') st.updateClipCrop(clip.id, { top: clamp(fy, 0, 0.9) });
      else st.updateClipCrop(clip.id, { bottom: clamp(1 - fy, 0, 0.9) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fullW = W * scale;
  const fullH = H * scale;
  return (
    <svg ref={rootRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {/* Затемнение обрезаемых краёв. */}
      <path d={`M0 0H${fullW}V${fullH}H0Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`} fill="rgba(0,0,0,0.5)" fillRule="evenodd" />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="var(--accent-green)" strokeWidth={1.5} />
      <line x1={x0} y1={y0} x2={x1} y2={y0} stroke="transparent" strokeWidth={10} style={{ cursor: 'ns-resize' }} onPointerDown={dragEdge('top')} />
      <line x1={x0} y1={y1} x2={x1} y2={y1} stroke="transparent" strokeWidth={10} style={{ cursor: 'ns-resize' }} onPointerDown={dragEdge('bottom')} />
      <line x1={x0} y1={y0} x2={x0} y2={y1} stroke="transparent" strokeWidth={10} style={{ cursor: 'ew-resize' }} onPointerDown={dragEdge('left')} />
      <line x1={x1} y1={y0} x2={x1} y2={y1} stroke="transparent" strokeWidth={10} style={{ cursor: 'ew-resize' }} onPointerDown={dragEdge('right')} />
    </svg>
  );
}

function HintOverlay({ text }: { text: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
      {text}
    </div>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        fontSize: 12.5,
        borderRadius: 7,
        cursor: 'pointer',
        color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
        background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  );
}

function Transport({ label, title, onClick, primary }: { label: string; title: string; onClick?: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: primary ? 44 : 36,
        height: 36,
        borderRadius: 8,
        fontSize: 16,
        cursor: 'pointer',
        color: primary ? 'var(--bg-primary)' : 'var(--text-primary)',
        background: primary ? 'var(--accent-green)' : 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
      }}
    >
      {label}
    </button>
  );
}
