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
import { buildAss, roundRectPath } from '../../src/vub/assBuilder';
import type { TitlesStyle, TranscriptWord } from '../../src/vub/types';

const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: string;
  conf?: number;
}
interface DetectResult {
  width: number;
  height: number;
  duration: number;
  boxes: Box[];
  motion?: number;
  error?: string;
}

export interface CleanerVideo {
  id: string;
  path: string;
  name: string;
}
export interface CleanerRequest {
  videos: CleanerVideo[];
  detectTitles: boolean;
  detectWatermarks: boolean;
  coverMethod: 'delogo' | 'blur' | 'box';
  boxColor: string;
  boxRadius?: number; // скругление сплошной плашки, px
  blurStrength?: number; // сила блюра (sigma)
  minConf: number;
  addTitles: boolean; // наложить свои титры поверх зачищенных
  titlesAtZone?: boolean; // ставить титры по центру найденной зоны
  titleZoneIndex?: number; // индекс зоны для титров (ручной режим)
  titleZonePick?: 'largest' | 'lowest' | 'highest'; // выбор зоны в авто-режиме
  titles?: TitlesStyle; // стиль титров (из вкладки Уникализатор → Титры)
  manualZones?: boolean; // использовать ручные зоны для всех роликов
  zones?: { x: number; y: number; w: number; h: number }[];
  outputDir: string;
}

let cancelled = false;
const active = new Set<ffmpeg.FfmpegCommand>();

function resDir(...parts: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : (process.env.APP_ROOT ?? process.cwd());
  return path.join(base, ...parts);
}
function pythonScript(): string {
  return resDir('python', 'detect_overlays.py');
}
function eastModel(): string {
  const p = resDir('assets', 'models', 'east.pb');
  return fs.existsSync(p) ? p : '';
}
function escFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
function fontsDir(): string {
  return resDir('assets', 'fonts');
}

// Кэш транскрибаций (один исходник распознаётся раз).
const transcriptCache = new Map<string, Promise<TranscriptWord[]>>();
function getWords(videoPath: string, key: string, lang: string): Promise<TranscriptWord[]> {
  const ck = `${videoPath}::${lang}`;
  let pr = transcriptCache.get(ck);
  if (!pr) {
    pr = transcribe(videoPath, key, lang).catch((e) => {
      console.warn('[cleaner] transcribe failed:', e);
      return [] as TranscriptWord[];
    });
    transcriptCache.set(ck, pr);
  }
  return pr;
}

const PY_CANDIDATES =
  process.platform === 'win32' ? [['python', []], ['py', ['-3']], ['python3', []]] : [['python3', []], ['python', []]];

function runPy(cmd: string, pre: string[], args: string[]): Promise<{ out: string; err: string; code: number | null; spawnErr?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, [...pre, ...args]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ out, err, code: null, spawnErr: 'timeout' });
    }, 120000);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ out, err, code: null, spawnErr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out, err, code });
    });
  });
}

// Запуск Python-детектора (перебор интерпретаторов), парсинг JSON.
async function detect(videoPath: string, req: Pick<CleanerRequest, 'detectTitles' | 'detectWatermarks'>): Promise<DetectResult> {
  const args = [
    pythonScript(),
    videoPath,
    req.detectTitles ? '1' : '0',
    req.detectWatermarks ? '1' : '0',
    eastModel(),
  ];
  let lastErr = '';
  for (const [cmd, pre] of PY_CANDIDATES as [string, string[]][]) {
    const { out, err, code, spawnErr } = await runPy(cmd, pre, args);
    if (spawnErr === 'ENOENT' || /not found|ENOENT/i.test(spawnErr || '')) {
      lastErr = `${cmd}: не найден`;
      continue;
    }
    let r: DetectResult | null = null;
    try {
      r = JSON.parse(out.trim());
    } catch {
      lastErr = err.trim() || spawnErr || `нет JSON (код ${code})`;
      console.error(`[cleaner] detect noJSON (${cmd}):`, code, 'stderr:', err.slice(0, 200));
      continue; // интерпретатор не подошёл — пробуем следующий
    }
    // Нет зависимостей (cv2/numpy) в этом интерпретаторе — пробуем следующий.
    if (r && r.error && /deps:|No module|ModuleNotFound/i.test(r.error)) {
      lastErr = r.error;
      console.error(`[cleaner] detect deps-miss (${cmd}):`, r.error);
      continue;
    }
    console.log(`[cleaner] detect ok (${cmd}):`, path.basename(videoPath), 'boxes:', r?.boxes?.length, 'motion:', r?.motion, 'err:', r?.error);
    return r as DetectResult;
  }
  return { width: 0, height: 0, duration: 0, boxes: [], error: lastErr || 'Python/детектор недоступен' };
}

function color6(hex: string): string {
  const h = hex.replace('#', '');
  return `0x${h.slice(0, 6)}`;
}
// #RRGGBB -> ASS BBGGRR
function assColor6(hex: string): string {
  const h = hex.replace('#', '');
  return `${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

// Сплошная плашка со скруглением через .ass (drawbox без радиуса не умеет).
function buildBoxAss(boxes: Box[], W: number, H: number, color: string, radius: number): string {
  const fill = assColor6(color);
  const events = boxes
    .map((b) => {
      const w = Math.round(b.w * W);
      const h = Math.round(b.h * H);
      const left = Math.round(b.x * W);
      const top = Math.round(b.y * H);
      const r = Math.max(0, Math.min(radius, w / 2, h / 2));
      const pathStr = roundRectPath(w, h, r);
      return `Dialogue: 0,0:00:00.00,9:59:59.00,D,,0,0,0,,{\\an7\\pos(${left},${top})\\1c&H${fill}&\\1a&H00&\\bord0\\shad0\\p1}${pathStr}`;
    })
    .join('\n');
  return (
    `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: D,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`
  );
}

// Строит фильтр перекрытия по боксам (нормированные 0..1 -> пиксели).
function buildCover(
  boxes: Box[],
  W: number,
  H: number,
  method: CleanerRequest['coverMethod'],
  boxColor: string,
  blurStrength = 16
): { vf?: string; complex?: string } {
  const px = boxes
    .map((b) => {
      let x = Math.max(1, Math.round(b.x * W));
      let y = Math.max(1, Math.round(b.y * H));
      let w = Math.round(b.w * W);
      let h = Math.round(b.h * H);
      if (x + w > W - 1) w = W - 1 - x;
      if (y + h > H - 1) h = H - 1 - y;
      return { x, y, w, h };
    })
    .filter((b) => b.w > 4 && b.h > 4);

  if (!px.length) return {};

  if (method === 'box') {
    const col = color6(boxColor);
    return { vf: px.map((b) => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${col}@1:t=fill`).join(',') };
  }
  if (method === 'delogo') {
    return { vf: px.map((b) => `delogo=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}`).join(',') };
  }
  // blur: split -> crop+gblur каждой зоны -> последовательные overlay
  const n = px.length;
  const parts: string[] = [];
  parts.push(`[0:v]split=${n + 1}[main]${px.map((_, i) => `[s${i}]`).join('')}`);
  px.forEach((b, i) => {
    parts.push(`[s${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},gblur=sigma=${blurStrength}[b${i}]`);
  });
  let label = 'main';
  px.forEach((b, i) => {
    const next = i === n - 1 ? 'outv' : `m${i}`;
    parts.push(`[${label}][b${i}]overlay=${b.x}:${b.y}[${next}]`);
    label = next;
  });
  return { complex: parts.join(';') };
}

function probe(file: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (e, data) => {
      const v = (data?.streams ?? []).find((s) => s.codec_type === 'video');
      resolve({ w: v?.width ?? 0, h: v?.height ?? 0 });
    });
  });
}

const isAscii = (s: string) => /^[\x00-\x7F]*$/.test(s);

async function processOne(
  video: CleanerVideo,
  req: CleanerRequest,
  send: (status: string, percent: number, info?: string) => void
): Promise<void> {
  let W = 0;
  let H = 0;
  let boxes: Box[] = [];
  if (req.manualZones && req.zones?.length) {
    const p = await probe(video.path);
    W = p.w;
    H = p.h;
    boxes = req.zones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h, conf: 1 }));
  } else {
    send('detecting', 3);
    const det = await detect(video.path, req);
    if (cancelled) return;
    if (det.error) {
      send('error', 0, det.error);
      return;
    }
    if (det.width) {
      W = det.width;
      H = det.height;
    } else {
      const p = await probe(video.path);
      W = p.w;
      H = p.h;
    }
    boxes = (det.boxes || []).filter((b) => (b.conf ?? 1) >= req.minConf);
  }
  console.log('[cleaner] boxes:', JSON.stringify(boxes.map((b) => ({ x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.w.toFixed(2), h: +b.h.toFixed(2) }))), 'method:', req.coverMethod, 'addTitles:', req.addTitles);
  send('processing', 10, `зон: ${boxes.length}`);

  // Перекрытие: box -> скруглённая плашка через .ass; blur/delogo -> фильтры.
  const cover: { vf?: string; complex?: string } = {};
  let coverAssPath: string | null = null;
  if (boxes.length) {
    if (req.coverMethod === 'box') {
      const a = buildBoxAss(boxes, W, H, req.boxColor, req.boxRadius ?? 0);
      coverAssPath = path.join(os.tmpdir(), `cl_box_${Math.random().toString(36).slice(2, 8)}.ass`);
      fs.writeFileSync(coverAssPath, a, 'utf-8');
    } else {
      Object.assign(cover, buildCover(boxes, W, H, req.coverMethod, req.boxColor, req.blurStrength ?? 16));
    }
  }
  const coverAssFilter = coverAssPath ? `ass=filename='${escFilterPath(coverAssPath)}'` : null;

  // Наложение своих титров (транскрибация + .ass) поверх зачищенного видео.
  let assPath: string | null = null;
  if (req.addTitles && req.titles) {
    const key = getAssemblyKey();
    if (!key) {
      send('processing', 10, 'титры: нет API-ключа');
    } else {
      send('processing', 10, 'распознаю речь…');
      const words = await getWords(video.path, key, req.titles.language);
      if (cancelled) return;
      if (words.length) {
        let style = { ...req.titles, enabled: true };
        if (req.titlesAtZone !== false && boxes.length) {
          // Зона для титров: ручной выбор по индексу, иначе эвристика.
          const idx = req.titleZoneIndex;
          let t: Box;
          if (req.manualZones && idx != null && boxes[idx]) {
            t = boxes[idx];
          } else if (req.titleZonePick === 'lowest') {
            t = boxes.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
          } else if (req.titleZonePick === 'highest') {
            t = boxes.reduce((a, b) => (b.y < a.y ? b : a));
          } else {
            t = boxes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
          }
          // Размер титра подгоняем под высоту зоны (как был старый титр).
          const fitSize = Math.max(22, Math.min(110, Math.round(t.h * 1080 * 0.62)));
          style = {
            ...style,
            posXPct: Math.round((t.x + t.w / 2) * 100),
            posYPct: Math.round((t.y + t.h / 2) * 100),
            fontSize: fitSize,
          };
        }
        const ass = buildAss(words, style, { width: W || 1080, height: H || 1920 });
        console.log('[cleaner] titles words:', words.length, 'bg.enabled:', req.titles.bg?.enabled, 'fontSize:', style.fontSize);
        if (ass) {
          assPath = path.join(os.tmpdir(), `cl_sub_${Math.random().toString(36).slice(2, 8)}.ass`);
          fs.writeFileSync(assPath, ass, 'utf-8');
        }
      }
    }
  }
  const assFilter = assPath
    ? `ass=filename='${escFilterPath(assPath)}':fontsdir='${escFilterPath(fontsDir())}'`
    : null;

  const finalOut = path.join(req.outputDir, `${path.parse(video.name).name}_clean.mp4`);
  const stageDir = isAscii(path.dirname(finalOut)) ? path.dirname(finalOut) : os.tmpdir();
  const out = isAscii(finalOut) ? finalOut : path.join(stageDir, `cl_${Math.random().toString(36).slice(2, 10)}.mp4`);
  const staged = out !== finalOut;

  const cmd = ffmpeg(video.path).addInputOption('-nostdin');
  // Граф: перекрытие -> наши титры. blur = complex; box/delogo = vf-цепочка.
  if (cover.complex) {
    const complex = assFilter ? `${cover.complex};[outv]${assFilter}[v]` : cover.complex;
    cmd.complexFilter(complex, [assFilter ? 'v' : 'outv']);
  } else {
    const vf = [cover.vf, coverAssFilter, assFilter].filter(Boolean).join(',');
    if (vf) cmd.videoFilters(vf);
  }

  const cleanupAss = () => {
    if (assPath) fs.promises.unlink(assPath).catch(() => {});
    if (coverAssPath) fs.promises.unlink(coverAssPath).catch(() => {});
  };

  cmd
    .outputOptions('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
    .outputOptions('-movflags', '+faststart')
    .output(out);

  await new Promise<void>((resolve) => {
    cmd
      .on('progress', (p) => send('processing', Math.min(99, Math.max(11, p.percent || 11))))
      .on('end', async () => {
        active.delete(cmd);
        cleanupAss();
        if (staged) {
          await fs.promises.rm(finalOut, { force: true }).catch(() => {});
          await fs.promises.rename(out, finalOut).catch(async () => {
            await fs.promises.copyFile(out, finalOut);
            await fs.promises.unlink(out).catch(() => {});
          });
        }
        send('done', 100, `зон: ${boxes.length}${assPath ? ' +титры' : ''}`);
        resolve();
      })
      .on('error', (e) => {
        active.delete(cmd);
        cleanupAss();
        if (staged) fs.promises.unlink(out).catch(() => {});
        if (!cancelled) send('error', 0, e.message);
        resolve();
      });
    active.add(cmd);
    cmd.run();
  });
}

export function registerCleanerHandlers() {
  ipcMain.handle('cleaner:process', async (event, req: CleanerRequest) => {
    cancelled = false;
    transcriptCache.clear();
    const sender = BrowserWindow.fromWebContents(event.sender);
    for (const v of req.videos) {
      if (cancelled) break;
      await processOne(v, req, (status, percent, info) =>
        sender?.webContents.send('cleaner-progress', { id: v.id, status, percent, info })
      );
    }
    return { ok: true };
  });

  // Детект на одном ролике (для редактора зон — предзаполнить).
  ipcMain.handle('cleaner:detectOne', async (_e, p: { videoPath: string; detectTitles: boolean; detectWatermarks: boolean }) => {
    return detect(p.videoPath, p);
  });

  ipcMain.handle('cleaner:cancel', () => {
    cancelled = true;
    for (const c of active) {
      try {
        c.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
    active.clear();
    return { ok: true };
  });
}
