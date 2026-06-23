import { app, BrowserWindow, ipcMain } from 'electron';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EFFECTS } from '../../src/data/effects';
import { FILTERS } from '../../src/data/filters';
import type { EffectName, FilterName } from '../../src/types';

type Quality = '720p' | '1080p' | '4k';
type Format = '9:16' | '1:1' | '16:9';

interface RenderClip {
  sourceFile: string;
  startTime: number;
  duration: number;
  effects: EffectName[];
}

interface RenderRequest {
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

const LONG: Record<Quality, number> = { '720p': 1280, '1080p': 1920, '4k': 3840 };
const SHORT: Record<Quality, number> = { '720p': 720, '1080p': 1080, '4k': 2160 };

function dimensions(format: Format, quality: Quality): [number, number] {
  const l = LONG[quality];
  const s = SHORT[quality];
  if (format === '16:9') return [l, s];
  if (format === '9:16') return [s, l];
  return [s, s]; // 1:1
}

// Простые видеофильтры эффекта (исключаем сложные графы с ';' и tile/split).
function effectFilters(effects: EffectName[]): string[] {
  const out: string[] = [];
  for (const name of effects) {
    const meta = EFFECTS.find((e) => e.key === name);
    if (!meta || !meta.ffmpeg) continue;
    if (meta.ffmpeg.includes(';') || meta.ffmpeg.startsWith('tile')) continue;
    out.push(meta.ffmpeg);
  }
  return out;
}

function globalFilter(filter: FilterName | null): string | null {
  if (!filter) return null;
  const meta = FILTERS.find((f) => f.key === filter);
  return meta?.ffmpeg || null;
}

let currentCommand: ffmpeg.FfmpegCommand | null = null;
let cancelled = false;

function runCommand(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    currentCommand = cmd;
    cmd.on('end', () => {
      currentCommand = null;
      resolve();
    });
    cmd.on('error', (err) => {
      currentCommand = null;
      reject(err);
    });
    cmd.run();
  });
}

export function registerFfmpegHandlers() {
  ipcMain.handle('ffmpeg:render', async (event, req: RenderRequest) => {
    cancelled = false;
    const sender = BrowserWindow.fromWebContents(event.sender);
    const sendProgress = (p: number) =>
      sender?.webContents.send('export-progress', Math.max(0, Math.min(100, Math.round(p))));

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
      const gFilter = req.filterIntensity > 0 ? globalFilter(req.filter) : null;

      // Этап 1–3: нарезка фрагментов + эффекты + глобальный фильтр.
      const fragments: string[] = [];
      for (let i = 0; i < req.clips.length; i++) {
        if (cancelled) throw new Error('Экспорт отменён');
        const clip = req.clips[i];
        const fragPath = path.join(tmpDir, `fragment_${i}.mp4`);
        const filters = [scaleChain, ...effectFilters(clip.effects)];
        if (gFilter) filters.push(gFilter);

        await runCommand(
          ffmpeg(clip.sourceFile)
            .seekInput(clip.startTime)
            .duration(clip.duration)
            .videoFilters(filters)
            .noAudio()
            .outputOptions(['-pix_fmt', 'yuv420p', '-r', '30'])
            .output(fragPath)
        );
        fragments.push(fragPath);
        sendProgress((i / req.clips.length) * 60);
      }

      // Этап 4: склейка фрагментов (concat demuxer).
      const listPath = path.join(tmpDir, 'concat.txt');
      fs.writeFileSync(
        listPath,
        fragments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
      );
      const concatPath = path.join(tmpDir, 'concat.mp4');
      await runCommand(
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(concatPath)
      );
      sendProgress(70);

      // Этап 5–6: аудио + fade + финальный экспорт H.264/AAC.
      if (cancelled) throw new Error('Экспорт отменён');
      const final = ffmpeg().input(concatPath);

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
          .on('progress', (p) => {
            const pct = p.percent ?? 0;
            sendProgress(70 + (pct / 100) * 30);
          })
      );

      sendProgress(100);
      cleanup();
      return { ok: true };
    } catch (err) {
      cleanup();
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Отмена экспорта (§14): прерывание FFmpeg-процесса.
  ipcMain.handle('ffmpeg:cancel', () => {
    cancelled = true;
    try {
      currentCommand?.kill('SIGKILL');
    } catch {
      /* noop */
    }
    return { ok: true };
  });
}

// Гарантируем, что app импортируется (для будущего использования путей ресурсов).
void app;
