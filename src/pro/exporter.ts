import { Compositor, VideoPool } from './compositor';
import { buildFrame, activeAdjustments, activeTexts } from './frame';
import { useProStore } from '../store/proStore';
import { DEFAULT_AUDIO, DEFAULT_TEXT, fontCss, textOpacityAt, type ProClip, type ProDocument } from './proTypes';

function drawTexts(ctx: CanvasRenderingContext2D, doc: ProDocument, texts: ProClip[], ph: number) {
  for (const c of texts) {
    const tt = { ...DEFAULT_TEXT, ...c.text };
    const fs = (doc.height * tt.size) / 100;
    const lh = (tt.lineHeight ?? 1.15) * fs;
    const align = tt.align ?? 'center';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = `${tt.italic ? 'italic ' : ''}${tt.bold ? 800 : 400} ${fs}px ${fontCss(tt.font)}`;
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${((tt.letterSpacing ?? 0) * doc.height) / 100}px`;
    ctx.globalAlpha = textOpacityAt(tt, ph - c.timelineStart, c.duration);
    const x = tt.x * doc.width;
    const y = tt.y * doc.height;
    const lines = tt.content.split('\n');
    if (tt.bg) {
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const bx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
      ctx.fillStyle = tt.bgColor ?? '#000000';
      ctx.fillRect(bx - 12, y - (lines.length * lh) / 2 - 4, w + 24, lines.length * lh + 8);
    }
    const ow = ((tt.outline ?? 0) * doc.height) / 100;
    lines.forEach((ln, i) => {
      const ly = y + (i - (lines.length - 1) / 2) * lh;
      if (tt.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; } else { ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
      if (ow > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = ow * 2; ctx.strokeStyle = tt.outlineColor ?? '#000000'; ctx.strokeText(ln, x, ly); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
      ctx.fillStyle = tt.color;
      ctx.fillText(ln, x, ly);
    });
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  }
}

// Экспорт Pulsar Pro: покадровый рендер тем же WebGL-компоновщиком (превью == экспорт),
// кадры пишутся в temp через IPC, затем FFmpeg собирает mp4 + мукс аудио.

type Progress = (phase: 'capture' | 'encode', cur: number, total: number) => void;

export interface ExportSettings {
  format: 'mp4' | 'mov';
  codec: 'libx264' | 'libx265';
  videoBitrateMbps: number;
  fps: number;
  audioBitrateK: number;
}

function waitReady(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (v.readyState >= 1) return resolve();
    const done = () => {
      v.removeEventListener('loadedmetadata', done);
      v.removeEventListener('error', done);
      resolve();
    };
    v.addEventListener('loadedmetadata', done, { once: true });
    v.addEventListener('error', done, { once: true });
  });
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return resolve();
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const on = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeEventListener('seeked', on);
      resolve();
    };
    v.addEventListener('seeked', on);
    v.currentTime = t;
    timer = setTimeout(on, 1500); // защита от зависшего seek
  });
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  // JPEG — быстрее и компактнее PNG для экспорта кадров.
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92));
}

export async function runProExport(doc: ProDocument, onProgress: Progress, settings: ExportSettings): Promise<{ ok: boolean; error?: string; outPath?: string }> {
  const outPath = await window.electronAPI.proExportSavePath(settings.format);
  if (!outPath) return { ok: false };

  const fps = settings.fps || doc.fps || 30;
  const contentEnd = doc.clips.reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);
  if (contentEnd <= 0) return { ok: false, error: 'Пустой таймлайн' };
  // Область экспорта (in/out) — иначе весь таймлайн.
  const rng = useProStore.getState();
  const startT = rng.exportIn ?? 0;
  const endT = rng.exportOut ?? contentEnd;
  if (endT <= startT) return { ok: false, error: 'Пустой диапазон экспорта' };
  const total = Math.max(1, Math.ceil((endT - startT) * fps));

  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const comp = new Compositor(canvas, { preserveDrawingBuffer: true });
  const pool = new VideoPool();
  // 2D-канвас для наложения текста поверх кадра.
  const canvas2d = document.createElement('canvas');
  canvas2d.width = doc.width;
  canvas2d.height = doc.height;
  const ctx2d = canvas2d.getContext('2d');

  try {
    // Предзагрузка видео-источников.
    const videoSources = new Set<string>();
    for (const c of doc.clips) {
      const tr = doc.tracks.find((t) => t.id === c.trackId);
      if (tr && tr.kind === 'video' && !tr.isAdjustment && c.sourceFile) videoSources.add(c.sourceFile);
    }
    await Promise.all([...videoSources].map((src) => waitReady(pool.get(src))));

    const dir = await window.electronAPI.proExportDir();

    for (let i = 0; i < total; i++) {
      const t = startT + i / fps;
      const items = buildFrame(doc, t);
      const drawList: { clip: (typeof items)[number]['clip']; video: HTMLVideoElement; alpha: number; color?: (typeof items)[number]['clip']['color']; blend?: (typeof items)[number]['clip']['blend']; xf?: (typeof items)[number]['xf'] }[] = [];
      for (const it of items) {
        const key = it.out ? it.clip.sourceFile + '#out' : it.clip.sourceFile;
        const v = pool.get(key, it.clip.sourceFile);
        await seekTo(v, Math.max(0, it.sourceTime));
        drawList.push({ clip: it.clip, video: v, alpha: it.alpha, color: it.clip.color, blend: it.clip.blend, xf: it.xf });
      }
      comp.render(doc, drawList, activeAdjustments(doc, t));
      const texts = activeTexts(doc, t);
      let outCanvas = canvas;
      if (texts.length && ctx2d) {
        ctx2d.clearRect(0, 0, doc.width, doc.height);
        ctx2d.drawImage(canvas, 0, 0);
        drawTexts(ctx2d, doc, texts, t);
        outCanvas = canvas2d;
      }
      const blob = await canvasToBlob(outCanvas);
      const buf = await blob.arrayBuffer();
      await window.electronAPI.proWriteFrame(dir, i, buf);
      onProgress('capture', i + 1, total);
    }

    // Аудио-дорожки с учётом mute/solo.
    const anySolo = doc.tracks.some((tr) => tr.kind === 'audio' && tr.solo);
    const audio: { path: string; inPoint: number; duration: number; delayMs: number; volumeDb: number; pitch: number; fadeIn: number; fadeOut: number; speed: number }[] = [];
    for (const c of doc.clips) {
      const tr = doc.tracks.find((t) => t.id === c.trackId);
      if (!tr || tr.kind !== 'audio' || !c.sourceFile || tr.muted || (anySolo && !tr.solo)) continue;
      const s0 = Math.max(c.timelineStart, startT);
      const e0 = Math.min(c.timelineStart + c.duration, endT);
      if (e0 <= s0) continue;
      const a = { ...DEFAULT_AUDIO, ...c.audio };
      const sp = c.speed || 1;
      audio.push({ path: c.sourceFile, inPoint: c.inPoint + (s0 - c.timelineStart) * sp, duration: e0 - s0, delayMs: (s0 - startT) * 1000, volumeDb: a.volumeDb, pitch: a.pitch, fadeIn: a.fadeIn, fadeOut: a.fadeOut, speed: sp });
    }

    onProgress('encode', total, total);
    const res = await window.electronAPI.proEncode({ dir, fps, audio, outPath, codec: settings.codec, videoBitrateMbps: settings.videoBitrateMbps, audioBitrateK: settings.audioBitrateK });
    if ('error' in res) return { ok: false, error: res.error };
    return { ok: true, outPath };
  } finally {
    pool.dispose();
    comp.dispose();
  }
}
