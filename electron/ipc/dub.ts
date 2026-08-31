import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcribe, transcribeWhisper } from './transcribe';
import { getAssemblyKey } from './config';
import { runSynthBatch, type SynthOpts } from './tts';
import { isOmniVoiceSpec, resolveTtsEngine } from './omnivoice';
import { videoEncoderOptions } from './encoder';
import type { TranscriptWord } from '../../src/vub/types';
import { pythonCmdSync } from './python';

const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

export interface DubRequest {
  videoPath: string;
  sourceLang: string; // 'auto' | 'ru' | ...
  targetLang: string;
  voice?: string;
  keepOriginal: boolean;
  originalVolume: number; // 0..1
  syncTiming?: boolean; // подгонять длину фраз под исходные тайминги
  burnSubs?: boolean; // выжечь субтитры с переводом
  asr?: 'assemblyai' | 'whisper'; // движок распознавания речи
  engine?: string; // движок озвучки: 'auto' | 'omnivoice' | 'edge'
  cloneVoice?: boolean; // OmniVoice: клонировать голос говорящего из самого ролика (по умолчанию да)
  outputDir: string;
}

// Выбор движка распознавания: Whisper (офлайн) либо AssemblyAI (облако) с
// авто-фолбэком на Whisper, если облако недоступно или ключ не задан.
async function asrWords(videoPath: string, sourceLang: string, asr?: 'assemblyai' | 'whisper'): Promise<TranscriptWord[]> {
  if (asr !== 'whisper') {
    const key = getAssemblyKey();
    if (key) {
      try {
        return await transcribe(videoPath, key, sourceLang);
      } catch (e) {
        console.warn('[dub] AssemblyAI недоступен, фолбэк на Whisper:', e instanceof Error ? e.message : e);
      }
    }
  }
  return await transcribeWhisper(videoPath, sourceLang);
}

interface Segment {
  start: number; // мс
  end: number;
  text: string;
}

function py(): string {
  // Абсолютный путь из общего резолвера: голое 'python' на Windows ведёт
  // в заглушку Microsoft Store, которая скрипты не запускает.
  return pythonCmdSync();
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
    const child = spawn(py(), [scriptPath('translate.py'), '--in', tmp, '--src', src, '--tgt', tgt], {
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
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

function probeSize(file: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (e, d) => {
      const v = d?.streams?.find((s) => s.codec_type === 'video');
      resolve({ w: v?.width ?? 1080, h: v?.height ?? 1920 });
    });
  });
}

function fontsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'fonts')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'assets', 'fonts');
}
function escFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${p2(c)}`;
}

// Перенос текста максимум в 2 сбалансированные строки (по словам).
function twoLineWrap(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return text;
  const total = text.length;
  let line1 = '';
  let i = 0;
  for (; i < words.length; i++) {
    const cand = line1 ? `${line1} ${words[i]}` : words[i];
    if (line1 && cand.length > total / 2) break;
    line1 = cand;
  }
  const line2 = words.slice(i).join(' ');
  return line2 ? `${line1}\\N${line2}` : line1;
}

// Разбить длинную фразу на части, каждая помещается в 2 строки (≤ maxChars символов).
function chunkByChars(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && cand.length > maxChars) {
      chunks.push(cur);
      cur = w;
    } else {
      cur = cand;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

// Сборка .ass с субтитрами-переводом: максимум 2 строки, по центру чуть ниже середины.
function buildSubsAss(segs: Segment[], texts: string[], w: number, h: number): string {
  const fontSize = Math.round(h * 0.042);
  const charsPerLine = Math.max(12, Math.floor(w / (fontSize * 0.55)));
  const maxChars = charsPerLine * 2; // максимум на 2 строки
  const posX = Math.round(w / 2);
  const posY = Math.round(h * 0.58); // чуть ниже центра кадра
  const head =
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 2\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Def,Montserrat,${fontSize},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,40,1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events: string[] = [];
  segs.forEach((s, i) => {
    const raw = (texts[i] || '').trim().replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
    if (!raw) return;
    const chunks = chunkByChars(raw, maxChars);
    const dur = Math.max(1, s.end - s.start);
    const totalLen = chunks.reduce((a, c) => a + c.length, 0) || 1;
    let acc = s.start;
    chunks.forEach((c) => {
      const cd = Math.max(300, Math.round(dur * (c.length / totalLen)));
      const st = acc;
      const en = Math.min(s.end, acc + cd);
      acc = en;
      events.push(`Dialogue: 0,${assTime(st)},${assTime(en)},Def,,0,0,0,,{\\an5\\pos(${posX},${posY})}${twoLineWrap(c)}`);
    });
  });
  const file = path.join(os.tmpdir(), `pulsar_dubsub_${Date.now()}.ass`);
  fs.writeFileSync(file, head + events.join('\n'), 'utf-8');
  return file;
}

// Референс для клонирования голоса: 3–9 с непрерывной речи (без длинных пауз) с наибольшей
// плотностью слов — чтобы OmniVoice «услышал» голос, а не тишину/музыку.
function pickReference(words: TranscriptWord[]): { start: number; end: number; text: string } | null {
  if (!words.length) return null;
  const MIN = 3000;
  const MAX = 9000;
  const GAP = 1200;
  let best: { start: number; end: number; text: string; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    let j = i;
    let spoken = 0;
    while (j < words.length) {
      if (j > i && (words[j].start - words[j - 1].end > GAP || words[j].end - words[i].start > MAX)) break;
      spoken += words[j].end - words[j].start;
      j++;
    }
    const end = words[j - 1].end;
    const span = end - words[i].start;
    if (span < MIN) continue;
    const score = spoken / span + Math.min(span, 6000) / 60000; // плотность речи + лёгкий бонус за длину
    if (!best || score > best.score) {
      best = { start: words[i].start, end, text: words.slice(i, j).map((w) => w.text).join(' '), score };
    }
  }
  if (!best) {
    // Речи мало — берём всё, что есть (до MAX).
    const cut = words.findIndex((w) => w.end - words[0].start > MAX);
    const slice = cut <= 0 ? words : words.slice(0, cut);
    best = { start: words[0].start, end: slice[slice.length - 1].end, text: slice.map((w) => w.text).join(' '), score: 0 };
  }
  return { start: best.start, end: best.end, text: best.text };
}

// Вырезать референс голоса из ролика: моно WAV 24 кГц (формат самой модели).
function extractReference(video: string, startMs: number, endMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `pulsar_dub_ref_${Date.now()}.wav`);
    ffmpeg(video)
      .seekInput(Math.max(0, startMs - 150) / 1000)
      .duration((endMs - startMs + 300) / 1000)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(24000)
      .audioCodec('pcm_s16le')
      .output(out)
      .on('end', () => resolve(out))
      .on('error', (e) => reject(e))
      .run();
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
async function buildDub(video: string, clips: DubClip[], out: string, keepOriginal: boolean, origVol: number, syncTiming: boolean, assPath: string | null): Promise<{ ok: true } | { error: string }> {
  const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 });

  // Подгонка: если озвучка длиннее слота — слегка ускоряем. Потолок 1.5x:
  // выше речь звучит «роботом/бурундуком». Если перевод сильно длиннее — лучше
  // дать ему чуть наехать на следующую фразу, чем ускорять до неразборчивости.
  const factors: number[] = [];
  for (const c of clips) {
    if (syncTiming && c.targetMs > 200) {
      const durMs = (await probeDuration(c.file)) * 1000;
      factors.push(durMs > c.targetMs * 1.05 ? Math.min(1.5, durMs / c.targetMs) : 1);
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

    // Выжигание субтитров (видеофильтр ass) при наличии.
    let videoMap = '0:v:0';
    if (assPath) {
      filters.push(`[0:v]ass='${escFilterPath(assPath)}':fontsdir='${escFilterPath(fontsDir())}'[v]`);
      videoMap = '[v]';
    }

    cmd
      .complexFilter(filters)
      .outputOptions('-map', videoMap, '-map', '[aout]')
      .outputOptions(venc)
      .outputOptions('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart')
      .output(out)
      .on('end', () => resolve({ ok: true }))
      .on('error', (e) => resolve({ error: e.message }))
      .run();
  });
}

// Полный конвейер дубляжа одного ролика. Вынесен в отдельную функцию, чтобы его
// мог переиспользовать модуль «Воронка» (Funnel) без дублирования логики.
// onProgress — опциональный колбэк (по умолчанию шлёт событие 'dub-progress' в renderer).
export async function runDub(
  req: DubRequest,
  onProgress: (stage: string, percent: number) => void = progress
): Promise<{ ok: true; out: string } | { error: string }> {
  const tmpClips: string[] = [];
  try {
    onProgress('Распознавание речи…', 5);
    const words = await asrWords(req.videoPath, req.sourceLang, req.asr);
    if (!words.length) return { error: 'Речь не распознана (нет голоса или только музыка).' };

    const segs = groupSegments(words);
    onProgress('Перевод…', 25);
    const translated = await translateBatch(segs.map((s) => s.text), req.sourceLang, req.targetLang);
    if ('error' in translated) return translated;

    // Озвучка переведённых сегментов одним пакетом (модель грузится один раз).
    // OmniVoice: голос говорящего клонируется с референса из самого ролика (если не выбран
    // пресет голоса); Edge TTS: выбранный/дефолтный нейроголос.
    const engine = resolveTtsEngine(req.engine);
    const opts: SynthOpts = {};
    if (engine === 'omnivoice' && !isOmniVoiceSpec(req.voice || '') && req.cloneVoice !== false) {
      const ref = pickReference(words);
      if (ref) {
        try {
          opts.refAudio = await extractReference(req.videoPath, ref.start, ref.end);
          opts.refText = ref.text;
          tmpClips.push(opts.refAudio);
        } catch (e) {
          console.warn('[dub] референс голоса не вырезан, авто-голос:', e instanceof Error ? e.message : e);
        }
      }
    }
    const jobs: { text: string; out: string; idx: number }[] = [];
    segs.forEach((s, i) => {
      const txt = (translated[i] || '').trim();
      if (txt) jobs.push({ text: txt, out: path.join(os.tmpdir(), `pulsar_dub_${Date.now()}_${i}.wav`), idx: i });
    });
    if (!jobs.length) return { error: 'Не удалось озвучить ни одного сегмента.' };
    jobs.forEach((j) => tmpClips.push(j.out));
    onProgress(engine === 'omnivoice' ? 'Озвучка (OmniVoice: загрузка модели)…' : 'Озвучка…', 30);
    const synth = await runSynthBatch(jobs, req.targetLang, req.engine || 'auto', 1, req.voice || '', {
      ...opts,
      onProgress: (d, n) => onProgress(`Озвучка ${Math.min(d + 1, n)}/${n}…`, 30 + Math.round((d / n) * 55)),
    });
    if ('error' in synth) return synth;
    const clips: DubClip[] = jobs.map((j) => ({ file: j.out, startMs: segs[j.idx].start, targetMs: segs[j.idx].end - segs[j.idx].start }));

    // Субтитры с переводом (опц.).
    let assPath: string | null = null;
    if (req.burnSubs) {
      const { w, h } = await probeSize(req.videoPath);
      assPath = buildSubsAss(segs, translated, w, h);
    }

    onProgress('Склейка с видео…', 90);
    const sep = req.outputDir.includes('\\') ? '\\' : '/';
    const baseName = (req.videoPath.split(/[\\/]/).pop() || 'video').replace(/\.[^.]+$/, '');
    const out = `${req.outputDir}${sep}${baseName}_dub_${req.targetLang}.mp4`;
    const m = await buildDub(req.videoPath, clips, out, req.keepOriginal, req.originalVolume, req.syncTiming !== false, assPath);
    if (assPath) fs.promises.unlink(assPath).catch(() => {});
    if ('error' in m) return m;

    onProgress('Готово', 100);
    return { ok: true, out };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    for (const f of tmpClips) fs.promises.unlink(f).catch(() => {});
  }
}

export function registerDubHandlers() {
  ipcMain.handle('dub:run', async (_e, req: DubRequest) => runDub(req));
}
