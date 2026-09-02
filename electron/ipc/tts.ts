import { app, ipcMain } from 'electron';
// spawn через реестр: дочерние процессы гасятся при выходе и крэше (procRegistry).
import { spawnTracked as spawn } from './procRegistry';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { videoEncoderOptions } from './encoder';
import { pythonCmdSync } from './python';
import { getSettingValue } from './config';
import { hasNvidiaGpu, isExplicitEngine, isOmniVoiceInstalled, isOmniVoiceSpec, resolveTtsEngine, type TtsEngine } from './omnivoice';

const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

function scriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'tts.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'tts.py');
}

interface SynthRequest {
  text: string;
  lang: string;
  engine: string; // 'auto' | 'omnivoice' | 'edge'
  speed: number;
  voice?: string; // Edge: id голоса; OmniVoice: 'design:<описание>' | 'clone:<путь>' | '' (авто)
  outputDir: string;
  outName: string;
  attachVideo?: string; // если задан — наложить озвучку на это видео
  keepOriginal?: boolean; // приглушить оригинал, а не заменить
  originalVolume?: number; // 0..1 при keepOriginal
}

export interface SynthJob {
  text: string;
  out: string;
}

export interface SynthOpts {
  refAudio?: string; // OmniVoice: референс для клонирования голоса (3–10 с речи)
  refText?: string; // текст референса (без него OmniVoice распознаёт его сам — дольше)
  onProgress?: (done: number, total: number) => void;
}

function tmpName(prefix: string, ext: string): string {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
}

// Последняя JSON-строка stdout: библиотеки шумят в stdout, воркер пишет ответ последней строкой.
function parseLastJson(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t);
    } catch {
      /* не JSON — смотрим выше */
    }
  }
  return null;
}

// Один запуск воркера tts.py на пакет фраз (модель грузится один раз на пакет).
function spawnSynth(jobs: SynthJob[], lang: string, engine: TtsEngine, speed: number, voice: string, opts: SynthOpts): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const tmp: string[] = [];
    const jobsFile = tmpName('pulsar_tts_jobs', '.json');
    fs.writeFileSync(jobsFile, JSON.stringify(jobs), 'utf-8');
    tmp.push(jobsFile);
    const argsv = ['synth', '--jobs-file', jobsFile, '--lang', lang, '--engine', engine, '--speed', String(speed)];
    if (voice) argsv.push('--voice', voice);
    if (opts.refAudio) argsv.push('--ref-audio', opts.refAudio);
    if (opts.refText) {
      const f = tmpName('pulsar_tts_ref', '.txt');
      fs.writeFileSync(f, opts.refText, 'utf-8');
      tmp.push(f);
      argsv.push('--ref-text-file', f);
    }
    const child = spawn(pythonCmdSync(), [scriptPath(), ...argsv], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
      },
    });
    let stdout = '';
    let stderr = '';
    const cleanup = () => tmp.forEach((f) => fs.promises.unlink(f).catch(() => {}));
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => {
      const s = c.toString();
      stderr += s;
      for (const line of s.split(/\r?\n/)) {
        const m = /^PROGRESS\s+(\d+)\/(\d+)/.exec(line.trim());
        if (m) opts.onProgress?.(Number(m[1]), Number(m[2]));
      }
    });
    child.on('error', (err) => {
      cleanup();
      resolve({ error: err.message });
    });
    child.on('close', () => {
      cleanup();
      const r = parseLastJson(stdout);
      if (r?.ok) resolve({ ok: true });
      else resolve({ error: (r?.error as string) || stderr.trim().split(/\r?\n/).slice(-3).join(' ') || 'Не удалось разобрать ответ tts.py' });
    });
  });
}

// OmniVoice отдаёт WAV 24 кГц — переводим в формат по расширению целевого файла.
function convertAudio(src: string, dst: string): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const ext = path.extname(dst).toLowerCase();
    const cmd = ffmpeg(src);
    if (ext === '.mp3') cmd.audioCodec('libmp3lame').audioQuality(2);
    else if (ext === '.m4a' || ext === '.aac') cmd.audioCodec('aac').audioBitrate('192k');
    cmd
      .output(dst)
      .on('end', () => resolve({ ok: true }))
      .on('error', (e) => resolve({ error: e.message }))
      .run();
  });
}

// Пакетная озвучка: фразы → файлы. Движок: явный / из настроек / авто (OmniVoice, если
// установлен, иначе Edge TTS). В авто-режиме при сбое OmniVoice подстраховывает Edge.
export async function runSynthBatch(
  jobs: SynthJob[],
  lang: string,
  engine: string,
  speed: number,
  voice: string,
  opts: SynthOpts = {}
): Promise<{ ok: true; engine: TtsEngine } | { error: string }> {
  const list = jobs.filter((j) => j.text.trim());
  if (!list.length) return { error: 'Пустой текст' };
  const eng = resolveTtsEngine(engine);

  if (eng === 'omnivoice') {
    // Id голоса Edge (ru-RU-SvetlanaNeural) для OmniVoice бессмыслен — авто-голос либо клон.
    const v = isOmniVoiceSpec(voice) ? voice : '';
    const wavJobs = list.map((j) => ({
      text: j.text,
      out: path.extname(j.out).toLowerCase() === '.wav' ? j.out : tmpName('pulsar_tts', '.wav'),
    }));
    const r = await spawnSynth(wavJobs, lang, 'omnivoice', speed, v, opts);
    if ('error' in r) {
      if (isExplicitEngine(engine)) return r;
      console.warn('[tts] OmniVoice не сработал, резерв Edge TTS:', r.error);
      const e = await spawnSynth(list, lang, 'edge', speed, isOmniVoiceSpec(voice) ? '' : voice, { onProgress: opts.onProgress });
      return 'error' in e ? { error: `OmniVoice: ${r.error} · Edge TTS: ${e.error}` } : { ok: true, engine: 'edge' };
    }
    for (let i = 0; i < list.length; i++) {
      if (wavJobs[i].out === list[i].out) continue;
      const c = await convertAudio(wavJobs[i].out, list[i].out);
      fs.promises.unlink(wavJobs[i].out).catch(() => {});
      if ('error' in c) return c;
    }
    return { ok: true, engine: 'omnivoice' };
  }

  const r = await spawnSynth(list, lang, 'edge', speed, isOmniVoiceSpec(voice) ? '' : voice, opts);
  return 'error' in r ? r : { ok: true, engine: 'edge' };
}

// Одна фраза → файл (обёртка над пакетом).
export async function runSynth(text: string, outFile: string, lang: string, engine: string, speed: number, voice: string, opts: SynthOpts = {}): Promise<{ ok: true } | { error: string }> {
  const r = await runSynthBatch([{ text, out: outFile }], lang, engine, speed, voice, opts);
  return 'error' in r ? r : { ok: true };
}

// Наложение озвучки на видео (замена дорожки либо микс с приглушённым оригиналом).
function muxAudio(video: string, audio: string, out: string, keepOriginal: boolean, origVol: number): Promise<{ ok: true } | { error: string }> {
  return new Promise(async (resolve) => {
    const venc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 });
    const cmd = ffmpeg(video).input(audio);
    if (keepOriginal) {
      cmd.complexFilter([
        `[0:a]volume=${origVol.toFixed(2)}[a0]`,
        `[a0][1:a]amix=inputs=2:duration=longest[aout]`,
      ]).outputOptions('-map', '0:v:0', '-map', '[aout]');
    } else {
      cmd.outputOptions('-map', '0:v:0', '-map', '1:a:0', '-shortest');
    }
    cmd
      .outputOptions(venc)
      .outputOptions('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart')
      .output(out)
      .on('end', () => resolve({ ok: true }))
      .on('error', (e) => resolve({ error: e.message }))
      .run();
  });
}

export function registerTtsHandlers() {
  ipcMain.handle('tts:engines', () => {
    return new Promise((resolve) => {
      const py = pythonCmdSync();
      const child = spawn(py, [scriptPath(), 'engines'], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      });
      let stdout = '';
      child.stdout.on('data', (c) => (stdout += c.toString()));
      child.on('error', (err) => resolve({ error: err.message }));
      child.on('close', () => resolve(parseLastJson(stdout) ?? { error: 'tts.py недоступен' }));
    });
  });

  // Состояние движков для UI: установлен ли OmniVoice, есть ли NVIDIA, что выбрано по умолчанию.
  ipcMain.handle('tts:status', async () => ({
    omnivoice: isOmniVoiceInstalled(),
    nvidia: await hasNvidiaGpu(),
    defaultEngine: resolveTtsEngine('auto'),
    setting: (getSettingValue('ttsEngine') as string | null) ?? 'auto',
  }));

  // Короткий пример голоса во временную папку (для предпрослушивания).
  ipcMain.handle('tts:sample', async (_e, req: Omit<SynthRequest, 'outputDir' | 'outName' | 'attachVideo'>) => {
    const out = path.join(os.tmpdir(), `pulsar_sample_${Date.now()}.mp3`);
    const r = await runSynth(req.text, out, req.lang, req.engine || 'auto', req.speed ?? 1, req.voice || '');
    if ('error' in r) return r;
    return { ok: true, out };
  });

  ipcMain.handle('tts:synth', async (_e, req: SynthRequest) => {
    const sep = req.outputDir.includes('\\') ? '\\' : '/';
    const base = req.outName.replace(/\.[^.]+$/, '') || `voice_${Date.now()}`;
    const wav = `${req.outputDir}${sep}${base}.mp3`;
    const r = await runSynth(req.text, wav, req.lang, req.engine || 'auto', req.speed, req.voice || '');
    if ('error' in r) return r;
    if (req.attachVideo) {
      const outMp4 = `${req.outputDir}${sep}${base}_video.mp4`;
      const m = await muxAudio(req.attachVideo, wav, outMp4, !!req.keepOriginal, req.originalVolume ?? 0.15);
      if ('error' in m) return m;
      return { ok: true, out: outMp4 };
    }
    return { ok: true, out: wav };
  });
}
