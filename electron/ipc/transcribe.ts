import { app } from 'electron';
import { spawn } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TranscriptWord } from '../../src/vub/types';

// Транскрибация речи через AssemblyAI (облако). Независимо от логики редактора.
const API = 'https://api.assemblyai.com/v2';

function tmpFile(ext: string): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `vub_${rnd}.${ext}`);
}

// Извлечение моно-аудио 16kHz wav (компактно для загрузки).
function extractAudio(videoPath: string): Promise<string> {
  const out = tmpFile('wav');
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .addInputOption('-nostdin')
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .on('end', () => resolve(out))
      .on('error', reject)
      .save(out);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Распознаёт речь, возвращает слова с таймингами (мс). Пусто, если речи нет.
export async function transcribe(
  videoPath: string,
  apiKey: string,
  language: string
): Promise<TranscriptWord[]> {
  const wav = await extractAudio(videoPath);
  try {
    // 1. Загрузка аудио
    const audioBytes = fs.readFileSync(wav);
    const up = await fetch(`${API}/upload`, {
      method: 'POST',
      headers: { authorization: apiKey },
      body: audioBytes,
    });
    if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);
    const { upload_url } = (await up.json()) as { upload_url: string };

    // 2. Создание задачи транскрибации
    const body: Record<string, unknown> = { audio_url: upload_url, punctuate: true };
    if (language === 'auto') body.language_detection = true;
    else body.language_code = language;

    const cr = await fetch(`${API}/transcript`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!cr.ok) throw new Error(`create failed: ${cr.status} ${await cr.text()}`);
    const { id } = (await cr.json()) as { id: string };

    // 3. Поллинг результата
    for (let i = 0; i < 200; i++) {
      const r = await fetch(`${API}/transcript/${id}`, { headers: { authorization: apiKey } });
      const j = (await r.json()) as {
        status: string;
        error?: string;
        words?: { text: string; start: number; end: number }[];
      };
      if (j.status === 'completed') {
        return (j.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end }));
      }
      if (j.status === 'error') throw new Error(j.error || 'transcription error');
      await sleep(3000);
    }
    throw new Error('transcription timeout');
  } finally {
    fs.promises.unlink(wav).catch(() => {});
  }
}

// ── Офлайн-распознавание через faster-whisper (whisper_asr.py) ────────────────
// Альтернатива AssemblyAI, когда облако недоступно (блокировка/нет интернета).
function pyCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}
function whisperScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'whisper_asr.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'whisper_asr.py');
}

export async function transcribeWhisper(videoPath: string, language: string, model = 'small'): Promise<TranscriptWord[]> {
  const wav = await extractAudio(videoPath);
  try {
    return await new Promise<TranscriptWord[]>((resolve, reject) => {
      const args = [whisperScript(), wav, '--language', language || 'auto', '--model', model];
      // Модель Whisper качается с HuggingFace; в заблокированных сетях — через зеркало.
      const env = { ...process.env, HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com' };
      const child = spawn(pyCmd(), args, { env });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => (out += c.toString()));
      child.stderr.on('data', (c) => (err += c.toString()));
      child.on('error', (e) => reject(e));
      child.on('close', () => {
        try {
          const r = JSON.parse(out.trim());
          if (r.ok) resolve((r.words ?? []) as TranscriptWord[]);
          else reject(new Error(r.error || 'Ошибка Whisper'));
        } catch {
          reject(new Error(err.trim() || 'whisper_asr.py недоступен'));
        }
      });
    });
  } finally {
    fs.promises.unlink(wav).catch(() => {});
  }
}
