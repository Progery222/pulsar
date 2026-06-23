import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EFFECTS } from '../../src/data/effects';
import { FILTERS } from '../../src/data/filters';
import type { EffectName, FilterName } from '../../src/types';

// Bundled FFmpeg (§2 ТЗ). В упакованном приложении бинарник распакован из asar.
const ffmpegPath = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

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

function runCommand(cmd: ffmpeg.FfmpegCommand, hooks: RenderHooks): Promise<void> {
  return new Promise((resolve, reject) => {
    hooks.setCommand?.(cmd);
    cmd.on('end', () => {
      hooks.setCommand?.(null);
      resolve();
    });
    cmd.on('error', (err) => {
      hooks.setCommand?.(null);
      reject(err);
    });
    cmd.run();
  });
}

// FFmpeg Pipeline (§10): 6 этапов. Чистая функция без Electron-зависимостей.
export async function renderProject(req: RenderRequest, hooks: RenderHooks = {}): Promise<void> {
  const cancelled = () => hooks.getCancelled?.() ?? false;
  const progress = (p: number) => hooks.onProgress?.(Math.max(0, Math.min(100, Math.round(p))));

  const tmpDir = path.join(os.tmpdir(), `beatleap-${Date.now()}`);
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

    // Этап 1–2: нарезка фрагментов + эффекты (глобальный фильтр — отдельным этапом).
    const fragments: string[] = [];
    for (let i = 0; i < req.clips.length; i++) {
      if (cancelled()) throw new Error('Экспорт отменён');
      const clip = req.clips[i];
      const fragPath = path.join(tmpDir, `fragment_${i}.mp4`);
      const filters = [scaleChain, ...effectFilters(clip.effects, w, h)];

      await runCommand(
        ffmpeg(clip.sourceFile)
          .seekInput(clip.startTime)
          .duration(clip.duration)
          .videoFilters(filters)
          .noAudio()
          .outputOptions(['-pix_fmt', 'yuv420p', '-r', '30'])
          .output(fragPath),
        hooks
      );
      fragments.push(fragPath);
      progress((i / req.clips.length) * 55);
    }

    // Этап 4: склейка (concat demuxer).
    const listPath = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(
      listPath,
      fragments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
    );
    let videoSource = path.join(tmpDir, 'concat.mp4');
    await runCommand(
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(videoSource),
      hooks
    );
    progress(62);

    // Этап 3: глобальный фильтр с учётом filterIntensity (blend по K = intensity/100).
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
      await runCommand(cmd.outputOptions(['-pix_fmt', 'yuv420p']).output(filteredPath), hooks);
      videoSource = filteredPath;
    }
    progress(70);

    // Этап 5–6: аудио + fade + финальный экспорт H.264/AAC.
    if (cancelled()) throw new Error('Экспорт отменён');
    const final = ffmpeg().input(videoSource);

    const videoFades: string[] = [];
    const audioFades: string[] = [];
    const fadeOutStart = Math.max(0, req.duration - 0.5);
    if (req.fade === 'in' || req.fade === 'all') {
      videoFades.push('fade=t=in:st=0:d=0.5');
      audioFades.push('afade=t=in:st=0:d=0.5');
    }
    if (req.fade === 'out' || req.fade === 'all') {
      videoFades.push(`fade=t=out:st=${fadeOutStart}:d=0.5`);
      audioFades.push(`afade=t=out:st=${fadeOutStart}:d=0.5`);
    }

    const outOptions = [
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-t', String(req.duration), '-pix_fmt', 'yuv420p',
    ];

    if (req.audioFile) {
      final.input(req.audioFile).inputOptions(['-ss', String(req.segmentStart)]);
      outOptions.push('-c:a', 'aac', '-b:a', '192k', '-map', '0:v:0', '-map', '1:a:0', '-shortest');
      if (audioFades.length) final.audioFilters(audioFades);
    } else {
      outOptions.push('-an');
    }
    if (videoFades.length) final.videoFilters(videoFades);

    await runCommand(
      final
        .outputOptions(outOptions)
        .output(req.outputPath)
        .on('progress', (p) => progress(70 + ((p.percent ?? 0) / 100) * 30)),
      hooks
    );

    progress(100);
    cleanup();
  } catch (err) {
    cleanup();
    throw err;
  }
}
