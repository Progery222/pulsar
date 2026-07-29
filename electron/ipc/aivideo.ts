import { app, ipcMain } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { getOpenRouterKey, getPexelsKey, getPixabayKey } from './config';
import { runSynth } from './tts';

// Модуль «AI-ролик по теме»: тема → сценарий (LLM) → сток-клипы (Pexels/Pixabay) →
// озвучка (edge-tts) → субтитры → сборка ffmpeg. Переиспользует TTS/LLM/ffmpeg Pulsar.

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
const ffprobeBin = (ffprobeStatic as unknown as { path: string })?.path?.replace('app.asar', 'app.asar.unpacked');

interface Scene {
  text: string;
  keywords: string[];
  clipUrl?: string; // выбранный/переданный клип (иначе авто-подбор по keywords)
}
interface Clip {
  source: 'pexels' | 'pixabay';
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  duration: number;
}

const FORMATS: Record<string, [number, number]> = {
  portrait: [1080, 1920],
  square: [1080, 1080],
  landscape: [1920, 1080],
};

// --- сеть ---
function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Pulsar', ...headers }, family: 4 }, (r) => {
      // редирект
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        httpsGet(r.headers.location, headers).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(60000, () => req.destroy(new Error('таймаут сети')));
    req.on('error', reject);
  });
}
async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const r = await httpsGet(url, headers);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.body.toString('utf8').slice(0, 200)}`);
  return JSON.parse(r.body.toString('utf8'));
}
async function download(url: string, dest: string, headers?: Record<string, string>): Promise<void> {
  const r = await httpsGet(url, headers);
  if (r.status !== 200) throw new Error(`скачивание HTTP ${r.status}`);
  await fs.promises.writeFile(dest, r.body);
}

// --- ffmpeg ---
function ff(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let err = '';
    const ch = spawn(ffmpegBin, args, { windowsHide: true });
    ch.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-1200); });
    ch.on('error', reject);
    ch.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).pop() || `ffmpeg ${code}`))));
  });
}
function probeDur(file: string): Promise<number> {
  return new Promise((resolve) => {
    if (!ffprobeBin) return resolve(0);
    const ch = spawn(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
    ch.on('close', () => resolve(Number(out.trim()) || 0));
    ch.on('error', () => resolve(0));
  });
}

// --- LLM (OpenRouter) ---
function openRouter(apiKey: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', family: 4,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'HTTP-Referer': 'https://pulsar.local', 'X-Title': 'Pulsar AI Video' },
    }, (r) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (data += c));
      r.on('end', () => resolve({ status: r.statusCode || 0, text: data }));
    });
    req.setTimeout(90000, () => req.destroy(new Error('таймаут OpenRouter')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- поиск стока ---
async function searchPexels(query: string, orientation: string, perPage: number): Promise<Clip[]> {
  const key = getPexelsKey();
  if (!key) return [];
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=${orientation}`;
  const j = (await getJson(url, { Authorization: key })) as { videos?: { duration: number; image: string; video_files: { link: string; width: number; height: number; quality: string; file_type: string }[] }[] };
  return (j.videos ?? []).map((v) => {
    const files = (v.video_files || []).filter((f) => f.file_type === 'video/mp4').sort((a, b) => b.width - a.width);
    const f = files[0];
    return f ? { source: 'pexels' as const, previewUrl: v.image, downloadUrl: f.link, width: f.width, height: f.height, duration: v.duration } : null;
  }).filter(Boolean) as Clip[];
}
async function searchPixabay(query: string, perPage: number): Promise<Clip[]> {
  const key = getPixabayKey();
  if (!key) return [];
  const url = `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=${Math.max(3, perPage)}`;
  const j = (await getJson(url)) as { hits?: { duration: number; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> }[] };
  return (j.hits ?? []).map((h) => {
    const v = h.videos?.large || h.videos?.medium || h.videos?.small;
    // previewUrl — jpg-миниатюра (mp4-URL в <img> не покажется).
    return v ? { source: 'pixabay' as const, previewUrl: v.thumbnail || v.url, downloadUrl: v.url, width: v.width, height: v.height, duration: h.duration } : null;
  }).filter(Boolean) as Clip[];
}

function orientationFor(format: string): string {
  return format === 'portrait' ? 'portrait' : format === 'square' ? 'square' : 'landscape';
}

// --- субтитры (ASS) по сценам ---
function assTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}
function buildAss(spans: { start: number; end: number; text: string }[], W: number, H: number): string {
  const fs = Math.round(H * 0.045);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Def,Arial,${fs},&H00FFFFFF,&H00000000,&H80000000,1,1,3,1,2,60,60,${Math.round(H * 0.12)},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
  const lines = spans.map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Def,,0,0,0,,${s.text.replace(/\n/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')')}`).join('\n');
  return head + lines + '\n';
}
function escFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

let cancelled = false;

export function registerAiVideoHandlers() {
  // Генерация сценария по теме (LLM).
  ipcMain.handle('aivideo:script', async (_e, topic: string, opts: { lang: string; seconds: number; scenes: number }) => {
    const key = getOpenRouterKey();
    if (!key) return { error: 'Не задан ключ OpenRouter (Настройки)' };
    const sys = `Ты сценарист коротких вертикальных роликов. По теме придумай закадровый текст на языке "${opts.lang}", рассчитанный примерно на ${opts.seconds} секунд озвучки, разбитый на ${opts.scenes} коротких сцен (1-2 предложения каждая). Для каждой сцены дай 1-3 АНГЛИЙСКИХ ключевых слова для поиска стокового видео. Ответь СТРОГО JSON без пояснений: {"title":"...","scenes":[{"text":"...","keywords":["...","..."]}]}.`;
    const body = JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [{ role: 'system', content: sys }, { role: 'user', content: topic }], temperature: 0.7, response_format: { type: 'json_object' } });
    try {
      const r = await openRouter(key, body);
      if (r.status !== 200) return { error: `OpenRouter ${r.status}: ${r.text.slice(0, 200)}` };
      const content = JSON.parse(r.text)?.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content);
      return { ok: true as const, title: String(parsed.title ?? topic), scenes: (Array.isArray(parsed.scenes) ? parsed.scenes : []).map((s: { text?: string; keywords?: string[] }) => ({ text: String(s.text ?? ''), keywords: Array.isArray(s.keywords) ? s.keywords.map(String) : [] })) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  // Поиск стоковых клипов по запросу.
  ipcMain.handle('aivideo:searchClips', async (_e, query: string, format: string) => {
    try {
      const or = orientationFor(format);
      const [px, pb] = await Promise.all([searchPexels(query, or, 8).catch(() => []), searchPixabay(query, 6).catch(() => [])]);
      const all = [...px, ...pb];
      if (!all.length) return { error: 'Ничего не найдено (проверьте ключи Pexels/Pixabay и запрос)', clips: [] };
      return { ok: true as const, clips: all };
    } catch (e) {
      return { error: (e as Error).message, clips: [] };
    }
  });

  ipcMain.handle('aivideo:cancel', () => { cancelled = true; return { ok: true }; });

  // Полная сборка ролика.
  ipcMain.handle('aivideo:generate', async (e, req: {
    scenes: Scene[]; lang: string; voice: string; format: string; outputPath: string; bgmPath?: string; subtitles: boolean;
  }) => {
    cancelled = false;
    if (!ffmpegBin) return { error: 'ffmpeg не найден' };
    const [W, H] = FORMATS[req.format] ?? FORMATS.portrait;
    const or = orientationFor(req.format);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-aivid-'));
    const emit = (stage: string, percent: number) => e.sender.send('aivideo:progress', { stage, percent });
    const N = req.scenes.length;
    const sceneVids: string[] = [];
    const sceneWavs: string[] = [];
    const spans: { start: number; end: number; text: string }[] = [];
    let cursor = 0;
    try {
      for (let i = 0; i < N; i++) {
        if (cancelled) throw new Error('отменено');
        const sc = req.scenes[i];
        emit(`Озвучка сцены ${i + 1}/${N}`, Math.round((i / N) * 60));
        // 1) Озвучка сцены.
        const wav = path.join(dir, `v${i}.wav`);
        const ttsRes = await runSynth(sc.text, wav, req.lang, 'edge', 1, req.voice || '');
        if ('error' in ttsRes) throw new Error(`озвучка: ${ttsRes.error}`);
        const d = Math.max(1.2, await probeDur(wav));
        sceneWavs.push(wav);
        spans.push({ start: cursor, end: cursor + d, text: sc.text });
        cursor += d;

        // 2) Клип: выбранный или авто-подбор по keywords.
        emit(`Подбор видео ${i + 1}/${N}`, Math.round((i / N) * 60) + 5);
        let clipUrl = sc.clipUrl;
        if (!clipUrl) {
          for (const kw of sc.keywords.length ? sc.keywords : ['abstract']) {
            const px = await searchPexels(kw, or, 5).catch(() => []);
            const pb = px.length ? [] : await searchPixabay(kw, 5).catch(() => []);
            const pick = [...px, ...pb][0];
            if (pick) { clipUrl = pick.downloadUrl; break; }
          }
        }
        const raw = path.join(dir, `raw${i}.mp4`);
        if (clipUrl) {
          await download(clipUrl, raw).catch(() => { clipUrl = undefined; });
        }
        // 3) Нормализация клипа к WxH, длина = d, без звука. Если клипа нет — тёмный фон.
        const vid = path.join(dir, `s${i}.mp4`);
        if (clipUrl && fs.existsSync(raw) && fs.statSync(raw).size > 1000) {
          await ff(['-y', '-stream_loop', '-1', '-i', raw, '-t', d.toFixed(3), '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', vid]);
        } else {
          await ff(['-y', '-f', 'lavfi', '-i', `color=c=0x0d0d10:s=${W}x${H}:r=30`, '-t', d.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', vid]);
        }
        sceneVids.push(vid);
      }

      // 4) Конкат видео (одинаковые параметры -> copy) и аудио.
      if (cancelled) throw new Error('отменено');
      emit('Сборка видео', 65);
      const listFile = path.join(dir, 'list.txt');
      fs.writeFileSync(listFile, sceneVids.map((v) => `file '${v.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
      const videoCat = path.join(dir, 'video.mp4');
      await ff(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', videoCat]);

      emit('Сборка озвучки', 72);
      const voiceCat = path.join(dir, 'voice.m4a');
      const aArgs: string[] = ['-y'];
      sceneWavs.forEach((w) => aArgs.push('-i', w));
      const aFilter = sceneWavs.map((_, i) => `[${i}:a]`).join('') + `concat=n=${sceneWavs.length}:v=0:a=1[a]`;
      aArgs.push('-filter_complex', aFilter, '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', voiceCat);
      await ff(aArgs);

      // 5) Финал: субтитры + озвучка (+ фоновая музыка).
      emit('Финальный рендер', 85);
      let assPath: string | null = null;
      if (req.subtitles) {
        assPath = path.join(dir, 'subs.ass');
        fs.writeFileSync(assPath, buildAss(spans, W, H), 'utf8');
      }
      const fin: string[] = ['-y', '-i', videoCat, '-i', voiceCat];
      const filters: string[] = [];
      filters.push(`[0:v]${assPath ? `ass='${escFilterPath(assPath)}'` : 'null'}[v]`);
      let amap = '[1:a]';
      if (req.bgmPath && fs.existsSync(req.bgmPath)) {
        fin.push('-stream_loop', '-1', '-i', req.bgmPath);
        filters.push(`[2:a]volume=0.12[bg]`);
        filters.push(`[1:a][bg]amix=inputs=2:normalize=0:duration=first[a]`);
        amap = '[a]';
      }
      fin.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', amap, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', req.outputPath);
      await ff(fin);
      emit('Готово', 100);
      return { ok: true as const, path: req.outputPath, durationSec: cursor };
    } catch (err) {
      return { error: (err as Error).message };
    } finally {
      fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
