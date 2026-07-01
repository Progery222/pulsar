import { useEffect, useRef, useState } from 'react';
import { useProStore } from '../store/proStore';
import { frameCorners } from './compositor';
import { activeTexts } from './frame';
import { runProExport, type ExportSettings } from './exporter';
import { showToast } from '../store/toastStore';
import { mediaUrl } from '../utils/media';
import { colorToCss, DEFAULT_CROP, DEFAULT_TEXT, DEFAULT_TRANSFORM, type ProClip, type ProDocument } from './proTypes';

// Viewer (§4 ТЗ). Живое превью — DOM <video> (надёжно, без GPU); WebGL-компоновщик
// используется для экспорта (exporter.ts). Оверлеи Transform/Crop поверх кадра.

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

// Пресеты разрешения секвенции.
const RES_PRESETS = [
  { label: '16:9 · 1920×1080', value: '1920x1080' },
  { label: '9:16 · 1080×1920', value: '1080x1920' },
  { label: '1:1 · 1080×1080', value: '1080x1080' },
  { label: '4:5 · 1080×1350', value: '1080x1350' },
  { label: '16:9 · 1280×720', value: '1280x720' },
  { label: '4K · 3840×2160', value: '3840x2160' },
];

function maxEnd(doc: ProDocument): number {
  return doc.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);
}

// Верхний активный клип на дорожках нужного типа (с учётом hidden/solo/mute).
function topActiveClip(doc: ProDocument, ph: number, kind: 'video' | 'audio'): ProClip | null {
  const tracks = doc.tracks.filter((t) => t.kind === kind && !t.isAdjustment);
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    // doc-порядок: верхняя дорожка первой.
    if (kind === 'video' && t.hidden) continue;
    if (kind === 'audio' && t.muted) continue;
    if (anySolo && !t.solo) continue;
    for (const c of doc.clips) {
      if (c.trackId === t.id && !c.text && ph >= c.timelineStart && ph < c.timelineStart + c.duration) return c;
    }
  }
  return null;
}

export default function Viewer() {
  const doc = useProStore((s) => s.doc);
  const viewerMode = useProStore((s) => s.viewerMode);
  const setViewerMode = useProStore((s) => s.setViewerMode);
  const isPlaying = useProStore((s) => s.isPlaying);
  const setPlaying = useProStore((s) => s.setPlaying);
  const setPlayhead = useProStore((s) => s.setPlayhead);
  const useProxy = useProStore((s) => s.useProxy);
  const setResolution = useProStore((s) => s.setResolution);
  const playhead = useProStore((s) => s.playhead); // для реактивного текстового оверлея
  const selClip = useSelectedVideoClip(doc); // для перетаскивания кадра в превью

  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const curVideoSrc = useRef('');
  const curAudioSrc = useRef('');
  const exportingRef = useRef(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [exp, setExp] = useState<{ phase: string; cur: number; total: number } | null>(null);
  const [showExportDlg, setShowExportDlg] = useState(false);

  const onToggleProxy = async () => {
    const st = useProStore.getState();
    if (st.useProxy) {
      st.setUseProxy(false);
      return;
    }
    const srcs = new Set<string>();
    for (const c of st.doc.clips) {
      const tr = st.doc.tracks.find((t) => t.id === c.trackId);
      if (tr && tr.kind === 'video' && !tr.isAdjustment && c.sourceFile) srcs.add(c.sourceFile);
    }
    st.setUseProxy(true);
    showToast('Генерация прокси 720p…');
    for (const src of srcs) {
      if (useProStore.getState().proxyMap[src]) continue;
      const p = await window.electronAPI.proMakeProxy(src);
      if (p) useProStore.getState().setProxy(src, p);
    }
    showToast('Прокси готовы');
  };

  const runExportFlow = async (settings: ExportSettings) => {
    if (exp) return;
    setExp({ phase: 'capture', cur: 0, total: 1 });
    useProStore.getState().setPlaying(false);
    exportingRef.current = true;
    // Освобождаем превью-видео на время экспорта.
    videoRef.current?.pause();
    audioRef.current?.pause();
    try {
      const res = await runProExport(useProStore.getState().doc, (phase, cur, total) => setExp({ phase, cur, total }), settings);
      if (res.ok) showToast('Экспорт готов: ' + (res.outPath ?? ''));
      else if (res.error) showToast('Ошибка экспорта: ' + res.error);
    } catch {
      showToast('Ошибка экспорта');
    } finally {
      exportingRef.current = false;
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

  // Петля превью: продвижение playhead + синхронизация video/audio под ним.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      const dt = (ts - last) / 1000;
      last = ts;
      if (exportingRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const st = useProStore.getState();
      const d = st.doc;
      let ph = st.playhead;
      if (st.isPlaying) {
        ph += dt;
        const end = maxEnd(d);
        if (ph >= end) {
          ph = end;
          st.setPlaying(false);
        }
        st.setPlayhead(ph);
      }
      syncVideo(d, ph, st.isPlaying, st.useProxy, st.proxyMap);
      syncAudio(d, ph, st.isPlaying);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function syncVideo(d: ProDocument, ph: number, playing: boolean, proxy: boolean, proxyMap: Record<string, string>) {
    const el = videoRef.current;
    if (!el) return;
    const clip = topActiveClip(d, ph, 'video');
    if (!clip) {
      el.style.opacity = '0';
      if (!el.paused) el.pause();
      curVideoSrc.current = '';
      return;
    }
    el.style.opacity = '1';
    const base = proxy && proxyMap[clip.sourceFile] ? proxyMap[clip.sourceFile] : clip.sourceFile;
    if (curVideoSrc.current !== base) {
      curVideoSrc.current = base;
      el.src = mediaUrl(base);
    }
    const srcTime = Math.max(0, clip.inPoint + (ph - clip.timelineStart));
    if (playing) {
      if (el.paused) el.play().catch(() => {});
      if (Math.abs(el.currentTime - srcTime) > 0.3) el.currentTime = srcTime;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - srcTime) > 0.05) el.currentTime = srcTime;
    }
    const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
    const cr = { ...DEFAULT_CROP, ...clip.crop };
    const dispScale = el.offsetWidth / (d.width || 1) || 1;
    el.style.transform = `translate(${t.x * dispScale}px, ${t.y * dispScale}px) rotate(${t.rotation}deg) scale(${t.scale})`;
    el.style.clipPath = `inset(${cr.top * 100}% ${cr.right * 100}% ${cr.bottom * 100}% ${cr.left * 100}%)`;
    el.style.filter = colorToCss(clip.color);
  }

  function syncAudio(d: ProDocument, ph: number, playing: boolean) {
    const el = audioRef.current;
    if (!el) return;
    const clip = topActiveClip(d, ph, 'audio');
    if (!clip) {
      if (!el.paused) el.pause();
      curAudioSrc.current = '';
      return;
    }
    if (curAudioSrc.current !== clip.sourceFile) {
      curAudioSrc.current = clip.sourceFile;
      el.src = mediaUrl(clip.sourceFile);
    }
    el.volume = Math.min(1, Math.pow(10, (clip.audio?.volumeDb ?? 0) / 20));
    const srcTime = Math.max(0, clip.inPoint + (ph - clip.timelineStart));
    if (playing) {
      if (el.paused) el.play().catch(() => {});
      if (Math.abs(el.currentTime - srcTime) > 0.3) el.currentTime = srcTime;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - srcTime) > 0.05) el.currentTime = srcTime;
    }
  }

  // Перетаскивание кадра мышкой прямо в превью (меняет Position выделенного клипа).
  const onFrameDrag = (e: React.PointerEvent) => {
    if (!selClip || e.button !== 0) return;
    e.preventDefault();
    const sc = dispW / (doc.width || 1) || 1;
    let last = { x: e.clientX, y: e.clientY };
    let pushed = false;
    const move = (ev: PointerEvent) => {
      if (!pushed) { useProStore.getState().pushHistory(); pushed = true; }
      const dx = (ev.clientX - last.x) / sc;
      const dy = (ev.clientY - last.y) / sc;
      last = { x: ev.clientX, y: ev.clientY };
      const st = useProStore.getState();
      const ct = { ...DEFAULT_TRANSFORM, ...st.doc.clips.find((c) => c.id === selClip.id)?.transform };
      st.updateClipTransform(selClip.id, { x: ct.x + dx, y: ct.y + dy });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Letterbox.
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
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <ModeBtn active={viewerMode === 'transform'} onClick={() => setViewerMode(viewerMode === 'transform' ? 'none' : 'transform')}>Transform</ModeBtn>
        <ModeBtn active={viewerMode === 'crop'} onClick={() => setViewerMode(viewerMode === 'crop' ? 'none' : 'crop')}>Crop</ModeBtn>
        <ModeBtn active={useProxy} onClick={onToggleProxy}>Proxy</ModeBtn>
        <button
          onClick={() => setShowExportDlg(true)}
          disabled={!!exp}
          style={{ marginLeft: 'auto', padding: '5px 14px', fontSize: 12.5, borderRadius: 7, cursor: exp ? 'default' : 'pointer', color: 'var(--bg-primary)', background: 'var(--accent-green)', border: '1px solid var(--border)', opacity: exp ? 0.6 : 1 }}
        >
          {exp ? 'Экспорт…' : 'Экспорт ⬇'}
        </button>
        <select
          value={`${doc.width}x${doc.height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            useProStore.getState().pushHistory();
            setResolution(w, h);
          }}
          title="Разрешение секвенции"
          style={{ fontSize: 11.5, padding: '3px 6px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', alignSelf: 'center' }}
        >
          {RES_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          {!RES_PRESETS.some((p) => p.value === `${doc.width}x${doc.height}`) && (
            <option value={`${doc.width}x${doc.height}`}>{doc.width}×{doc.height}</option>
          )}
        </select>
      </div>

      <div ref={wrapRef} className="flex flex-1 items-center justify-center" style={{ position: 'relative', minHeight: 0, overflow: 'hidden', padding: 12 }}>
        <div style={{ position: 'relative', width: dispW, height: dispH, background: '#000' }}>
          {/* Клиппинг видео к рамке кадра — превью не «едет» при трансформации. */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              muted
              playsInline
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block', transformOrigin: 'center center', background: '#000' }}
            />
          </div>
          {viewerMode === 'none' && selClip && (
            <div onPointerDown={onFrameDrag} title="Тяни — двигать кадр (Position)" style={{ position: 'absolute', inset: 0, cursor: 'move', zIndex: 1 }} />
          )}
          {activeTexts(doc, playhead).map((c) => {
            const tt = { ...DEFAULT_TEXT, ...c.text };
            return (
              <div key={c.id} style={{ position: 'absolute', left: `${tt.x * 100}%`, top: `${tt.y * 100}%`, transform: 'translate(-50%,-50%)', color: tt.color, fontSize: (dispH * tt.size) / 100, fontWeight: 700, textAlign: 'center', lineHeight: 1.15, textShadow: '0 2px 6px rgba(0,0,0,0.75)', whiteSpace: 'pre-wrap', pointerEvents: 'none', maxWidth: '96%', ...(tt.bg ? { background: 'rgba(0,0,0,0.45)', padding: '2px 10px', borderRadius: 6 } : {}) }}>
                {tt.content}
              </div>
            );
          })}
          {viewerMode === 'transform' && <TransformOverlay doc={doc} scale={scale} />}
          {viewerMode === 'crop' && <CropOverlay doc={doc} scale={scale} />}
          {!doc.clips.length && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 12.5, pointerEvents: 'none' }}>
              Пусто — добавьте видео на таймлайн
            </div>
          )}
        </div>
        <audio ref={audioRef} style={{ display: 'none' }} />
      </div>

      <div className="flex items-center justify-center" style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
        <Transport title="В начало" onClick={() => setPlayhead(0)} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4" /><rect x="4" y="4" width="2.5" height="16" /></svg>} />
        <Transport title="Play / Pause (Space)" primary onClick={() => setPlaying(!isPlaying)} icon={isPlaying ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4.5" height="16" rx="1" /><rect x="13.5" y="4" width="4.5" height="16" rx="1" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20" /></svg>} />
        <Transport title="В конец" onClick={() => setPlayhead(maxEnd(useProStore.getState().doc))} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20" /><rect x="17.5" y="4" width="2.5" height="16" /></svg>} />
      </div>

      {showExportDlg && <ExportDialog docFps={doc.fps} onCancel={() => setShowExportDlg(false)} onConfirm={(s) => { setShowExportDlg(false); runExportFlow(s); }} />}

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

function useSelectedVideoClip(doc: ProDocument): ProClip | null {
  const sel = useProStore((s) => s.selectedClipIds);
  const videoTrackIds = new Set(doc.tracks.filter((t) => t.kind === 'video' && !t.isAdjustment).map((t) => t.id));
  for (const id of sel) {
    const c = doc.clips.find((cl) => cl.id === id);
    if (c && videoTrackIds.has(c.trackId)) return c;
  }
  return null;
}

// ─── Transform (§4.1 ТЗ) ────────────────────────────────────────────────────

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
    let lastP: { x: number; y: number } | null = null;
    return drag((ev) => {
      const st = useProStore.getState();
      if (!lastP) lastP = { x: ev.clientX, y: ev.clientY };
      const dx = (ev.clientX - lastP.x) / scale;
      const dy = (ev.clientY - lastP.y) / scale;
      lastP = { x: ev.clientX, y: ev.clientY };
      const ct = { ...DEFAULT_TRANSFORM, ...st.doc.clips.find((c) => c.id === clip.id)?.transform };
      st.updateClipTransform(clip.id, { x: ct.x + dx, y: ct.y + dy });
    });
  };
  const onScale = () => {
    const t0 = { ...DEFAULT_TRANSFORM, ...clip.transform };
    const cX = doc.width / 2 + t0.x;
    const cY = doc.height / 2 + t0.y;
    let d0 = 0;
    return drag((ev) => {
      const p = projAt(ev.clientX, ev.clientY);
      const dd = Math.hypot(p.x - cX, p.y - cY);
      if (!d0) d0 = dd || 1;
      useProStore.getState().updateClipTransform(clip.id, { scale: Math.max(0.05, t0.scale * (dd / d0)) });
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
      useProStore.getState().updateClipTransform(clip.id, { rotation: t0.rotation + ((a - a0) * 180) / Math.PI });
    });
  };

  return (
    <svg ref={rootRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
      <polygon points={dc.map((p) => p.join(',')).join(' ')} fill="rgba(204,255,0,0.05)" stroke="var(--accent-green)" strokeWidth={1.5} style={{ cursor: 'move' }} onPointerDown={onMove()} />
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
      <path d={`M0 0H${fullW}V${fullH}H0Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`} fill="rgba(0,0,0,0.5)" fillRule="evenodd" />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="var(--accent-green)" strokeWidth={1.5} />
      <line x1={x0} y1={y0} x2={x1} y2={y0} stroke="transparent" strokeWidth={10} style={{ cursor: 'ns-resize' }} onPointerDown={dragEdge('top')} />
      <line x1={x0} y1={y1} x2={x1} y2={y1} stroke="transparent" strokeWidth={10} style={{ cursor: 'ns-resize' }} onPointerDown={dragEdge('bottom')} />
      <line x1={x0} y1={y0} x2={x0} y2={y1} stroke="transparent" strokeWidth={10} style={{ cursor: 'ew-resize' }} onPointerDown={dragEdge('left')} />
      <line x1={x1} y1={y0} x2={x1} y2={y1} stroke="transparent" strokeWidth={10} style={{ cursor: 'ew-resize' }} onPointerDown={dragEdge('right')} />
    </svg>
  );
}

function ExportDialog({ docFps, onCancel, onConfirm }: { docFps: number; onCancel: () => void; onConfirm: (s: ExportSettings) => void }) {
  const [format, setFormat] = useState<'mp4' | 'mov'>('mp4');
  const [codec, setCodec] = useState<'libx264' | 'libx265'>('libx264');
  const [bitrate, setBitrate] = useState(8);
  const [fps, setFps] = useState(docFps || 30);
  const [audioK, setAudioK] = useState(192);
  const sel: React.CSSProperties = { width: '100%', padding: '5px 8px', fontSize: 13, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' };
  const row = (label: string, node: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      {node}
    </label>
  );
  return (
    <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 22, width: 'min(420px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Настройки экспорта</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {row('Формат', <select value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'mov')} style={sel}><option value="mp4">MP4</option><option value="mov">MOV</option></select>)}
          {row('Кодек', <select value={codec} onChange={(e) => setCodec(e.target.value as 'libx264' | 'libx265')} style={sel}><option value="libx264">H.264</option><option value="libx265">H.265 (HEVC)</option></select>)}
          {row('Битрейт видео, Мбит/с', <input type="number" min={1} max={200} value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))} style={sel} />)}
          {row('FPS', <input type="number" min={1} max={120} value={fps} onChange={(e) => setFps(Number(e.target.value))} style={sel} />)}
          {row('Аудио, кбит/с', <select value={audioK} onChange={(e) => setAudioK(Number(e.target.value))} style={sel}><option value={128}>128</option><option value={192}>192</option><option value={256}>256</option><option value={320}>320</option></select>)}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onCancel} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13 }}>Отмена</button>
          <button onClick={() => onConfirm({ format, codec, videoBitrateMbps: bitrate, fps, audioBitrateK: audioK })} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--accent-green)', color: 'var(--bg-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Экспортировать</button>
        </div>
      </div>
    </div>
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
    <button onClick={onClick} style={{ padding: '5px 12px', fontSize: 12.5, borderRadius: 7, cursor: 'pointer', color: active ? 'var(--bg-primary)' : 'var(--text-primary)', background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
      {children}
    </button>
  );
}

function Transport({ icon, title, onClick, primary }: { icon: React.ReactNode; title: string; onClick?: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: primary ? 46 : 38,
        height: 38,
        borderRadius: primary ? '50%' : 9,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: primary ? 'var(--bg-primary)' : 'var(--text-primary)',
        background: primary ? 'var(--accent-green)' : 'var(--bg-tertiary)',
        border: primary ? 'none' : '1px solid var(--border)',
        transition: 'filter 0.12s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.15)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {icon}
    </button>
  );
}
