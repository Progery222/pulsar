import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcribe } from './transcribe';
import { getAssemblyKey } from './config';
import { runSynth } from './tts';
import { videoEncoderOptions } from './encoder';
import type { TranscriptWord } from '../../src/vub/types';

const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

interface DubRequest {
  videoPath: string;
  sourceLang: string; // 'auto' | 'ru' | ...
  targetLang: string;
  voice?: string;
  keepOriginal: boolean;
  originalVolume: number; // 0..1
  syncTiming?: boolean; // подгонять длину фраз под исходные тайминги
  outputDir: string;
}

interface Segment {
  start: number; // мс
  end: number;
  text: string;
}

function py(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}
function scriptPath(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', name)
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', name);
}
function progress(stage: string, percent: number) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('dub-progress', { stage, percent }));
}

// Слова → сегменты (по концу предложения или паузе/длине).
function groupSegments(words: TranscriptWord[]): Segment[] {
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  for (const w of words) {
    if (!cur) cur = { start: w.start, end: w.end, text: w.text };
    else {
      cur.text += ' ' + w.text;
      cur.end = w.end;
    }
    const endsSentence = /[.!?…]$/.test(w.text);
    if (endsSentence || cur.end - cur.start > 6000) {
      segs.push(cur);
      cur = null;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

// Пакетный перевод через translate.py.
function translateBatch(texts: string[], src: string, tgt: string): Promise<string[] | { error: string }> {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `pulsar_tr_${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(texts), 'utf-8');
    const child = spawn(py(), [scriptPath('translate.py'), '--in', tmp, '--src', src, '--tgt', tgt]);
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', (e) => {
      fs.promises.unlink(tmp).catch(() => {});
      resolve({ error: e.message });
    });
    child.on('close', () => {
      fs.promises.unlink(tmp).catch(() => {});
      try {
        const r = JSON.parse(out.trim());
        resolve(r.ok ? (r.texts as string[]) : { error: r.error || 'Ошибка перевода' });
      } catch {
        resolve({ error: err.trim() || 'translate.py недоступен' });
      }
    });
  });
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (e, d) => resolve(e || !d ? 0 : (d.format?.duration ?? 0)));
  });
}

// Цепочка atempo для ускорения в factor раз (atempo поддерживает 0.5..2.0 — чейним).
function atempoChain(factor: number): string {
  let f = Math.min(4, Math.max(1, factor));
  const parts: string[] = [];
  while (f > 2) {
    parts.push('atempo=2.0');
    f /= 2;
  }
  parts.push(`atempo=${f.toFixed(3)}`);
  return parts.join(',');
}

interface DubClip {
  file: string;
  startMs: number;
  targetMs: number; // длительность исходного сегмента (для синхронизации)
}

// Собрать дублированную дорожку: синхронизация длины (atempo) + расстановка по start (adelay) + amix.
async function buildDub(video: string, clips: DubClip[], out: string, keepOriginal: boolean, origVol: number, syncTiming: boolean): Promise<{ ok: true } | { error: string }> {
  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 });

  // Подгонка: если озвучка длиннее слота — ускоряем, чтобы не наезжала на следующую фразу.
  const factors: number[] = [];
  for (const c of clips) {
    if (syncTiming && c.targetMs > 200) {
      const durMs = (await probeDuration(c.file)) * 1000;
      factors.push(durMs > c.targetMs * 1.05 ? durMs / c.targetMs : 1);
    } else {
      factors.push(1);
    }
  }

  return new Promise((resolve) => {
    const cmd = ffmpeg(video);
    clips.forEach((c) => cmd.input(c.file));

    const filters: string[] = [];
    const labels: string[] = [];
    clips.forEach((c, i) => {
      const idx = i + 1; // 0 — видео
      const tempo = factors[i] > 1.01 ? `${atempoChain(factors[i])},` : '';
      filters.push(`[${idx}:a]${tempo}adelay=${Math.round(c.startMs)}:all=1[d${i}]`);
      labels.push(`[d${i}]`);
    });

    if (keepOriginal) {
      filters.push(`[0:a]volume=${origVol.toFixed(2)}[orig]`);
      filters.push(`[orig]${labels.join('')}amix=inputs=${labels.length + 1}:normalize=0[aout]`);
    } else {
      filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0[aout]`);
    }

    cmd
      .complexFilter(filters)
      .outputOptions('-map', '0:v:0', '-map', '[aout]')
      .outputOptions(venc)
      .outputOptions('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart')
      .output(out)
      .on('end', () => resolve({ ok: true }))
      .on('error', (e) => resolve({ error: e.message }))
      .run();
  });
}

export function registerDubHandlers() {
  ipcMain.handle('dub:run', async (_e, req: DubRequest) => {
    const key = getAssemblyKey();
    if (!key) return { error: 'Не задан ключ AssemblyAI (Настройки). Он нужен для распознавания речи.' };

    const tmpClips: string[] = [];
    try {
      progress('Распознавание речи…', 5);
      const words = await transcribe(req.videoPath, key, req.sourceLang);
      if (!words.length) return { error: 'Речь не распознана (нет голоса или только музыка).' };

      const segs = groupSegments(words);
      progress('Перевод…', 25);
      const translated = await translateBatch(segs.map((s) => s.text), req.sourceLang, req.targetLang);
      if ('error' in translated) return translated;

      // Озвучка каждого сегмента переведённым текстом.
      const clips: DubClip[] = [];
      for (let i = 0; i < segs.length; i++) {
        const txt = (translated[i] || '').trim();
        if (!txt) continue;
        const f = path.join(os.tmpdir(), `pulsar_dub_${Date.now()}_${i}.mp3`);
        const r = await runSynth(txt, f, req.targetLang, 'edge', 1, req.voice || '');
        if ('error' in r) return r;
        tmpClips.push(f);
        clips.push({ file: f, startMs: segs[i].start, targetMs: segs[i].end - segs[i].start });
        progress(`Озвучка ${i + 1}/${segs.length}…`, 30 + Math.round((i / segs.length) * 55));
      }
      if (!clips.length) return { error: 'Не удалось озвучить ни одного сегмента.' };

      progress('Склейка с видео…', 90);
      const sep = req.outputDir.includes('\\') ? '\\' : '/';
      const baseName = (req.videoPath.split(/[\\/]/).pop() || 'video').replace(/\.[^.]+$/, '');
      const out = `${req.outputDir}${sep}${baseName}_dub_${req.targetLang}.mp4`;
      const m = await buildDub(req.videoPath, clips, out, req.keepOriginal, req.originalVolume, req.syncTiming !== false);
      if ('error' in m) return m;

      progress('Готово', 100);
      return { ok: true, out };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      for (const f of tmpClips) fs.promises.unlink(f).catch(() => {});
    }
  });
}
