import { useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '../store/toastStore';
import { mediaUrl } from '../utils/media';
import type { RecordingResult } from './types';
import { buildAutoZoomRegions, computeZoomTransform, cursorAt, samplesToTelemetry, zoomTargetAt, type ZoomRegion } from './zoom/autoZoom';
import { createZoomSpring, resetZoomSpring, stepZoomSpring } from './zoom/spring';

const BACKGROUNDS: { id: string; label: string; paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }[] = [
  { id: 'none', label: 'Нет', paint: (ctx, w, h) => { ctx.clearRect(0, 0, w, h); } },
  { id: 'dark', label: 'Тёмный', paint: (ctx, w, h) => { ctx.fillStyle = '#0d0d10'; ctx.fillRect(0, 0, w, h); } },
  {
    id: 'violet', label: 'Фиолетовый', paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6d28d9'); g.addColorStop(1, '#2563eb');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sunset', label: 'Закат', paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f97316'); g.addColorStop(1, '#db2777');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'mint', label: 'Мята', paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#059669'); g.addColorStop(1, '#0891b2');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
  },
];

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCursorOverlay(
  ctx: CanvasRenderingContext2D,
  style: 'highlight' | 'spotlight' | 'pointer',
  x: number,
  y: number,
  W: number,
  H: number,
  size: number,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
) {
  const base = W * 0.028 * size;
  if (style === 'highlight') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, base * 2.4);
    g.addColorStop(0, 'rgba(255,214,10,0.42)');
    g.addColorStop(0.5, 'rgba(255,214,10,0.18)');
    g.addColorStop(1, 'rgba(255,214,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, base * 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 'spotlight') {
    const r = base * 3.6;
    const g = ctx.createRadialGradient(x, y, r * 0.35, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(cx, cy, cw, ch);
  } else if (style === 'pointer') {
    const s = base * 1.4;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(s * 0.28, s * 0.74);
    ctx.lineTo(s * 0.46, s * 1.12);
    ctx.lineTo(s * 0.62, s * 1.05);
    ctx.lineTo(s * 0.44, s * 0.66);
    ctx.lineTo(s * 0.72, s * 0.66);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = s * 0.06;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export default function RecorderEditor({ result, onBack }: { result: RecordingResult; onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const springRef = useRef(createZoomSpring());
  const lastTsRef = useRef(0);
  const rafRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(result.durationMs / 1000);
  const [time, setTime] = useState(0);
  const [autoZoom, setAutoZoom] = useState(true);
  const [zoomScale, setZoomScale] = useState(2);
  const [zoomDur, setZoomDur] = useState(2.2);
  const [bg, setBg] = useState('violet');
  const [padding, setPadding] = useState(8); // % от ширины
  const [radius, setRadius] = useState(16);
  const [cursorStyle, setCursorStyle] = useState<'off' | 'highlight' | 'spotlight' | 'pointer'>('highlight');
  const [cursorSize, setCursorSize] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);

  const telemetry = useMemo(() => samplesToTelemetry(result.cursor, result.display), [result]);

  const regions: ZoomRegion[] = useMemo(() => {
    if (!autoZoom) return [];
    return buildAutoZoomRegions({ telemetry, totalMs: result.durationMs, defaultDurationMs: zoomDur * 1000, scale: zoomScale });
  }, [autoZoom, telemetry, result.durationMs, zoomDur, zoomScale]);

  // Выходное разрешение — до 1920 по ширине с сохранением пропорций.
  const out = useMemo(() => {
    const srcW = result.width || 1920;
    const srcH = result.height || 1080;
    const maxW = 1920;
    const scale = Math.min(1, maxW / srcW);
    return { w: Math.round(srcW * scale / 2) * 2, h: Math.round(srcH * scale / 2) * 2 };
  }, [result]);

  function drawFrame(dtMs: number) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = (padding / 100) * W;
    const contentX = pad;
    const contentY = pad;
    const contentW = W - pad * 2;
    const contentH = H - pad * 2;

    // Фон.
    BACKGROUNDS.find((b) => b.id === bg)?.paint(ctx, W, H);

    // Тень + скруглённая рамка контента.
    ctx.save();
    if (bg !== 'none' && pad > 0) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = W * 0.02;
      ctx.shadowOffsetY = H * 0.012;
      ctx.fillStyle = '#000';
      roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
      ctx.fill();
    }
    ctx.restore();

    // Зум-трансформация.
    const tMs = video.currentTime * 1000;
    const tgt = zoomTargetAt(regions, tMs);
    const tf = computeZoomTransform(contentW, contentH, tgt.scale, tgt.progress, tgt.focus.cx, tgt.focus.cy);
    const cam = playing ? stepZoomSpring(springRef.current, tf, dtMs) : (resetZoomSpring(springRef.current, tf), tf);

    ctx.save();
    roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
    ctx.clip();
    ctx.translate(contentX, contentY);
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);
    try {
      ctx.drawImage(video, 0, 0, contentW, contentH);
    } catch {
      /* кадр ещё не готов */
    }
    ctx.restore();

    // Оверлей курсора (подсветка/прожектор/указатель) из телеметрии.
    if (cursorStyle !== 'off') {
      const c = cursorAt(telemetry, tMs);
      if (c) {
        const sx = contentX + cam.x + c.cx * contentW * cam.scale;
        const sy = contentY + cam.y + c.cy * contentH * cam.scale;
        ctx.save();
        roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
        ctx.clip();
        drawCursorOverlay(ctx, cursorStyle, sx, sy, W, H, cursorSize, contentX, contentY, contentW, contentH);
        ctx.restore();
      }
    }
  }

  // Цикл превью.
  useEffect(() => {
    function loop(ts: number) {
      const dt = lastTsRef.current ? ts - lastTsRef.current : 16;
      lastTsRef.current = ts;
      drawFrame(dt);
      if (videoRef.current) setTime(videoRef.current.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, bg, padding, radius, playing, cursorStyle, cursorSize, telemetry]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function seek(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    setTime(sec);
  }

  async function exportVideo() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;

    setExporting(true);
    setExportPct(0);
    video.pause();
    setPlaying(true);
    video.currentTime = 0;
    video.muted = false;

    const fps = 30;
    const canvasStream = canvas.captureStream(fps);
    // Аудио из исходного видео.
    const srcStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    const audioTracks = srcStream?.getAudioTracks() ?? [];
    const tracks: MediaStreamTrack[] = [canvasStream.getVideoTracks()[0], ...audioTracks];
    const stream = new MediaStream(tracks);

    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 20_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });

    const onTime = () => setExportPct(Math.min(99, Math.round((video.currentTime / (duration || 1)) * 100)));
    video.addEventListener('timeupdate', onTime);
    const onEnded = () => { if (rec.state !== 'inactive') rec.stop(); };
    video.addEventListener('ended', onEnded);

    rec.start(1000);
    try {
      await video.play();
    } catch {
      /* автоплей может потребовать паузы */
    }

    const blob = await done;
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('ended', onEnded);
    video.pause();
    setPlaying(false);
    video.muted = true;

    try {
      const buf = await blob.arrayBuffer();
      const saved = await window.electronAPI.recorderSaveWebm(buf);
      const base = saved.path.split(/[\\/]/).pop()!.replace(/\.webm$/i, '-edited.mp4');
      const outPath = `${dir}\\${base}`;
      const offP = window.electronAPI.onRecorderMp4Progress(() => {});
      const res = await window.electronAPI.recorderToMp4(saved.path, outPath);
      offP();
      if ('error' in res) {
        showToast('Ошибка экспорта: ' + res.error);
      } else {
        showToast('Экспортировано: ' + res.path);
        window.electronAPI.recorderReveal(res.path);
      }
    } catch (e) {
      showToast('Ошибка экспорта: ' + (e as Error).message);
    } finally {
      setExporting(false);
      setExportPct(0);
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Превью */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            width={out.w}
            height={out.h}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}
          />
          <video
            ref={videoRef}
            src={mediaUrl(result.webmPath)}
            muted
            playsInline
            style={{ display: 'none' }}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || result.durationMs / 1000)}
          />
        </div>

        {/* Панель настроек */}
        <div style={{ width: 280, borderLeft: '1px solid var(--border)', padding: 18, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 14px' }}>Настройки</h2>

          <label style={rowLabel}>
            <input type="checkbox" checked={autoZoom} onChange={(e) => setAutoZoom(e.target.checked)} /> Авто-зум к курсору
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 12px' }}>Найдено зум-сцен: {regions.length}</div>

          <Slider label={`Сила зума ${zoomScale.toFixed(1)}×`} min={1.2} max={3} step={0.1} value={zoomScale} onChange={setZoomScale} disabled={!autoZoom} />
          <Slider label={`Длительность зума ${zoomDur.toFixed(1)}с`} min={1} max={4} step={0.1} value={zoomDur} onChange={setZoomDur} disabled={!autoZoom} />

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Фон</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 12 }}>
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBg(b.id)}
                style={{ padding: '6px 4px', fontSize: 11, borderRadius: 8, cursor: 'pointer', color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: `2px solid ${bg === b.id ? 'var(--accent-green)' : 'var(--border)'}` }}
              >
                {b.label}
              </button>
            ))}
          </div>

          <Slider label={`Отступы ${padding}%`} min={0} max={18} step={1} value={padding} onChange={setPadding} />
          <Slider label={`Скругление ${radius}px`} min={0} max={48} step={1} value={radius} onChange={setRadius} />

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Курсор</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6, marginBottom: 10 }}>
            {([['off', 'Выкл'], ['highlight', 'Подсветка'], ['spotlight', 'Прожектор'], ['pointer', 'Указатель']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCursorStyle(id)}
                style={{ padding: '6px 4px', fontSize: 11, borderRadius: 8, cursor: 'pointer', color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: `2px solid ${cursorStyle === id ? 'var(--accent-green)' : 'var(--border)'}` }}
              >
                {label}
              </button>
            ))}
          </div>
          <Slider label={`Размер курсора ${cursorSize.toFixed(1)}×`} min={0.5} max={2.5} step={0.1} value={cursorSize} onChange={setCursorSize} disabled={cursorStyle === 'off'} />

          <div style={{ height: 18 }} />
          <button onClick={exportVideo} disabled={exporting} style={{ ...btnPrimary, width: '100%' }}>
            {exporting ? `Экспорт… ${exportPct}%` : 'Экспорт в MP4'}
          </button>
          <button onClick={onBack} disabled={exporting} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>Назад</button>
        </div>
      </div>

      {/* Транспорт */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={togglePlay} style={btnSecondary}>{playing ? '❚❚' : '▶'}</button>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 84 }}>
          {time.toFixed(1)} / {duration.toFixed(1)} с
        </span>
        <input type="range" min={0} max={duration} step={0.05} value={time} onChange={(e) => seek(+e.target.value)} style={{ flex: 1 }} />
      </div>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, disabled }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 10, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%' }} />
    </div>
  );
}

const rowLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
