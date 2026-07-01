import { Compositor, VideoPool } from './compositor';
import { buildFrame, activeAdjustments } from './frame';
import { useProStore } from '../store/proStore';
import type { ProDocument } from './proTypes';

// Экспорт Pulsar Pro: покадровый рендер тем же WebGL-компоновщиком (превью == экспорт),
// кадры пишутся в temp через IPC, затем FFmpeg собирает mp4 + мукс аудио.

type Progress = (phase: 'capture' | 'encode', cur: number, total: number) => void;

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
    const on = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', on);
      resolve();
    };
    v.addEventListener('seeked', on);
    v.currentTime = t;
    setTimeout(on, 1500); // защита от зависшего seek
  });
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

export async function runProExport(doc: ProDocument, onProgress: Progress): Promise<{ ok: boolean; error?: string; outPath?: string }> {
  const outPath = await window.electronAPI.proExportSavePath();
  if (!outPath) return { ok: false };

  const fps = doc.fps || 30;
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
      const drawList: { clip: (typeof items)[number]['clip']; video: HTMLVideoElement; alpha: number }[] = [];
      for (const it of items) {
        const key = it.out ? it.clip.sourceFile + '#out' : it.clip.sourceFile;
        const v = pool.get(key, it.clip.sourceFile);
        await seekTo(v, Math.max(0, it.sourceTime));
        drawList.push({ clip: it.clip, video: v, alpha: it.alpha });
      }
      comp.render(doc, drawList, activeAdjustments(doc, t));
      const blob = await canvasToBlob(canvas);
      const buf = await blob.arrayBuffer();
      await window.electronAPI.proWriteFrame(dir, i, buf);
      onProgress('capture', i + 1, total);
    }

    // Аудио-дорожки с учётом mute/solo.
    const anySolo = doc.tracks.some((tr) => tr.kind === 'audio' && tr.solo);
    const audio: { path: string; inPoint: number; duration: number; delayMs: number; volume: number }[] = [];
    for (const c of doc.clips) {
      const tr = doc.tracks.find((t) => t.id === c.trackId);
      if (!tr || tr.kind !== 'audio' || !c.sourceFile || tr.muted || (anySolo && !tr.solo)) continue;
      // Подрезаем клип под диапазон [startT, endT] и сдвигаем к его началу.
      const s0 = Math.max(c.timelineStart, startT);
      const e0 = Math.min(c.timelineStart + c.duration, endT);
      if (e0 <= s0) continue;
      audio.push({ path: c.sourceFile, inPoint: c.inPoint + (s0 - c.timelineStart), duration: e0 - s0, delayMs: (s0 - startT) * 1000, volume: 1 });
    }

    onProgress('encode', total, total);
    const res = await window.electronAPI.proEncode({ dir, fps, audio, outPath });
    if ('error' in res) return { ok: false, error: res.error };
    return { ok: true, outPath };
  } finally {
    pool.dispose();
    comp.dispose();
  }
}
