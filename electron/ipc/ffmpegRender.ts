import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EFFECTS } from '../../src/data/effects';
import { FILTERS } from '../../src/data/filters';
import type { EffectName, FilterName } from '../../src/types';
import type { UniqualizerSettings } from '../../src/types/uniqualizer';
import { buildUniqualizerFilters, buildVisibleVariation, randomMetadata, uniqualizerEncoding } from '../../src/utils/uniqualizer';

// Bundled FFmpeg (§2 ТЗ). В упакованном приложении бинарник распакован из asar.
const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
const ffprobePath = ffprobeStatic.path?.replace('app.asar', 'app.asar.unpacked');
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

// Есть ли в файле аудиодорожка (для подстановки тишины источникам без звука).
function hasAudio(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err || !data) {
        resolve(false);
        return;
      }
      resolve((data.streams ?? []).some((s) => s.codec_type === 'audio'));
    });
  });
}

export type Quality = '720p' | '1080p' | '4k';
export type Format = '9:16' | '1:1' | '16:9';

export interface RenderClip {
  sourceFile: string;
  startTime: number;
  duration: number;
  effects: EffectName[];
}

export interface RenderRequest {
  clips: RenderClip[];
  audioFile: string | null;
  segmentStart: number;
  duration: number;
  format: Format;
  fade: 'none' | 'in' | 'out' | 'all';
  filter: FilterName | null;
  filterIntensity: number;
  volumeOriginal: number; // громкость оригинального звука видео (0..1)
  volumeMusic: number; // громкость музыки (0..1)
  uniqualizer: UniqualizerSettings;
  count: number; // сколько уникальных копий создать
  quality: Quality;
  outputPath: string;
}

export interface RenderHooks {
  onProgress?: (percent: number) => void;
  getCancelled?: () => boolean;
  setCommand?: (cmd: ffmpeg.FfmpegCommand | null) => void;
}

const LONG: Record<Quality, number> = { '720p': 1280, '1080p': 1920, '4k': 3840 };
const SHORT: Record<Quality, number> = { '720p': 720, '1080p': 1080, '4k': 2160 };

function dimensions(format: Format, quality: Quality): [number, number] {
  const l = LONG[quality];
  const s = SHORT[quality];
  if (format === '16:9') return [l, s];
  if (format === '9:16') return [s, l];
  return [s, s];
}

// Render-безопасные видеофильтры эффектов: только timing-нейтральные и валидные
// как простой -vf. Эффекты speed/boomerang/split/fastCut меняют тайминг/раскладку
// и ломают синхронизацию с аудио — они отображаются только в превью (оверлей/маркеры).
function effectFilters(effects: EffectName[], w: number, h: number): string[] {
  const out: string[] = [];
  for (const name of effects) {
    switch (name) {
      case 'prism':
        out.push('rgbashift=rh=5:bh=-5');
        break;
      case 'rgb':
        out.push('rgbashift=rh=8:bh=-8');
        break;
      case 'hue':
        out.push('hue=h=360*t');
        break;
      case 'zoom':
        out.push(`crop=iw/1.2:ih/1.2,scale=${w}:${h}`);
        break;
      case 'flash':
        out.push('eq=brightness=0.18:saturation=1.2');
        break;
      // speed, boomerang, split, fastCut — превью-only (тайминг/раскладка).
      default:
        break;
    }
  }
  return out;
}

// EFFECTS импортируется для согласованности набора (используется в превью).
void EFFECTS;

function globalFilter(filter: FilterName | null): string | null {
  if (!filter) return null;
  const meta = FILTERS.find((f) => f.key === filter);
  return meta?.ffmpeg || null;
}

// Если FFmpeg не выдаёт ни прогресса, ни вывода дольше этого времени — считаем,
// что процесс завис (типичная причина «застревания» на аудио-этапе), и прерываем.
const STALL_MS = 90_000;

function runCommand(cmd: ffmpeg.FfmpegCommand, hooks: RenderHooks): Promise<void> {
  return new Promise((resolve, reject) => {
    hooks.setCommand?.(cmd);

    // -nostdin: запрещаем FFmpeg читать stdin (без этого процесс может зависнуть,
    // ожидая ввод, при spawn без терминала — частая причина зависания экспорта).
    cmd.inputOptions(['-nostdin']);

    let stderrTail = '';
    let lastActivity = Date.now();
    const beat = () => {
      lastActivity = Date.now();
    };

    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) {
        cleanupTimers();
        hooks.setCommand?.(null);
        try {
          cmd.kill('SIGKILL');
        } catch {
          /* noop */
        }
        reject(
          new Error(
            `FFmpeg завис (нет активности ${STALL_MS / 1000}с). Последний вывод:\n${stderrTail.slice(-500)}`
          )
        );
      }
    }, 5_000);

    const cleanupTimers = () => clearInterval(watchdog);

    cmd.on('progress', beat);
    cmd.on('stderr', (line: string) => {
      beat();
      stderrTail += line + '\n';
      if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
    });
    cmd.on('end', () => {
      cleanupTimers();
      hooks.setCommand?.(null);
      resolve();
    });
    cmd.on('error', (err) => {
      cleanupTimers();
      hooks.setCommand?.(null);
      reject(err);
    });
    cmd.run();
  });
}

// Уникализатор §1: перезапись метаданных через FFmpeg (-metadata, -codec copy).
async function randomizeMetadata(outputPath: string, hooks: RenderHooks): Promise<void> {
  const meta = randomMetadata();
  const tmp = `${outputPath}.meta.mp4`;
  await runCommand(
    ffmpeg(outputPath)
      .outputOptions([
        '-map', '0',
        '-c', 'copy',
        '-metadata', `title=${meta.title}`,
        '-metadata', `comment=${meta.comment}`,
        '-metadata', `creation_time=${meta.creation_time}`,
        '-metadata', `encoder=${meta.encoder}`,
        '-metadata', `major_brand=${meta.major_brand}`,
        '-metadata', `artist=${meta.artist}`,
        '-metadata', `album=${meta.album}`,
      ])
      .output(tmp),
    hooks
  );
  fs.rmSync(outputPath, { force: true });
  fs.renameSync(tmp, outputPath);
}

// Имя файла копии: name_01.mp4 ... name_NN.mp4 (ширина по числу копий).
function suffixPath(p: string, idx: number, total: number): string {
  const ext = path.extname(p);
  const baseName = p.slice(0, p.length - ext.length);
  const width = String(total).length;
  return `${baseName}_${String(idx).padStart(width, '0')}${ext}`;
}

// Уникализатор §2: дозапись 512–2048 случайных байт в конец файла (меняет хэш).
async function appendRandomBytes(filePath: string): Promise<void> {
  const size = Math.floor(Math.random() * 1536) + 512; // 512–2048
  const randomBytes = crypto.randomBytes(size);
  await fs.promises.appendFile(filePath, randomBytes);
}

// FFmpeg Pipeline (§10): 6 этапов. Чистая функция без Electron-зависимостей.
export async function renderProject(req: RenderRequest, hooks: RenderHooks = {}): Promise<void> {
  const cancelled = () => hooks.getCancelled?.() ?? false;
  const progress = (p: number) => hooks.onProgress?.(Math.max(0, Math.min(100, Math.round(p))));

  const tmpDir = path.join(os.tmpdir(), `pulsar-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  };

  try {
    if (req.clips.length === 0) throw new Error('Нет клипов для рендеринга');
    const [w, h] = dimensions(req.format, req.quality);
    const scaleChain = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

    // Оригинальный звук сохраняем во фрагментах только если он нужен в миксе.
    const useOriginal = req.volumeOriginal > 0;

    // Определяем наличие аудио у каждого исходника (иначе подставим тишину).
    const audioMap = new Map<string, boolean>();
    if (useOriginal) {
      for (const src of new Set(req.clips.map((c) => c.sourceFile))) {
        audioMap.set(src, await hasAudio(src));
      }
    }

    // Этап 1–2: нарезка фрагментов + эффекты (глобальный фильтр — отдельным этапом).
    const fragments: string[] = [];
    for (let i = 0; i < req.clips.length; i++) {
      if (cancelled()) throw new Error('Экспорт отменён');
      const clip = req.clips[i];
      const fragPath = path.join(tmpDir, `fragment_${i}.mp4`);
      const vchain = [scaleChain, ...effectFilters(clip.effects, w, h)].join(',');

      let fragCmd: ffmpeg.FfmpegCommand;
      if (useOriginal) {
        const srcHasAudio = audioMap.get(clip.sourceFile) ?? false;
        if (srcHasAudio) {
          // Реальный звук источника.
          fragCmd = ffmpeg(clip.sourceFile)
            .seekInput(clip.startTime)
            .duration(clip.duration)
            .complexFilter([`[0:v]${vchain}[v]`])
            .outputOptions([
              '-map', '[v]', '-map', '0:a:0', '-pix_fmt', 'yuv420p', '-r', '30',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
            ]);
        } else {
          // У источника нет аудио — подставляем тишину (концат остаётся консистентным).
          fragCmd = ffmpeg(clip.sourceFile)
            .seekInput(clip.startTime)
            .duration(clip.duration)
            .input('anullsrc=channel_layout=stereo:sample_rate=44100')
            .inputOptions(['-f', 'lavfi', '-t', String(clip.duration)])
            .complexFilter([`[0:v]${vchain}[v]`])
            .outputOptions([
              '-map', '[v]', '-map', '1:a:0', '-pix_fmt', 'yuv420p', '-r', '30',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
            ]);
        }
      } else {
        fragCmd = ffmpeg(clip.sourceFile)
          .seekInput(clip.startTime)
          .duration(clip.duration)
          .videoFilters([scaleChain, ...effectFilters(clip.effects, w, h)])
          .noAudio()
          .outputOptions(['-pix_fmt', 'yuv420p', '-r', '30']);
      }
      await runCommand(fragCmd.output(fragPath), hooks);
      fragments.push(fragPath);
      progress((i / req.clips.length) * 55);
    }

    // Этап 4: склейка (concat demuxer).
    const listPath = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(
      listPath,
      fragments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
    );
    const concatPath = path.join(tmpDir, 'concat.mp4');
    let videoSource = concatPath;
    await runCommand(
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(concatPath),
      hooks
    );
    progress(62);

    // Этап 3: глобальный фильтр с учётом filterIntensity (blend по K = intensity/100).
    // Видео-стрим без аудио (оригинальный звук берём отдельно из concat).
    if (cancelled()) throw new Error('Экспорт отменён');
    const gFilter = req.filterIntensity > 0 ? globalFilter(req.filter) : null;
    if (gFilter) {
      const filteredPath = path.join(tmpDir, 'filtered.mp4');
      const k = Math.min(1, req.filterIntensity / 100);
      const cmd = ffmpeg(videoSource);
      if (k >= 1) {
        cmd.videoFilters([gFilter]);
      } else {
        cmd.complexFilter(
          [`[0:v]split[a][b];[b]${gFilter}[bf];[a][bf]blend=all_expr=A*(1-${k.toFixed(3)})+B*${k.toFixed(3)}[out]`],
          ['out']
        );
      }
      await runCommand(cmd.noAudio().outputOptions(['-pix_fmt', 'yuv420p']).output(filteredPath), hooks);
      videoSource = filteredPath;
    }
    progress(68);

    const fadeOutStart = Math.max(0, req.duration - 0.5);
    const audioFades: string[] = [];
    if (req.fade === 'in' || req.fade === 'all') audioFades.push('afade=t=in:st=0:d=0.5');
    if (req.fade === 'out' || req.fade === 'all') audioFades.push(`afade=t=out:st=${fadeOutStart}:d=0.5`);

    // Этап 5: аудио-дорожка — микс оригинала (concat) и музыки по громкостям.
    if (cancelled()) throw new Error('Экспорт отменён');
    const useMusic = !!req.audioFile && req.volumeMusic > 0;
    let audioTrack: string | null = null;
    if (useOriginal || useMusic) {
      audioTrack = path.join(tmpDir, 'audio.m4a');
      const acmd = ffmpeg();
      const graph: string[] = [];
      let n = 0;
      if (useOriginal) {
        acmd.input(concatPath);
        graph.push(`[${n}:a]volume=${req.volumeOriginal.toFixed(2)}[ao]`);
        n++;
      }
      if (useMusic) {
        acmd.input(req.audioFile as string).inputOptions(['-ss', String(req.segmentStart)]);
        graph.push(`[${n}:a]volume=${req.volumeMusic.toFixed(2)}[am]`);
        n++;
      }
      let label: string;
      if (useOriginal && useMusic) {
        graph.push('[ao][am]amix=inputs=2:duration=first:normalize=0[mx]');
        label = 'mx';
      } else {
        label = useOriginal ? 'ao' : 'am';
      }
      if (audioFades.length) {
        graph.push(`[${label}]${audioFades.join(',')}[fa]`);
        label = 'fa';
      }
      await runCommand(
        acmd
          .complexFilter(graph, [label])
          .outputOptions(['-c:a', 'aac', '-b:a', '192k', '-t', String(req.duration)])
          .output(audioTrack)
          .on('progress', (p) => {
            const pct = Number.isFinite(p.percent) ? (p.percent as number) : 0;
            progress(Math.min(74, 68 + (pct / 100) * 6));
          }),
        hooks
      );
    }
    progress(74);

    // Этап 6a: базовый монтаж (видео + fade + аудио) БЕЗ уникализатора — один раз.
    if (cancelled()) throw new Error('Экспорт отменён');
    const count = Math.max(1, Math.floor(req.count || 1));
    const single = count === 1;
    const baseEnd = single ? 80 : 76; // монотонный прогресс (предыдущие этапы дошли до 74)

    const videoFades: string[] = [];
    if (req.fade === 'in' || req.fade === 'all') videoFades.push('fade=t=in:st=0:d=0.5');
    if (req.fade === 'out' || req.fade === 'all') videoFades.push(`fade=t=out:st=${fadeOutStart}:d=0.5`);

    const basePath = path.join(tmpDir, 'base.mp4');
    const baseCmd = ffmpeg().input(videoSource);
    const baseOut = [
      '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-t', String(req.duration), '-pix_fmt', 'yuv420p',
    ];
    if (audioTrack) {
      baseCmd.input(audioTrack);
      baseOut.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else {
      baseOut.push('-an');
    }
    if (videoFades.length) baseCmd.videoFilters(videoFades);
    await runCommand(
      baseCmd
        .outputOptions(baseOut)
        .output(basePath)
        .on('progress', (p) => {
          const pct = Number.isFinite(p.percent) ? (p.percent as number) : 0;
          progress(Math.min(baseEnd, 74 + (pct / 100) * (baseEnd - 74)));
        }),
      hooks
    );

    // Этап 6b: N уникальных копий. Каждая — свежие фильтры/метаданные/байты.
    const baseHasAudio = !!audioTrack;
    for (let i = 0; i < count; i++) {
      if (cancelled()) throw new Error('Экспорт отменён');
      const out = single ? req.outputPath : suffixPath(req.outputPath, i + 1, count);
      const u = buildUniqualizerFilters(req.uniqualizer, w, h);
      // Режим «видимая вариация»: сильные заметные фильтры, свои для каждой копии.
      const visVf =
        req.uniqualizer.enabled && req.uniqualizer.visibleVariation
          ? buildVisibleVariation(i, w, h)
          : [];
      // Вариация кодирования (CRF/GOP/битрейт/faststart) — структурный fingerprint.
      const enc = req.uniqualizer.enabled ? uniqualizerEncoding() : null;

      const cmd = ffmpeg(basePath);
      const oo = [
        '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'fast',
        '-crf', String(enc ? enc.crf : 23), '-pix_fmt', 'yuv420p',
      ];
      if (enc) oo.push('-g', String(enc.gop));
      if (enc?.faststart) oo.push('-movflags', '+faststart');
      if (baseHasAudio) {
        oo.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', enc ? enc.audioBitrate : '192k');
        if (u.af.length) cmd.audioFilters(u.af);
      } else {
        oo.push('-an');
      }
      const vfAll = [...visVf, ...u.vf];
      if (vfAll.length) cmd.videoFilters(vfAll);
      await runCommand(cmd.outputOptions(oo).output(out), hooks);

      // Метаданные + дозапись байт (уникальный хэш).
      if (req.uniqualizer.enabled) {
        await randomizeMetadata(out, hooks);
        await appendRandomBytes(out);
      }
      progress(baseEnd + ((i + 1) / count) * (100 - baseEnd));
    }

    progress(100);
    cleanup();
  } catch (err) {
    cleanup();
    throw err;
  }
}
