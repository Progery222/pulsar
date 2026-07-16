import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Запись экрана (нативный модуль Pulsar). Захват через desktopCapturer + getDisplayMedia
// в renderer (MediaRecorder), трекинг курсора для авто-зума в редакторе, ремукс в mp4
// встроенным ffmpeg. См. src/recorder/*.

const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');

// Цепочка atempo для произвольного коэффициента (ffmpeg atempo: 0.5..2 за один шаг).
function atempoChain(factor: number): string[] {
  const parts: string[] = [];
  let f = factor;
  while (f > 2) { parts.push('atempo=2.0'); f /= 2; }
  while (f < 0.5) { parts.push('atempo=0.5'); f *= 2; }
  if (Math.abs(f - 1) > 0.001) parts.push(`atempo=${f.toFixed(4)}`);
  return parts;
}

export interface CursorSample {
  t: number; // мс от старта записи
  x: number; // абсолютные экранные DIP-координаты
  y: number;
}

interface RecordedDisplay {
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

// Выбранный источник для setDisplayMediaRequestHandler (без системного пикера).
let selectedSourceId: string | null = null;

// Плавающее окно-контрол во время записи.
let controlWin: BrowserWindow | null = null;
// Окно заметок (сценарий) во время записи.
let notesWin: BrowserWindow | null = null;

function loadWindow(win: BrowserWindow, query: Record<string, string>) {
  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    const qs = new URLSearchParams(query).toString();
    win.loadURL(`${devUrl}?${qs}`);
  } else {
    win.loadFile(path.join(process.env.APP_ROOT ?? '', 'dist', 'index.html'), { query });
  }
}

// Состояние трекинга курсора.
let cursorTimer: NodeJS.Timeout | null = null;
let cursorSamples: CursorSample[] = [];
let cursorStartTime = 0;
let recordedDisplay: RecordedDisplay | null = null;

function recordingsDir(): string {
  const dir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Дисплей, соответствующий выбранному screen-источнику desktopCapturer.
function displayForSource(sourceId: string | null): RecordedDisplay {
  const displays = screen.getAllDisplays();
  let display = screen.getPrimaryDisplay();
  if (sourceId?.startsWith('screen:')) {
    // Формат id: "screen:<display_id>:0" — сопоставляем с display.id.
    const idPart = sourceId.split(':')[1];
    const match = displays.find((d) => String(d.id) === idPart);
    if (match) display = match;
  }
  return {
    bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
    scaleFactor: display.scaleFactor,
  };
}

export function registerRecorderHandlers(getMainWindow: () => BrowserWindow | null) {
  // Разрешения на захват экрана/микрофона (локальное доверенное приложение — разрешаем всё).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  // Источник захвата фулфилится нашим выбором (без OS-пикера).
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const sources = desktopCapturer.getSources({ types: ['screen', 'window'] });
      Promise.resolve(sources).then((list) => {
        const source = list.find((s) => s.id === selectedSourceId) ?? list[0];
        if (!request.videoRequested || !source) {
          callback({});
          return;
        }
        callback({
          video: source,
          // Системный звук (loopback) — только Windows.
          ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' as const } : {}),
        });
      });
    },
    // useSystemPicker выключен — источник выбираем в нашем UI.
    { useSystemPicker: false }
  );

  // Список источников с превью для нашего UI выбора.
  ipcMain.handle('recorder:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
  });

  // Зафиксировать выбранный источник (используется display-media-handler'ом).
  ipcMain.handle('recorder:selectSource', (_e, sourceId: string) => {
    selectedSourceId = sourceId;
    return { ok: true };
  });

  // Старт трекинга курсора (60 Гц). Возвращает bounds/scale дисплея для нормализации.
  ipcMain.handle('recorder:cursorStart', () => {
    recordedDisplay = displayForSource(selectedSourceId);
    cursorSamples = [];
    cursorStartTime = Date.now();
    if (cursorTimer) clearInterval(cursorTimer);
    cursorTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      cursorSamples.push({ t: Date.now() - cursorStartTime, x: p.x, y: p.y });
    }, 1000 / 60);
    return { ok: true, display: recordedDisplay };
  });

  // Стоп трекинга — вернуть собранные сэмплы и метаданные дисплея.
  ipcMain.handle('recorder:cursorStop', () => {
    if (cursorTimer) {
      clearInterval(cursorTimer);
      cursorTimer = null;
    }
    return { samples: cursorSamples, display: recordedDisplay };
  });

  // Свернуть/восстановить главное окно во время записи (чтобы наш UI не мешал кадру).
  ipcMain.handle('recorder:minimizeMain', () => {
    getMainWindow()?.minimize();
    return { ok: true };
  });
  ipcMain.handle('recorder:restoreMain', () => {
    const w = getMainWindow();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
    return { ok: true };
  });

  // Сохранить сырую запись (webm-байты из MediaRecorder) в recordings-каталог.
  ipcMain.handle('recorder:saveWebm', async (_e, data: ArrayBuffer) => {
    const dir = recordingsDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(dir, `recording-${stamp}.webm`);
    await fs.promises.writeFile(out, Buffer.from(data));
    return { ok: true as const, path: out };
  });

  // Ремукс/транскод webm → mp4 (H.264 + AAC) для универсальной совместимости.
  ipcMain.handle('recorder:toMp4', async (e, webmPath: string, outPath: string) => {
    if (!ffmpegBin) return { error: 'ffmpeg не найден' };
    const args = [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outPath,
    ];
    return await new Promise<{ ok: true; path: string } | { error: string }>((resolve) => {
      const ch = spawn(ffmpegBin, args, { windowsHide: true });
      let dur = 0;
      let err = '';
      ch.stderr.on('data', (d: Buffer) => {
        const s = d.toString();
        err += s;
        const dm = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(s);
        if (dm) dur = +dm[1] * 3600 + +dm[2] * 60 + +dm[3];
        const tm = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
        if (tm && dur > 0) {
          const t = +tm[1] * 3600 + +tm[2] * 60 + +tm[3];
          e.sender.send('recorder:mp4Progress', Math.min(99, Math.round((t / dur) * 100)));
        }
      });
      ch.on('close', (code) => {
        if (code === 0 && fs.existsSync(outPath)) resolve({ ok: true, path: outPath });
        else resolve({ error: err.slice(-500) || `ffmpeg код ${code}` });
      });
      ch.on('error', (er) => resolve({ error: er.message }));
    });
  });

  // Показать файл в проводнике.
  ipcMain.handle('recorder:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  // Покадровый экспорт: кадры (frame_%06d.jpg в temp-папке) → mp4/gif через ffmpeg.
  // Аудио для mp4 собирается из исходника по оставшимся сегментам + скорость.
  ipcMain.handle('recorder:encodeFrames', async (e, opts: {
    dir: string;
    fps: number;
    format: 'mp4' | 'gif';
    audioSrc?: string;
    segments: { s: number; e: number }[];
    speed: number;
    frameCount: number;
    outPath: string;
  }) => {
    if (!ffmpegBin) return { error: 'ffmpeg не найден' };
    const framePattern = path.join(opts.dir, 'frame_%06d.jpg');
    const fps = Number(opts.fps) || 30;

    const runFfmpeg = (args: string[]) =>
      new Promise<{ ok: true } | { error: string }>((resolve) => {
        let err = '';
        const ch = spawn(ffmpegBin, args, { windowsHide: true });
        ch.stderr.on('data', (d: Buffer) => {
          const s = d.toString();
          err += s;
          if (err.length > 8000) err = err.slice(-8000);
          const fm = /frame=\s*(\d+)/.exec(s);
          if (fm && opts.frameCount > 0) {
            e.sender.send('recorder:encodeProgress', Math.min(99, 80 + Math.round((+fm[1] / opts.frameCount) * 20)));
          }
        });
        ch.on('close', (code) => resolve(code === 0 ? { ok: true } : { error: err.slice(-800) || `ffmpeg exit ${code}` }));
        ch.on('error', (er) => resolve({ error: er.message }));
      });

    let result: { ok: true } | { error: string };
    if (opts.format === 'gif') {
      result = await runFfmpeg([
        '-y', '-framerate', String(fps), '-i', framePattern,
        '-vf', 'fps=15,scale=iw*0.6:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer',
        opts.outPath,
      ]);
    } else {
      const base = ['-y', '-framerate', String(fps), '-i', framePattern];
      const vcodec = ['-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-movflags', '+faststart'];
      // Аудио из исходника по сегментам (source-time) + atempo под скорость.
      const withAudio = opts.audioSrc && opts.segments.length > 0;
      if (withAudio) {
        const segs = opts.segments;
        const trim = segs.map((sg, i) => `[1:a]atrim=${sg.s.toFixed(3)}:${sg.e.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`).join(';');
        const concat = segs.map((_, i) => `[a${i}]`).join('') + `concat=n=${segs.length}:v=0:a=1[ac]`;
        const sp = Number(opts.speed) || 1;
        const tempo = Math.abs(sp - 1) > 0.001 ? `;[ac]${atempoChain(sp).join(',')}[aout]` : '';
        const outLabel = tempo ? '[aout]' : '[ac]';
        const filter = `${trim};${concat}${tempo}`;
        const args = [...base, '-i', opts.audioSrc!, '-filter_complex', filter, '-map', '0:v', '-map', outLabel, ...vcodec, '-c:a', 'aac', '-b:a', '192k', '-shortest', opts.outPath];
        result = await runFfmpeg(args);
        // Фолбэк без звука (напр. в записи не было аудиодорожки).
        if ('error' in result) {
          result = await runFfmpeg([...base, ...vcodec, '-an', opts.outPath]);
        }
      } else {
        result = await runFfmpeg([...base, ...vcodec, '-an', opts.outPath]);
      }
    }

    try {
      await fs.promises.rm(opts.dir, { recursive: true, force: true });
    } catch {
      /* не критично */
    }
    return 'error' in result ? result : { ok: true as const, path: opts.outPath };
  });

  // Открыть плавающий контрол (кнопки Стоп/Пауза) — always-on-top, снизу по центру.
  ipcMain.handle('recorder:openControl', () => {
    if (controlWin && !controlWin.isDestroyed()) {
      controlWin.focus();
      return { ok: true };
    }
    const primary = screen.getPrimaryDisplay().workArea;
    const w = 260;
    const h = 56;
    controlWin = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(primary.x + (primary.width - w) / 2),
      y: Math.round(primary.y + primary.height - h - 24),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: false,
      webPreferences: {
        preload: path.join(process.env.APP_ROOT ?? '', 'dist-electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    controlWin.setAlwaysOnTop(true, 'screen-saver');
    loadWindow(controlWin, { win: 'recControl' });
    controlWin.on('closed', () => {
      controlWin = null;
    });
    return { ok: true };
  });

  ipcMain.handle('recorder:closeControl', () => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.close();
    controlWin = null;
    return { ok: true };
  });

  // Окно заметок/сценария во время записи.
  ipcMain.handle('recorder:openNotes', () => {
    if (notesWin && !notesWin.isDestroyed()) {
      notesWin.focus();
      return { ok: true };
    }
    const primary = screen.getPrimaryDisplay().workArea;
    const w = 340;
    const h = 460;
    notesWin = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(primary.x + primary.width - w - 24),
      y: Math.round(primary.y + 24),
      frame: false,
      transparent: false,
      backgroundColor: '#0d0d10',
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(process.env.APP_ROOT ?? '', 'dist-electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    notesWin.setAlwaysOnTop(true, 'screen-saver');
    // Не попадать в кадр захвата экрана.
    try {
      notesWin.setContentProtection(true);
    } catch {
      /* не критично */
    }
    loadWindow(notesWin, { win: 'recNotes' });
    notesWin.on('closed', () => {
      notesWin = null;
    });
    return { ok: true };
  });
  ipcMain.handle('recorder:closeNotes', () => {
    if (notesWin && !notesWin.isDestroyed()) notesWin.close();
    notesWin = null;
    return { ok: true };
  });

  // Команда от контрола (stop/pause/resume) → главному окну, где живёт MediaRecorder.
  ipcMain.on('recorder:controlAction', (_e, action: 'stop' | 'pause' | 'resume') => {
    getMainWindow()?.webContents.send('recorder:controlAction', action);
  });

  // Состояние записи от главного окна → контролу (таймер, пауза).
  ipcMain.on('recorder:pushState', (_e, state: { elapsed: number; paused: boolean }) => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('recorder:state', state);
  });
}
