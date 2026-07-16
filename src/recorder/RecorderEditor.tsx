import { useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '../store/toastStore';
import { mediaUrl } from '../utils/media';
import type { RecordingResult } from './types';
import { buildAutoZoomRegions, computeZoomTransform, cursorAt, samplesToTelemetry, zoomTargetAt, type ZoomRegion } from './zoom/autoZoom';
import { createZoomSpring, resetZoomSpring, stepZoomSpring } from './zoom/spring';
import { ANN_COLORS, drawAnnotations, hitTest, type Annotation, type AnnKind, type Handle } from './annotations';

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

function drawCaptions(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, cw: number, ch: number, W: number) {
  const fontSize = Math.round(W * 0.026);
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const maxWidth = cw * 0.82;

  // Перенос по словам, максимум 2 строки.
  const wordsArr = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of wordsArr) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === 2) break;
    } else {
      line = test;
    }
  }
  if (lines.length < 2 && line) lines.push(line);

  const lineH = fontSize * 1.28;
  const blockH = lines.length * lineH;
  const centerX = cx + cw / 2;
  let baseY = cy + ch - fontSize * 0.9 - (lines.length - 1) * lineH;

  // Фоновая плашка.
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.35;
  let maxLineW = 0;
  for (const l of lines) maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const bx = centerX - maxLineW / 2 - padX;
  const by = baseY - fontSize - padY;
  const bw = maxLineW + padX * 2;
  const bh = blockH + padY * 2;
  ctx.beginPath();
  const r = fontSize * 0.35;
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
  ctx.arcTo(bx, by + bh, bx, by, r);
  ctx.arcTo(bx, by, bx + bw, by, r);
  ctx.fill();

  ctx.fillStyle = '#fff';
  for (const l of lines) {
    ctx.fillText(l, centerX, baseY);
    baseY += lineH;
  }
  ctx.textAlign = 'left';
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
  const [captionOn, setCaptionOn] = useState(false);
  const [captionLang, setCaptionLang] = useState('ru');
  const [transcribing, setTranscribing] = useState(false);
  const [words, setWords] = useState<{ text: string; start: number; end: number }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null);
  const [annColor, setAnnColor] = useState(ANN_COLORS[0]);
  const dragRef = useRef<{ id: string; handle: Handle; nx: number; ny: number } | null>(null);
  const exportingRef = useRef(false);

  // Грузим запись как blob-URL (same-origin): media:// кросс-origin — пятнает canvas
  // (ломает captureStream/экспорт) и мешает отрисовке кадра в скрытом <video>.
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    fetch(mediaUrl(result.editPath ?? result.webmPath))
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setSrcUrl(url);
      })
      .catch((e) => showToast('Не удалось загрузить запись: ' + (e as Error).message));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [result.editPath, result.webmPath]);

  const telemetry = useMemo(() => samplesToTelemetry(result.cursor, result.display), [result]);

  // Слова субтитров → строки (перенос по ~40 символам и по концу фразы).
  const captionLines = useMemo(() => {
    const lines: { start: number; end: number; text: string }[] = [];
    let cur: { text: string; start: number; end: number }[] = [];
    const flush = () => {
      if (!cur.length) return;
      lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ').trim() });
      cur = [];
    };
    for (const w of words) {
      cur.push(w);
      const text = cur.map((x) => x.text).join(' ');
      if (text.length >= 40 || /[.!?…]$/.test(w.text)) flush();
    }
    flush();
    return lines;
  }, [words]);

  async function transcribe() {
    setTranscribing(true);
    try {
      const res = await window.electronAPI.proTranscribe(result.webmPath, captionLang);
      if ('error' in res) {
        showToast('Распознавание недоступно: ' + res.error + ' (нужен Python + Whisper — см. Настройки)');
        return;
      }
      setWords(res.words);
      setCaptionOn(true);
      if (res.words.length === 0) showToast('Речь не распознана');
    } catch (e) {
      showToast('Ошибка распознавания: ' + (e as Error).message);
    } finally {
      setTranscribing(false);
    }
  }

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

    // Аннотации (поверх, не зумятся).
    if (annotations.length) {
      ctx.save();
      roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
      ctx.clip();
      drawAnnotations(ctx, annotations, tMs, contentX, contentY, contentW, contentH, W, selectedAnn, !exportingRef.current);
      ctx.restore();
    }

    // Субтитры (поверх, не зумятся).
    if (captionOn && captionLines.length) {
      const line = captionLines.find((l) => tMs >= l.start && tMs <= l.end + 400);
      if (line) {
        ctx.save();
        roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
        ctx.clip();
        drawCaptions(ctx, line.text, contentX, contentY, contentW, contentH, W);
        ctx.restore();
      }
    }
  }

  // Гео контента + перевод координат мыши в нормализованные (0..1) контента.
  function contentGeom() {
    const canvas = canvasRef.current!;
    const W = canvas.width;
    const H = canvas.height;
    const pad = (padding / 100) * W;
    return { W, H, cx: pad, cy: pad, cw: W - pad * 2, ch: H - pad * 2 };
  }
  function eventToNorm(e: React.MouseEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { W, H, cx, cy, cw, ch } = contentGeom();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    return { nx: (px - cx) / cw, ny: (py - cy) / ch, aspect: cw / ch };
  }

  function onCanvasDown(e: React.MouseEvent) {
    if (exporting) return;
    const { nx, ny, aspect } = eventToNorm(e);
    const tMs = (videoRef.current?.currentTime ?? 0) * 1000;
    const hit = hitTest(annotations, nx, ny, tMs, aspect);
    if (hit) {
      setSelectedAnn(hit.id);
      dragRef.current = { id: hit.id, handle: hit.handle, nx, ny };
    } else {
      setSelectedAnn(null);
    }
  }
  function onCanvasMove(e: React.MouseEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const { nx, ny } = eventToNorm(e);
    const dnx = nx - drag.nx;
    const dny = ny - drag.ny;
    drag.nx = nx;
    drag.ny = ny;
    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== drag.id) return a;
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        if (drag.handle === 'p1') return { ...a, x: clamp(nx), y: clamp(ny) };
        if (drag.handle === 'p2') return { ...a, x2: clamp(nx), y2: clamp(ny) };
        return { ...a, x: clamp(a.x + dnx), y: clamp(a.y + dny), x2: clamp(a.x2 + dnx), y2: clamp(a.y2 + dny) };
      })
    );
  }
  function onCanvasUp() {
    dragRef.current = null;
  }

  function addAnnotation(kind: AnnKind) {
    const t = (videoRef.current?.currentTime ?? 0) * 1000;
    const a: Annotation = {
      id: `a${Date.now()}`,
      kind,
      startMs: t,
      endMs: Math.min(result.durationMs, t + 3000),
      x: kind === 'text' ? 0.4 : 0.35,
      y: kind === 'text' ? 0.45 : 0.4,
      x2: 0.6,
      y2: 0.6,
      text: kind === 'text' ? 'Текст' : '',
      color: annColor,
    };
    setAnnotations((p) => [...p, a]);
    setSelectedAnn(a.id);
  }

  function updateSelected(patch: Partial<Annotation>) {
    setAnnotations((p) => p.map((a) => (a.id === selectedAnn ? { ...a, ...patch } : a)));
  }
  function deleteSelected() {
    setAnnotations((p) => p.filter((a) => a.id !== selectedAnn));
    setSelectedAnn(null);
  }

  const selAnn = annotations.find((a) => a.id === selectedAnn) ?? null;

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
  }, [regions, bg, padding, radius, playing, cursorStyle, cursorSize, telemetry, captionOn, captionLines, annotations, selectedAnn, exporting]);

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
    exportingRef.current = true;
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

    // Известная длительность (webm от MediaRecorder может не иметь корректной —
    // не опираемся на video.duration).
    const knownDur = result.durationMs / 1000 || duration || 0;
    const finish = () => { if (rec.state !== 'inactive') rec.stop(); };

    const onTime = () => {
      const t = video.currentTime;
      setExportPct(knownDur > 0 ? Math.min(99, Math.round((t / knownDur) * 100)) : 0);
      if (knownDur > 0 && t >= knownDur - 0.15) finish();
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('ended', finish);

    // Сторож зависания: если воспроизведение началось, но время не идёт ~2с — стоп.
    let lastT = -1;
    let stalls = 0;
    const watchdog = setInterval(() => {
      const t = video.currentTime;
      if (t > 0.05 && Math.abs(t - lastT) < 0.02) {
        if (++stalls >= 7) finish();
      } else {
        stalls = 0;
      }
      lastT = t;
    }, 300);
    // Жёсткий предел на случай, если воспроизведение вообще не стартовало.
    const hardStop = setTimeout(finish, Math.max(15000, knownDur * 1000 * 1.6 + 5000));

    rec.start(1000);
    try {
      await video.play();
    } catch {
      /* автоплей может потребовать паузы */
    }

    const blob = await done;
    clearInterval(watchdog);
    clearTimeout(hardStop);
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('ended', finish);
    video.pause();
    setPlaying(false);
    video.muted = true;

    if (blob.size < 2000) {
      setExporting(false);
      exportingRef.current = false;
      setExportPct(0);
      showToast('Экспорт не удался: видео не воспроизвелось. Попробуйте ещё раз.');
      return;
    }

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
      exportingRef.current = false;
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
            onMouseDown={onCanvasDown}
            onMouseMove={onCanvasMove}
            onMouseUp={onCanvasUp}
            onMouseLeave={onCanvasUp}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.4)', cursor: annotations.length ? 'crosshair' : 'default' }}
          />
          {srcUrl && (
            <video
              ref={videoRef}
              src={srcUrl}
              muted
              playsInline
              preload="auto"
              // Рендерим за кадром (не display:none — иначе браузер не отрисовывает кадры для canvas).
              style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none', left: -9999 }}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                setDuration(Number.isFinite(d) && d > 0 ? d : result.durationMs / 1000);
              }}
            />
          )}
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

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Субтитры</div>
          {words.length > 0 && (
            <label style={{ ...rowLabel, marginBottom: 8 }}>
              <input type="checkbox" checked={captionOn} onChange={(e) => setCaptionOn(e.target.checked)} /> Показывать субтитры
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={captionLang} onChange={(e) => setCaptionLang(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12 }}>
              <option value="ru">RU</option>
              <option value="en">EN</option>
              <option value="auto">Авто</option>
            </select>
            <button onClick={transcribe} disabled={transcribing} style={{ ...btnSecondary, flex: 1 }}>
              {transcribing ? 'Распознаю…' : words.length ? 'Перераспознать' : 'Распознать речь'}
            </button>
          </div>
          {words.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Слов: {words.length}</div>}

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Аннотации</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => addAnnotation('arrow')} style={{ ...btnSecondary, flex: 1, padding: '6px 4px', fontSize: 11 }}>↗ Стрелка</button>
            <button onClick={() => addAnnotation('box')} style={{ ...btnSecondary, flex: 1, padding: '6px 4px', fontSize: 11 }}>▭ Рамка</button>
            <button onClick={() => addAnnotation('text')} style={{ ...btnSecondary, flex: 1, padding: '6px 4px', fontSize: 11 }}>T Текст</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {ANN_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { setAnnColor(c); if (selAnn) updateSelected({ color: c }); }}
                style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: `2px solid ${annColor === c ? 'var(--text-primary)' : 'transparent'}` }}
              />
            ))}
          </div>
          {selAnn && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>Выбрано: {selAnn.kind === 'arrow' ? 'стрелка' : selAnn.kind === 'box' ? 'рамка' : 'текст'} — тяните на превью</div>
              {selAnn.kind === 'text' && (
                <input
                  value={selAnn.text}
                  onChange={(e) => updateSelected({ text: e.target.value })}
                  placeholder="Текст"
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12, marginBottom: 8 }}
                />
              )}
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Показ: {(selAnn.startMs / 1000).toFixed(1)}–{(selAnn.endMs / 1000).toFixed(1)}с</div>
              <input type="range" min={0} max={result.durationMs} step={100} value={selAnn.startMs} onChange={(e) => updateSelected({ startMs: Math.min(+e.target.value, selAnn.endMs - 300) })} style={{ width: '100%' }} />
              <input type="range" min={0} max={result.durationMs} step={100} value={selAnn.endMs} onChange={(e) => updateSelected({ endMs: Math.max(+e.target.value, selAnn.startMs + 300) })} style={{ width: '100%' }} />
              <button onClick={deleteSelected} style={{ ...btnSecondary, width: '100%', marginTop: 6, color: '#ff6b6b' }}>Удалить</button>
            </div>
          )}

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
