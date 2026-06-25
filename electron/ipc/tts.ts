import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { videoEncoderOptions } from './encoder';

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
  engine: string;
  speed: number;
  speakerWav?: string;
  voice?: string;
  promptText?: string;
  apiUrl?: string;
  outputDir: string;
  outName: string;
  attachVideo?: string; // если задан — наложить озвучку на это видео
  keepOriginal?: boolean; // приглушить оригинал, а не заменить
  originalVolume?: number; // 0..1 при keepOriginal
}

// Запуск python tts.py synth → аудиофайл.
function runSynth(text: string, outWav: string, lang: string, engine: string, speed: number, speakerWav: string, voice: string, promptText: string, apiUrl: string): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const tmpTxt = path.join(os.tmpdir(), `pulsar_tts_${Date.now()}.txt`);
    fs.writeFileSync(tmpTxt, text, 'utf-8');
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const argsv = ['synth', '--text-file', tmpTxt, '--out', outWav, '--lang', lang, '--engine', engine, '--speed', String(speed)];
    if (speakerWav) argsv.push('--speaker-wav', speakerWav);
    if (voice) argsv.push('--voice', voice);
    if (promptText) argsv.push('--prompt-text', promptText);
    if (apiUrl) argsv.push('--api-url', apiUrl);
    const child = spawn(py, [scriptPath(), ...argsv]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => {
      fs.promises.unlink(tmpTxt).catch(() => {});
      resolve({ error: err.message });
    });
    child.on('close', () => {
      fs.promises.unlink(tmpTxt).catch(() => {});
      try {
        const r = JSON.parse(stdout.trim());
        resolve(r.ok ? { ok: true } : { error: r.error || 'Ошибка синтеза' });
      } catch {
        resolve({ error: stderr.trim() || 'Не удалось разобрать ответ tts.py' });
      }
    });
  });
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
      const py = process.platform === 'win32' ? 'python' : 'python3';
      const child = spawn(py, [scriptPath(), 'engines']);
      let stdout = '';
      child.stdout.on('data', (c) => (stdout += c.toString()));
      child.on('error', (err) => resolve({ error: err.message }));
      child.on('close', () => {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ error: 'tts.py недоступен' });
        }
      });
    });
  });

  ipcMain.handle('tts:synth', async (_e, req: SynthRequest) => {
    const sep = req.outputDir.includes('\\') ? '\\' : '/';
    const base = req.outName.replace(/\.[^.]+$/, '') || `voice_${Date.now()}`;
    const ext = req.engine === 'edge' ? 'mp3' : 'wav';
    const wav = `${req.outputDir}${sep}${base}.${ext}`;
    const r = await runSynth(req.text, wav, req.lang, req.engine, req.speed, req.speakerWav || '', req.voice || '', req.promptText || '', req.apiUrl || '');
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
