import { useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '../store/toastStore';
import { mediaUrl } from '../utils/media';
import type { RecordingResult } from './types';
import { buildAutoZoomRegions, clampTransform, computeZoomTransform, cursorAt, samplesToTelemetry, smoothTelemetry, zoomTargetAt, type ZoomRegion } from './zoom/autoZoom';
import { createZoomSpring, resetZoomSpring, stepZoomSpring } from './zoom/spring';
import { ANN_COLORS, drawAnnotations, hitTest, type Annotation, type AnnKind, type Handle } from './annotations';
import { makeClickTrackWav } from './clickTrack';

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
  const webcamVidRef = useRef<HTMLVideoElement | null>(null);
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
  const [aspect, setAspect] = useState<'src' | '16:9' | '9:16' | '1:1' | '4:3'>('src');
  const [padding, setPadding] = useState(8); // % от меньшей стороны
  const [radius, setRadius] = useState(16);
  const [cursorStyle, setCursorStyle] = useState<'off' | 'highlight' | 'spotlight' | 'pointer'>('highlight');
  const [cursorSize, setCursorSize] = useState(1);
  const [panFollow, setPanFollow] = useState(true);
  const [cursorSmoothing, setCursorSmoothing] = useState(0.5);
  const [clickPulse, setClickPulse] = useState(true);
  const [captionOn, setCaptionOn] = useState(false);
  const [captionLang, setCaptionLang] = useState('ru');
  const [transcribing, setTranscribing] = useState(false);
  const [words, setWords] = useState<{ text: string; start: number; end: number }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [camUrl, setCamUrl] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(true);
  const [camPos, setCamPos] = useState<'br' | 'bl' | 'tr' | 'tl'>('br');
  const [camShape, setCamShape] = useState<'circle' | 'rect'>('circle');
  const [camSize, setCamSize] = useState(22); // % ширины кадра
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(result.durationMs / 1000);
  const [cuts, setCuts] = useState<{ id: string; start: number; end: number }[]>([]);
  const [speed, setSpeed] = useState(1);
  const [clickSound, setClickSound] = useState(true);
  const [findingPauses, setFindingPauses] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotes, setAiNotes] = useState<{ title: string; summary: string; chapters: { t: number; label: string }[] } | null>(null);
  const [dubLang, setDubLang] = useState('en');
  const [dubBusy, setDubBusy] = useState(false);
  const [dubStage, setDubStage] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null);
  const [annColor, setAnnColor] = useState(ANN_COLORS[0]);
  const dragRef = useRef<{ id: string; handle: Handle; nx: number; ny: number } | null>(null);
  const exportingRef = useRef(false);
  const offlineRef = useRef(false);

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

  // Вебкамера (если писалась) — тоже blob-URL.
  useEffect(() => {
    const path = result.webcamEditPath ?? result.webcamPath;
    if (!path) return;
    let alive = true;
    let url: string | null = null;
    fetch(mediaUrl(path))
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setCamUrl(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [result.webcamEditPath, result.webcamPath]);

  const telemetry = useMemo(() => samplesToTelemetry(result.cursor, result.display), [result]);
  const smoothTele = useMemo(() => smoothTelemetry(telemetry, cursorSmoothing), [telemetry, cursorSmoothing]);

  // Актуальные параметры монтажа для цикла превью/энфорсмента (без пересоздания цикла).
  const editRef = useRef({ trimStart, trimEnd, cuts, speed });
  editRef.current = { trimStart, trimEnd, cuts, speed };

  // Оставшиеся сегменты (обрезка минус вырезанные куски).
  const keptSegments = useMemo(() => {
    const sorted = [...cuts].filter((c) => c.end > c.start).sort((a, b) => a.start - b.start);
    const segs: { s: number; e: number }[] = [];
    let cur = trimStart;
    for (const c of sorted) {
      const cs = Math.max(trimStart, c.start);
      const ce = Math.min(trimEnd, c.end);
      if (ce <= cur) continue;
      if (cs > cur) segs.push({ s: cur, e: Math.min(cs, trimEnd) });
      cur = Math.max(cur, ce);
      if (cur >= trimEnd) break;
    }
    if (cur < trimEnd) segs.push({ s: cur, e: trimEnd });
    return segs;
  }, [trimStart, trimEnd, cuts]);

  const editedDur = useMemo(() => keptSegments.reduce((s, g) => s + (g.e - g.s), 0) / speed, [keptSegments, speed]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

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
    return buildAutoZoomRegions({ telemetry, totalMs: result.durationMs, defaultDurationMs: zoomDur * 1000, scale: zoomScale, clicks: result.clicks });
  }, [autoZoom, telemetry, result.durationMs, result.clicks, zoomDur, zoomScale]);

  // Выходной кадр по выбранному формату (длинная сторона 1920). srcAR — пропорции записи.
  const out = useMemo(() => {
    const srcW = result.width || 1920;
    const srcH = result.height || 1080;
    const srcAR = srcW / srcH;
    const ARs: Record<string, number> = { src: srcAR, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 };
    const ar = ARs[aspect] ?? srcAR;
    let w: number;
    let h: number;
    if (ar >= 1) {
      w = 1920;
      h = 1920 / ar;
    } else {
      h = 1920;
      w = 1920 * ar;
    }
    return { w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2, srcAR };
  }, [result, aspect]);

  function drawFrame(dtMs: number) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    // Кадр записи вписан в область за вычетом отступов, с сохранением пропорций записи.
    const pad = (padding / 100) * Math.min(W, H);
    const availW = W - pad * 2;
    const availH = H - pad * 2;
    let contentW = availW;
    let contentH = availW / out.srcAR;
    if (contentH > availH) {
      contentH = availH;
      contentW = availH * out.srcAR;
    }
    const contentX = (W - contentW) / 2;
    const contentY = (H - contentH) / 2;

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

    // Зум-трансформация. При включённом пан-следовании фокус внутри зум-сцены ведёт
    // за живым (сглаженным) курсором, иначе держит статичную точку зависания.
    const tMs = video.currentTime * 1000;
    const tgt = zoomTargetAt(regions, tMs);
    let fx = tgt.focus.cx;
    let fy = tgt.focus.cy;
    if (panFollow && tgt.progress > 0) {
      const live = cursorAt(smoothTele, tMs);
      if (live) {
        fx = live.cx;
        fy = live.cy;
      }
    }
    const tfRaw = computeZoomTransform(contentW, contentH, tgt.scale, tgt.progress, fx, fy);
    const tf = clampTransform(tfRaw, contentW, contentH);
    const cam = playing || offlineRef.current ? stepZoomSpring(springRef.current, tf, dtMs) : (resetZoomSpring(springRef.current, tf), tf);

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

    // Оверлей курсора (подсветка/прожектор/указатель) из сглаженной телеметрии.
    const liveCursor = cursorAt(smoothTele, tMs);
    if (cursorStyle !== 'off' && liveCursor) {
      const sx = contentX + cam.x + liveCursor.cx * contentW * cam.scale;
      const sy = contentY + cam.y + liveCursor.cy * contentH * cam.scale;
      ctx.save();
      roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
      ctx.clip();
      drawCursorOverlay(ctx, cursorStyle, sx, sy, W, H, cursorSize, contentX, contentY, contentW, contentH);
      ctx.restore();
    }

    // Пульс клика — расходящееся кольцо на реальных кликах (или на началах зум-сцен,
    // если кликов нет — фолбэк).
    if (clickPulse) {
      const PULSE = 480;
      const pulseTimes = result.clicks && result.clicks.length ? result.clicks : regions.map((r) => r.startMs);
      for (const ct of pulseTimes) {
        const age = tMs - ct;
        if (age < 0 || age > PULSE) continue;
        const p = age / PULSE;
        const pc = cursorAt(smoothTele, ct);
        if (!pc) continue;
        const px = contentX + cam.x + pc.cx * contentW * cam.scale;
        const py = contentY + cam.y + pc.cy * contentH * cam.scale;
        ctx.save();
        roundRectPath(ctx, contentX, contentY, contentW, contentH, radius);
        ctx.clip();
        ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - p)})`;
        ctx.lineWidth = Math.max(2, W * 0.004 * (1 - p));
        ctx.beginPath();
        ctx.arc(px, py, W * 0.012 + p * W * 0.05, 0, Math.PI * 2);
        ctx.stroke();
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

    // Вебкамера (PiP) — поверх всего, в углу кадра.
    const camEl = webcamVidRef.current;
    if (camOn && camEl && camEl.videoWidth > 0) {
      const m = contentW * 0.03;
      const size = (camSize / 100) * contentW;
      const bx =
        camPos === 'br' || camPos === 'tr' ? contentX + contentW - m - size : contentX + m;
      const by =
        camPos === 'br' || camPos === 'bl' ? contentY + contentH - m - size : contentY + m;
      // cover-fit источника в квадрат size×size.
      const vAR = camEl.videoWidth / camEl.videoHeight;
      let sw = camEl.videoWidth;
      let sh = camEl.videoHeight;
      if (vAR > 1) sw = camEl.videoHeight;
      else sh = camEl.videoWidth;
      const sx = (camEl.videoWidth - sw) / 2;
      const sy = (camEl.videoHeight - sh) / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = size * 0.12;
      ctx.shadowOffsetY = size * 0.04;
      if (camShape === 'circle') {
        ctx.beginPath();
        ctx.arc(bx + size / 2, by + size / 2, size / 2, 0, Math.PI * 2);
      } else {
        roundRectPath(ctx, bx, by, size, size, size * 0.12);
      }
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      try {
        ctx.drawImage(camEl, sx, sy, sw, sh, bx, by, size, size);
      } catch {
        /* кадр камеры ещё не готов */
      }
      ctx.restore();
      // Обводка.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(2, size * 0.02);
      if (camShape === 'circle') {
        ctx.beginPath();
        ctx.arc(bx + size / 2, by + size / 2, size / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        roundRectPath(ctx, bx, by, size, size, size * 0.12);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Гео контента + перевод координат мыши в нормализованные (0..1) контента.
  function contentGeom() {
    const canvas = canvasRef.current!;
    const W = canvas.width;
    const H = canvas.height;
    const pad = (padding / 100) * Math.min(W, H);
    const availW = W - pad * 2;
    const availH = H - pad * 2;
    let cw = availW;
    let ch = availW / out.srcAR;
    if (ch > availH) {
      ch = availH;
      cw = availH * out.srcAR;
    }
    return { W, H, cx: (W - cw) / 2, cy: (H - ch) / 2, cw, ch };
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

  // Пропуск обрезанного/вырезанного во время воспроизведения.
  function enforcePlayback() {
    const v = videoRef.current;
    if (!v || v.paused) return;
    // Синхрон вебкамеры с основным видео.
    const cam = webcamVidRef.current;
    if (cam && Math.abs(cam.currentTime - v.currentTime) > 0.25) cam.currentTime = v.currentTime;
    const { trimStart, trimEnd, cuts } = editRef.current;
    const t = v.currentTime;
    if (t < trimStart - 0.05) {
      v.currentTime = trimStart;
      return;
    }
    const c = cuts.find((c) => t >= c.start && t < c.end - 0.03);
    if (c) {
      const dest = Math.min(c.end, trimEnd);
      if (dest >= trimEnd - 0.03) {
        v.pause();
        setPlaying(false);
      } else {
        v.currentTime = dest;
      }
      return;
    }
    if (t >= trimEnd - 0.03) {
      v.pause();
      setPlaying(false);
      v.currentTime = trimEnd;
    }
  }

  // Цикл превью.
  useEffect(() => {
    function loop(ts: number) {
      // Во время покадрового экспорта цикл не рисует — кадрами управляет exportOffline
      // (иначе wallclock-шаг ломает пружину зума).
      if (offlineRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const dt = lastTsRef.current ? ts - lastTsRef.current : 16;
      lastTsRef.current = ts;
      enforcePlayback();
      drawFrame(dt);
      if (videoRef.current) setTime(videoRef.current.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, bg, padding, radius, playing, cursorStyle, cursorSize, smoothTele, panFollow, clickPulse, captionOn, captionLines, annotations, selectedAnn, exporting, aspect, camOn, camPos, camShape, camSize, camUrl]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < trimStart || v.currentTime >= trimEnd - 0.05) v.currentTime = trimStart;
      v.playbackRate = speed;
      v.play();
      const cam = webcamVidRef.current;
      if (cam) { cam.currentTime = v.currentTime; cam.playbackRate = speed; cam.play().catch(() => {}); }
      setPlaying(true);
    } else {
      v.pause();
      webcamVidRef.current?.pause();
      setPlaying(false);
    }
  }

  function seek(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(trimStart, Math.min(trimEnd, sec));
    v.currentTime = clamped;
    if (webcamVidRef.current) webcamVidRef.current.currentTime = clamped;
    setTime(clamped);
  }

  // Авто-удаление длинных пауз (тишины) по пикам аудио → добавляем в вырезанное.
  async function removePauses() {
    setFindingPauses(true);
    try {
      const wf = await window.electronAPI.waveform(result.editPath ?? result.webmPath);
      if (!wf || !wf.peaks.length) {
        showToast('Не удалось проанализировать аудио (возможно, запись без звука)');
        return;
      }
      const per = wf.peaks.length / wf.duration; // пиков в секунду
      const THR = 0.03;
      const MIN_SILENCE = 1.2;
      const newCuts: { id: string; start: number; end: number }[] = [];
      let runStart = -1;
      for (let i = 0; i < wf.peaks.length; i++) {
        const quiet = wf.peaks[i] < THR;
        if (quiet && runStart < 0) runStart = i;
        if ((!quiet || i === wf.peaks.length - 1) && runStart >= 0) {
          const s = runStart / per;
          const e = i / per;
          if (e - s >= MIN_SILENCE) newCuts.push({ id: `c${Date.now()}_${i}`, start: s + 0.15, end: e - 0.15 });
          runStart = -1;
        }
      }
      if (!newCuts.length) {
        showToast('Длинных пауз не найдено');
        return;
      }
      setCuts((p) => [...p, ...newCuts]);
      showToast(`Вырезано пауз: ${newCuts.length}`);
    } catch (e) {
      showToast('Ошибка анализа: ' + (e as Error).message);
    } finally {
      setFindingPauses(false);
    }
  }

  function cutHere() {
    // Вырезать 1с вокруг плейхеда (быстрый разрез).
    const t = videoRef.current?.currentTime ?? 0;
    const s = Math.max(trimStart, t - 0.5);
    const e = Math.min(trimEnd, t + 0.5);
    if (e > s) setCuts((p) => [...p, { id: `c${Date.now()}`, start: s, end: e }]);
  }

  // Умная чистка речи: вырезать слова-паразиты по транскрипту (локально).
  function smartClean() {
    if (!words.length) {
      showToast('Сначала распознайте речь (раздел «Субтитры»)');
      return;
    }
    const fillers = new Set(['э', 'эм', 'ээ', 'эээ', 'мм', 'ммм', 'ну', 'вот', 'аа', 'ааа', 'типа', 'um', 'uh', 'uhh', 'erm', 'hmm', 'like']);
    const added: { id: string; start: number; end: number }[] = [];
    for (const w of words) {
      const t = w.text.toLowerCase().replace(/[^\p{L}]/gu, '');
      if (t && fillers.has(t)) added.push({ id: `f${w.start}`, start: w.start / 1000 - 0.04, end: w.end / 1000 + 0.06 });
    }
    if (!added.length) {
      showToast('Слов-паразитов не найдено');
      return;
    }
    setCuts((p) => [...p, ...added]);
    showToast(`Вырезано слов-паразитов: ${added.length}`);
  }

  // Дубляж записи на другой язык (переиспользуем модуль dub).
  async function dubRecording() {
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    setDubBusy(true);
    setDubStage('старт…');
    const off = window.electronAPI.onDubProgress((e) => setDubStage(`${e.stage} ${e.percent}%`));
    try {
      const res = await window.electronAPI.dubRun({
        videoPath: result.editPath ?? result.webmPath,
        sourceLang: 'auto',
        targetLang: dubLang,
        keepOriginal: true,
        originalVolume: 0.12,
        syncTiming: true,
        burnSubs: false,
        outputDir: dir,
      });
      if ('error' in res) {
        showToast('Дубляж не удался: ' + res.error);
      } else {
        showToast('Дубляж готов: ' + res.out);
        window.electronAPI.recorderReveal(res.out);
      }
    } catch (e) {
      showToast('Ошибка дубляжа: ' + (e as Error).message);
    } finally {
      off();
      setDubBusy(false);
      setDubStage('');
    }
  }

  async function aiGenerate() {
    if (!captionLines.length) {
      showToast('Сначала распознайте речь (раздел «Субтитры»)');
      return;
    }
    setAiBusy(true);
    try {
      const transcript = captionLines.map((l) => `[${(l.start / 1000).toFixed(0)}s] ${l.text}`).join('\n');
      const res = await window.electronAPI.recorderAiNotes(transcript);
      if ('error' in res) {
        showToast('AI недоступен: ' + res.error);
        return;
      }
      setAiNotes({ title: res.title, summary: res.summary, chapters: res.chapters });
    } catch (e) {
      showToast('Ошибка AI: ' + (e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  function resetEdit() {
    setTrimStart(0);
    setTrimEnd(duration);
    setCuts([]);
    setSpeed(1);
  }

  // Покадровый (детерминированный) экспорт в MP4/GIF через ffmpeg. Быстрее и точнее
  // реалтайма, честно учитывает обрезку/вырезки/скорость/зум.
  async function exportOffline(format: 'mp4' | 'gif') {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;

    const seekAwait = (v: HTMLVideoElement, t: number) =>
      new Promise<void>((res) => {
        let done = false;
        const fin = () => {
          if (done) return;
          done = true;
          v.removeEventListener('seeked', fin);
          res();
        };
        v.addEventListener('seeked', fin);
        v.currentTime = t;
        setTimeout(fin, 400);
      });
    const grabJpeg = () =>
      new Promise<ArrayBuffer>((res, rej) => {
        canvas.toBlob(
          (b) => (b ? b.arrayBuffer().then(res) : rej(new Error('toBlob null'))),
          'image/jpeg',
          0.92
        );
      });
    const mapToSource = (outTime: number) => {
      let pos = outTime * speed;
      for (const seg of keptSegments) {
        const len = seg.e - seg.s;
        if (pos <= len) return seg.s + pos;
        pos -= len;
      }
      return trimEnd;
    };

    setExporting(true);
    exportingRef.current = true;
    offlineRef.current = true;
    setExportPct(0);
    video.pause();
    webcamVidRef.current?.pause();
    setPlaying(false);
    resetZoomSpring(springRef.current, { scale: 1, x: 0, y: 0 });

    const offEnc = window.electronAPI.onRecorderEncodeProgress((p) => setExportPct(p));
    try {
      const fps = 30;
      const frameCount = Math.max(1, Math.round(editedDur * fps));
      const frameDir = await window.electronAPI.proExportDir();
      const cam = webcamVidRef.current;
      for (let i = 0; i < frameCount; i++) {
        const src = mapToSource(i / fps);
        await seekAwait(video, src);
        if (cam && camOn) await seekAwait(cam, src);
        drawFrame(1000 / fps);
        const buf = await grabJpeg();
        await window.electronAPI.proWriteFrame(frameDir, i, buf);
        if (i % 3 === 0) setExportPct(Math.round((i / frameCount) * 80));
      }
      // Клик-дорожка (звук клика) — позиции кликов в выходном таймлайне.
      let clickTrackPath: string | undefined;
      if (format === 'mp4' && clickSound && result.clicks && result.clicks.length) {
        const outTimes: number[] = [];
        for (const ms of result.clicks) {
          const src = ms / 1000;
          if (src < trimStart || src > trimEnd) continue;
          let acc = 0;
          let mapped: number | null = null;
          for (const seg of keptSegments) {
            if (src < seg.s) break;
            if (src <= seg.e) {
              mapped = (acc + (src - seg.s)) / speed;
              break;
            }
            acc += seg.e - seg.s;
          }
          if (mapped != null) outTimes.push(mapped);
        }
        if (outTimes.length) {
          try {
            const wav = await makeClickTrackWav(outTimes, editedDur);
            clickTrackPath = await window.electronAPI.recorderWriteTempWav(wav);
          } catch {
            /* без звука клика */
          }
        }
      }
      const base = result.editPath ? result.editPath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '') : 'recording';
      const outPath = `${dir}\\${base}-export.${format}`;
      const res = await window.electronAPI.recorderEncodeFrames({
        dir: frameDir,
        fps,
        format,
        audioSrc: format === 'mp4' ? result.editPath : undefined,
        clickTrackPath,
        segments: keptSegments,
        speed,
        frameCount,
        outPath,
      });
      if ('error' in res) {
        showToast('Ошибка экспорта: ' + res.error);
      } else {
        showToast('Готово: ' + res.path);
        window.electronAPI.recorderReveal(res.path);
      }
    } catch (e) {
      showToast('Ошибка экспорта: ' + (e as Error).message);
    } finally {
      offEnc();
      offlineRef.current = false;
      exportingRef.current = false;
      setExporting(false);
      setExportPct(0);
    }
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
    video.currentTime = trimStart;
    video.playbackRate = speed;
    video.muted = false;
    const camV = webcamVidRef.current;
    if (camV && camOn) {
      camV.currentTime = trimStart;
      camV.playbackRate = speed;
      camV.muted = true;
      camV.play().catch(() => {});
    }

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

    // Прогресс по позиции внутри диапазона обрезки (вырезки/скорость учитывает
    // enforcePlayback: он же поставит на паузу в trimEnd). video.duration ненадёжен.
    const span = Math.max(0.1, trimEnd - trimStart);
    const finish = () => { if (rec.state !== 'inactive') rec.stop(); };

    const onTime = () => {
      const t = video.currentTime;
      setExportPct(Math.min(99, Math.max(0, Math.round(((t - trimStart) / span) * 100))));
      if (t >= trimEnd - 0.12) finish();
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
    const hardStop = setTimeout(finish, Math.max(15000, (span / speed) * 1000 * 1.6 + 8000));

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
    webcamVidRef.current?.pause();
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
                const raw = e.currentTarget.duration;
                const d = Number.isFinite(raw) && raw > 0 ? raw : result.durationMs / 1000;
                setDuration(d);
                // Подтянуть правую границу обрезки, если её ещё не двигали.
                setTrimEnd((prev) => (Math.abs(prev - result.durationMs / 1000) < 0.5 ? d : prev));
              }}
            />
          )}
          {camUrl && (
            <video
              ref={webcamVidRef}
              src={camUrl}
              muted
              playsInline
              preload="auto"
              style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none', left: -9999 }}
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
          <label style={{ ...rowLabel, marginBottom: 6 }}>
            <input type="checkbox" checked={panFollow} onChange={(e) => setPanFollow(e.target.checked)} disabled={!autoZoom} /> Камера ведёт за курсором
          </label>
          <label style={{ ...rowLabel, marginBottom: 8 }}>
            <input type="checkbox" checked={clickPulse} onChange={(e) => setClickPulse(e.target.checked)} disabled={!autoZoom} /> Пульс на кликах
          </label>
          <Slider label={`Сглаживание курсора ${Math.round(cursorSmoothing * 100)}%`} min={0} max={1} step={0.05} value={cursorSmoothing} onChange={setCursorSmoothing} />

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Монтаж</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Итог: {editedDur.toFixed(1)}с{cuts.length ? ` · вырезано ${cuts.length}` : ''}
          </div>
          <Slider label={`Скорость ${speed.toFixed(1)}×`} min={0.5} max={4} step={0.1} value={speed} onChange={setSpeed} />
          <label style={{ ...rowLabel, marginBottom: 8 }}>
            <input type="checkbox" checked={clickSound} onChange={(e) => setClickSound(e.target.checked)} /> Звук клика при экспорте
          </label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={removePauses} disabled={findingPauses} style={{ ...btnSecondary, flex: 1, fontSize: 11.5 }}>
              {findingPauses ? 'Анализ…' : 'Убрать паузы'}
            </button>
            <button onClick={cutHere} style={{ ...btnSecondary, fontSize: 11.5 }} title="Вырезать ~1с у ползунка">✂ Разрез</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={() => setTrimStart(Math.min(time, trimEnd - 0.3))} style={{ ...btnSecondary, flex: 1, fontSize: 11.5 }} title="Обрезать начало до ползунка">⟤ Начало</button>
            <button onClick={() => setTrimEnd(Math.max(time, trimStart + 0.3))} style={{ ...btnSecondary, flex: 1, fontSize: 11.5 }} title="Обрезать конец до ползунка">Конец ⟥</button>
          </div>
          {(cuts.length > 0 || trimStart > 0 || trimEnd < duration - 0.05 || speed !== 1) && (
            <button onClick={resetEdit} style={{ ...btnSecondary, width: '100%', fontSize: 11.5 }}>Сбросить монтаж</button>
          )}

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>AI</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={smartClean} style={{ ...btnSecondary, flex: 1, fontSize: 11.5 }} title="Вырезать слова-паразиты по транскрипту">Чистка речи</button>
            <button onClick={aiGenerate} disabled={aiBusy} style={{ ...btnSecondary, flex: 1, fontSize: 11.5 }}>{aiBusy ? 'AI…' : 'Заголовок и главы'}</button>
          </div>
          {aiNotes && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', marginBottom: 6 }}>
              {aiNotes.title && <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{aiNotes.title}</div>}
              {aiNotes.summary && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.4 }}>{aiNotes.summary}</div>}
              {aiNotes.chapters.map((c, i) => (
                <button key={i} onClick={() => seek(c.t)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--accent-green)', fontSize: 11.5, cursor: 'pointer', padding: '2px 0' }}>
                  {Math.floor(c.t / 60)}:{String(Math.floor(c.t % 60)).padStart(2, '0')} — {c.label}
                </button>
              ))}
              <button
                onClick={() => {
                  const txt = `${aiNotes.title}\n\n${aiNotes.summary}\n\n${aiNotes.chapters.map((c) => `${Math.floor(c.t / 60)}:${String(Math.floor(c.t % 60)).padStart(2, '0')} ${c.label}`).join('\n')}`;
                  navigator.clipboard?.writeText(txt);
                  showToast('Скопировано');
                }}
                style={{ ...btnSecondary, width: '100%', fontSize: 11, marginTop: 6 }}
              >
                Копировать описание
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <select value={dubLang} onChange={(e) => setDubLang(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12 }}>
              <option value="en">EN</option>
              <option value="es">ES</option>
              <option value="de">DE</option>
              <option value="fr">FR</option>
              <option value="zh">ZH</option>
              <option value="ar">AR</option>
              <option value="ru">RU</option>
            </select>
            <button onClick={dubRecording} disabled={dubBusy} style={{ ...btnSecondary, flex: 1, fontSize: 11.5 }}>
              {dubBusy ? (dubStage || 'Дубляж…') : 'Дубляж на язык'}
            </button>
          </div>

          <div style={{ height: 12 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Формат</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5, marginBottom: 12 }}>
            {([['src', 'Ориг'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:3', '4:3']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAspect(id)}
                style={{ padding: '6px 2px', fontSize: 10.5, borderRadius: 7, cursor: 'pointer', color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: `2px solid ${aspect === id ? 'var(--accent-green)' : 'var(--border)'}` }}
              >
                {label}
              </button>
            ))}
          </div>
          {camUrl && (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>Вебкамера</div>
              <label style={{ ...rowLabel, marginBottom: 8 }}>
                <input type="checkbox" checked={camOn} onChange={(e) => setCamOn(e.target.checked)} /> Показывать камеру
              </label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                {([['circle', '● Круг'], ['rect', '▢ Квадрат']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setCamShape(id)} disabled={!camOn} style={{ ...btnSecondary, flex: 1, fontSize: 11, opacity: camOn ? 1 : 0.5 }}>{label}</button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 6 }}>
                {([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setCamPos(id)} disabled={!camOn} style={{ padding: '5px 2px', fontSize: 13, borderRadius: 7, cursor: 'pointer', color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: `2px solid ${camPos === id ? 'var(--accent-green)' : 'var(--border)'}`, opacity: camOn ? 1 : 0.5 }}>{label}</button>
                ))}
              </div>
              <Slider label={`Размер камеры ${camSize}%`} min={12} max={40} step={1} value={camSize} onChange={setCamSize} disabled={!camOn} />
              <div style={{ height: 12 }} />
            </>
          )}
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
          <button onClick={() => exportOffline('mp4')} disabled={exporting} style={{ ...btnPrimary, width: '100%' }}>
            {exporting ? `Экспорт… ${exportPct}%` : 'Экспорт в MP4'}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => exportOffline('gif')} disabled={exporting} style={{ ...btnSecondary, flex: 1 }}>GIF</button>
            <button onClick={exportVideo} disabled={exporting} style={{ ...btnSecondary, flex: 1 }} title="Реалтайм-захват (запасной способ)">Реалтайм</button>
          </div>
          <button onClick={onBack} disabled={exporting} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>Назад</button>
        </div>
      </div>

      {/* Транспорт + таймлайн монтажа */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={togglePlay} style={btnSecondary}>{playing ? '❚❚' : '▶'}</button>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 84 }}>
          {time.toFixed(1)} / {duration.toFixed(1)} с
        </span>
        <Timeline
          duration={duration}
          time={time}
          trimStart={trimStart}
          trimEnd={trimEnd}
          cuts={cuts}
          onSeek={seek}
          onTrimStart={(v) => setTrimStart(Math.max(0, Math.min(v, trimEnd - 0.3)))}
          onTrimEnd={(v) => setTrimEnd(Math.min(duration, Math.max(v, trimStart + 0.3)))}
        />
      </div>
    </div>
  );
}

// Таймлайн монтажа: клик — перемотка, синие ручки — обрезка начала/конца,
// красные блоки — вырезанные куски, белая линия — плейхед.
function Timeline({
  duration, time, trimStart, trimEnd, cuts, onSeek, onTrimStart, onTrimEnd,
}: {
  duration: number; time: number; trimStart: number; trimEnd: number;
  cuts: { id: string; start: number; end: number }[];
  onSeek: (v: number) => void; onTrimStart: (v: number) => void; onTrimEnd: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<'l' | 'r' | null>(null);
  const pct = (t: number) => `${(duration > 0 ? t / duration : 0) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const onDown = (e: React.PointerEvent, which: 'l' | 'r') => {
    e.stopPropagation();
    dragRef.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const t = timeAt(e.clientX);
    if (dragRef.current === 'l') onTrimStart(t);
    else onTrimEnd(t);
  };
  const onUp = () => { dragRef.current = null; };

  const handle: React.CSSProperties = {
    position: 'absolute', top: -3, width: 10, height: 40, marginLeft: -5, borderRadius: 4,
    background: '#0a84ff', cursor: 'ew-resize', boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
  };
  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onClick={(e) => onSeek(timeAt(e.clientX))}
      style={{ position: 'relative', flex: 1, height: 34, background: 'var(--bg-tertiary)', borderRadius: 8, cursor: 'pointer' }}
    >
      {/* Затемнение обрезанных концов */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(trimStart), background: 'rgba(0,0,0,0.5)', borderRadius: '8px 0 0 8px' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(1 - (duration > 0 ? trimEnd / duration : 1)) * 100}%`, background: 'rgba(0,0,0,0.5)', borderRadius: '0 8px 8px 0' }} />
      {/* Вырезанные куски */}
      {cuts.map((c) => (
        <div key={c.id} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(c.start), width: pct(c.end - c.start), background: 'rgba(255,59,48,0.5)' }} />
      ))}
      {/* Плейхед */}
      <div style={{ position: 'absolute', top: -2, bottom: -2, left: pct(time), width: 2, background: '#fff', pointerEvents: 'none' }} />
      {/* Ручки обрезки */}
      <div style={{ ...handle, left: pct(trimStart) }} onPointerDown={(e) => onDown(e, 'l')} onClick={(e) => e.stopPropagation()} />
      <div style={{ ...handle, left: pct(trimEnd) }} onPointerDown={(e) => onDown(e, 'r')} onClick={(e) => e.stopPropagation()} />
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
