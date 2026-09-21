import { app, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

// Общий для Pulsar и отдельного приложения «Метаданные»: превью локальных
// файлов в renderer идут через media:///<encoded-abs-path>.

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** Привилегированная схема — до app.ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

/** media:///<encoded-abs-path> -> потоковая отдача локального файла с поддержкой Range. */
export function handleMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const encoded = request.url.slice('media://'.length).replace(/^\/+/, '');
    let filePath = decodeURIComponent(encoded);
    // Относительные пути (assets/music/...) резолвим от корня приложения/ресурсов.
    if (!path.isAbsolute(filePath)) {
      const base = app.isPackaged
        ? process.resourcesPath
        : (process.env.APP_ROOT ?? process.cwd());
      filePath = path.join(base, filePath);
    }
    try {
      const stat = await fs.promises.stat(filePath);
      const total = stat.size;
      const type = MIME[path.extname(filePath).toLowerCase()];
      // Схема отдаёт только медиа и шрифты: произвольный файл диска через
      // media:// читать нельзя, даже если рендерер попросит.
      if (!type) return new Response('unsupported', { status: 404 });
      const rangeHeader = request.headers.get('Range');
      // Ограничение размера чанка: для открытых range (bytes=0-) не тянем весь
      // файл в память — отдаём кусок, <video> дозапросит остальное.
      const MAX_CHUNK = 4 * 1024 * 1024;

      let start = 0;
      let end = total - 1;
      let partial = false;
      // Только для Range-запросов (нативный <video> стримит чанками) ограничиваем
      // размер куска. Запрос без Range (fetch(...).blob() в превью/аудио) означает
      // «отдай файл целиком» — иначе blob получится обрезанным до MAX_CHUNK и битым.
      if (rangeHeader) {
        const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        start = match ? parseInt(match[1], 10) : 0;
        const openEnded = !(match && match[2]);
        end = openEnded ? total - 1 : parseInt(match![2], 10);
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (end < start) end = start;
        if (openEnded && end - start + 1 > MAX_CHUNK) end = start + MAX_CHUNK - 1;
        partial = true;
      }
      const len = end - start + 1;
      // Поток, а не буфер: fd.read одним вызовом падал нативным assert на файле
      // ≥ 2 ГиБ (длина не влезала в int32) и ронял main мимо всех обработчиков,
      // а на меньших держал весь файл в памяти до конца ответа.
      const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
      const body = Readable.toWeb(stream) as unknown as ReadableStream;
      return new Response(body, {
        status: partial ? 206 : 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(len),
          ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      console.error('[media protocol] error', filePath, err);
      return new Response('Not found', { status: 404 });
    }
  });
}
