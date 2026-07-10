import { app } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EFFECTS } from '../../src/data/effects';
import { FILTERS } from '../../src/data/filters';
import { buildClipVideoGraph, type RenderEffectSlot } from '../../src/data/effectRender';
import type { FilterName } from '../../src/types';
import type { UniqualizerSettings } from '../../src/types/uniqualizer';
import { buildUniqualizerFilters, buildVisibleVariation, randomMetadata, uniqualizerEncoding } from '../../src/utils/uniqualizer';
import { videoEncoderOptions } from './encoder';
import { appendFreeAtom } from './mp4util';

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
// Стиль переходов между клипами (xfade). 'none' = жёсткие резы (как раньше).
export type TransitionStyle = 'none' | 'dissolve' | 'slide' | 'zoom' | 'mix';

// Длительность фрагмента (для расчёта смещений xfade).
function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(file, (err, data) => resolve(err || !data ? 0 : data.format?.duration ?? 0));
  });
}

// Наборы переходов xfade по стилю (используем широко поддерживаемые значения).
const XFADE: Record<Exclude<TransitionStyle, 'none'>, string[]> = {
  dissolve: ['fade', 'dissolve'],
  slide: ['slideleft', 'slideright', 'slideup', 'slidedown'],
  zoom: ['circleopen', 'circleclose', 'radial', 'smoothleft'],
  mix: ['fade', 'dissolve', 'slideleft', 'slideright', 'smoothleft', 'smoothright', 'circleopen', 'circleclose', 'wipeleft', 'radial'],
};

function pickTransition(style: Exclude<TransitionStyle, 'none'>, i: number): string {
  const set = XFADE[style];
  return set[(i - 1) % set.length];
}

export interface RenderClip {
  sourceFile: string;
  startTime: number;
  duration: number;
  effects: RenderEffectSlot[];
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
  transition?: TransitionStyle; // переходы между клипами (по умолчанию none)
  title?: RenderTitle | null; // заголовок-текст поверх видео
  outputPath: string;
}

// Заголовок (текст) поверх монтажа — простая «капкат-подобная» подпись.
export interface RenderTitle {
  text: string;
  position: 'top' | 'center' | 'bottom';
  size: number; // высота шрифта в px (для 1080-кадра)
  color: string; // HEX
  box: boolean; // подложка под текстом
}

// Папка встроенных шрифтов (dev vs упакованное).
function fontsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'fonts')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'assets', 'fonts');
}
function escDrawtext(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "’").replace(/%/g, '\\%');
}
function escFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
// drawtext-фильтр заголовка: позиция + подложка + плавное появление/исчезание.
function buildTitleFilter(title: RenderTitle, h: number, duration: number): string | null {
  const text = title.text.trim();
  if (!text) return null;
  const font = path.join(fontsDir(), 'Montserrat.ttf');
  const fontPart = fs.existsSync(font) ? `fontfile='${escFilterPath(font)}':` : '';
  const fontsize = Math.round((title.size / 1080) * h);
  const color = title.color.startsWith('#') ? `0x${title.color.slice(1)}` : title.color;
  const y = title.position === 'top' ? 'h*0.10' : title.position === 'center' ? '(h-text_h)/2' : 'h*0.80';
  const dur = Math.max(1, duration);
  const alpha = `'if(lt(t,0.3),t/0.3,if(gt(t,${(dur - 0.3).toFixed(2)}),max(0,(${dur.toFixed(2)}-t)/0.3),1))'`;
  const box = title.box ? `:box=1:boxcolor=black@0.4:boxborderw=${Math.round(fontsize * 0.35)}` : '';
  return `drawtext=${fontPart}text='${escDrawtext(text)}':fontsize=${fontsize}:fontcolor=${color}:x=(w-text_w)/2:y=${y}:alpha=${alpha}${box}`;
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

// Фрагменты кодируются в 30 fps (-r 30) — этот же fps передаём в построитель графа.
// Полный видео-граф фрагмента (тайминг/вариант/интенсивность как в превью, плюс
// speed/split) собирается в src/data/effectRender.ts → buildClipVideoGraph.
const RENDER_FPS = 30;

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

// Уникализатор §2: меняем хэш валидным free-атомом (не ломает контейнер).
async function appendRandomBytes(filePath: string): Promise<void> {
  await appendFreeAtom(filePath);
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
      // Единый видео-граф фрагмента (scaleChain + импульсы эффектов + опц. speed/split).
      // rate !== 1 означает изменение темпа: видео уже сжато/растянуто к clip.duration
      // через setpts, поэтому исходный звук синхронизируем atempo с тем же rate.
      const { graph, rate } = buildClipVideoGraph(clip.effects, scaleChain, w, h, RENDER_FPS);

      let fragCmd: ffmpeg.FfmpegCommand;
      if (useOriginal) {
        const srcHasAudio = audioMap.get(clip.sourceFile) ?? false;
        if (srcHasAudio) {
          // Реальный звук источника (+ atempo при изменении темпа).
          const aGraph = rate !== 1 ? `;[0:a]atempo=${rate}[a]` : '';
          const aMap = rate !== 1 ? '[a]' : '0:a:0';
          fragCmd = ffmpeg(clip.sourceFile)
            .seekInput(clip.startTime)
            .duration(clip.duration)
            .complexFilter([`${graph}${aGraph}`])
            .outputOptions([
              '-map', '[v]', '-map', aMap, '-pix_fmt', 'yuv420p', '-r', '30',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
            ]);
        } else {
          // У источника нет аудио — подставляем тишину (концат остаётся консистентным).
          fragCmd = ffmpeg(clip.sourceFile)
            .seekInput(clip.startTime)
            .duration(clip.duration)
            .input('anullsrc=channel_layout=stereo:sample_rate=44100')
            .inputOptions(['-f', 'lavfi', '-t', String(clip.duration)])
            .complexFilter([graph])
            .outputOptions([
              '-map', '[v]', '-map', '1:a:0', '-pix_fmt', 'yuv420p', '-r', '30',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
            ]);
        }
      } else {
        fragCmd = ffmpeg(clip.sourceFile)
          .seekInput(clip.startTime)
          .duration(clip.duration)
          .complexFilter([graph])
          .noAudio()
          .outputOptions(['-map', '[v]', '-pix_fmt', 'yuv420p', '-r', '30']);
      }
      await runCommand(fragCmd.output(fragPath), hooks);
      fragments.push(fragPath);
      progress((i / req.clips.length) * 55);
    }

    // Этап 4: склейка. Переходы (xfade) или жёсткие резы (concat demuxer).
    const concatPath = path.join(tmpDir, 'concat.mp4');
    let videoSource = concatPath;
    const transition = req.transition && req.transition !== 'none' ? req.transition : null;

    if (transition && fragments.length > 1) {
      // Кроссфейд-переходы: фрагменты накладываются на D сек со сменой по xfade,
      // аудио — acrossfade. Смещения считаются по реальной длительности фрагментов.
      const durs = await Promise.all(fragments.map(probeDuration));
      const minDur = Math.min(...durs.filter((d) => d > 0), 1);
      const D = Math.max(0.12, Math.min(0.3, minDur * 0.4));
      const xcmd = ffmpeg();
      fragments.forEach((f) => xcmd.input(f));
      const fc: string[] = [];
      // Видео-цепочка xfade.
      let prevV = '[0:v]';
      let runningLen = durs[0] || minDur;
      for (let i = 1; i < fragments.length; i++) {
        const off = Math.max(0, runningLen - D);
        const out = i === fragments.length - 1 ? 'vout' : `vx${i}`;
        fc.push(`${prevV}[${i}:v]xfade=transition=${pickTransition(transition, i)}:duration=${D.toFixed(3)}:offset=${off.toFixed(3)}[${out}]`);
        prevV = `[${out}]`;
        runningLen = runningLen + (durs[i] || minDur) - D;
      }
      const maps = ['-map', '[vout]'];
      // Аудио-цепочка acrossfade (фрагменты имеют звук только при useOriginal).
      if (useOriginal) {
        let prevA = '[0:a]';
        for (let i = 1; i < fragments.length; i++) {
          const out = i === fragments.length - 1 ? 'aout' : `ax${i}`;
          fc.push(`${prevA}[${i}:a]acrossfade=d=${D.toFixed(3)}[${out}]`);
          prevA = `[${out}]`;
        }
        maps.push('-map', '[aout]', '-c:a', 'aac', '-ar', '44100', '-ac', '2');
      }
      const xenc = await videoEncoderOptions({ preset: 'veryfast', crf: 20 });
      await runCommand(
        xcmd.complexFilter(fc).outputOptions([...maps, ...xenc, '-pix_fmt', 'yuv420p', '-r', '30']).output(concatPath),
        hooks
      );
    } else {
      const listPath = path.join(tmpDir, 'concat.txt');
      fs.writeFileSync(
        listPath,
        fragments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
      );
      await runCommand(
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(concatPath),
        hooks
      );
    }
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
      await runCommand(cmd.noAudio().outputOptions(['-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium']).output(filteredPath), hooks);
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

    // Родной звук исходника используем, если отдельная музыкальная дорожка не выбрана.
    const sourceHasAudio = audioTrack ? false : await hasAudio(videoSource);

    const basePath = path.join(tmpDir, 'base.mp4');
    const baseCmd = ffmpeg().input(videoSource);
    const baseVenc = await videoEncoderOptions({ preset: 'slow', crf: 18 });
    const baseOut = [
      '-map', '0:v:0', ...baseVenc,
      '-t', String(req.duration), '-pix_fmt', 'yuv420p',
    ];
    if (audioTrack) {
      baseCmd.input(audioTrack);
      baseOut.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else if (sourceHasAudio) {
      baseOut.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else {
      baseOut.push('-an');
    }
    const baseVf = [...videoFades];
    if (req.title) {
      const tf = buildTitleFilter(req.title, h, req.duration);
      if (tf) baseVf.push(tf);
    }
    if (baseVf.length) baseCmd.videoFilters(baseVf);
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
    const baseHasAudio = !!audioTrack || sourceHasAudio;
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
      const copyVenc = await videoEncoderOptions({
        preset: enc ? 'fast' : 'medium',
        crf: enc ? enc.crf : 18,
        gop: enc ? enc.gop : undefined,
      });
      const oo = ['-map', '0:v:0', ...copyVenc, '-pix_fmt', 'yuv420p'];
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
