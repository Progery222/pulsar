import { ipcMain, dialog, shell, app } from 'electron';
import exifr from 'exifr';
import fs from 'node:fs';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';

// Модуль «Метаданные» — инспектор + редактор: загрузил фото → видишь всё (EXIF, GPS, XMP,
// C2PA/Content Credentials, вердикт ИИ/реал) и можешь править любое поле, удалять, чистить всё.

const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'avif', 'gif'];

const exiftoolBin = (require('exiftool-vendored.exe') as string).replace('app.asar', 'app.asar.unpacked');
let et: ExifTool | null = null;
const tool = (): ExifTool => (et ??= new ExifTool({ exiftoolPath: exiftoolBin, taskTimeoutMillis: 20000 }));

// Ключ псевдо-поля координат: правится одной строкой «широта, долгота».
const GPS_KEY = '__gps';
const GPS_TAGS = ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'GPSPosition', 'GPSDateStamp', 'GPSTimeStamp', 'GPSDateTime'];

// Поля, которые описывают сам пиксельный буфер — править их бессмысленно (файл от этого не изменится).
const READONLY_TAGS = new Set(['ImageWidth', 'ImageHeight', 'ImageSize', 'Megapixels', 'FileSize', 'FileType', 'MIMEType', 'Compression', 'BitsPerSample', 'SamplesPerPixel', 'PhotometricInterpretation', 'StripOffsets', 'StripByteCounts', 'RowsPerStrip', 'PlanarConfiguration', 'YCbCrSubSampling', 'ThumbnailOffset', 'ThumbnailLength']);

interface MetaRow { tag: string; label: string; value: string; editable: boolean }
interface MetaGroup { title: string; rows: MetaRow[]; }
interface MetaSummary {
  camera: string | null;
  gps: string | null;
  shotDate: string | null;
  c2pa: boolean;
  stripped: boolean; // EXIF/GPS/дата отсутствуют — похоже, вырезаны (мессенджер/соцсеть)
}
interface MetaResult {
  file: string;
  name: string;
  sizeKB: number;
  verdict: 'ai' | 'camera' | 'unknown';
  verdictText: string;
  summary: MetaSummary;
  groups: MetaGroup[];
  gps: { lat: number; lon: number } | null;
  writable: boolean; // формат, в который exiftool умеет писать
  error?: string;
}

// В какие форматы exiftool умеет писать метаданные (у AVIF/GIF поддержка неполная).
const WRITABLE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif', '.avif']);

const two = (n: number) => String(n).padStart(2, '0');
// Даты показываем в EXIF-формате «2024:05:01 13:45:07» — так же их и принимает exiftool при записи.
const fmtDate = (d: Date) => `${d.getFullYear()}:${two(d.getMonth() + 1)}:${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

const fmt = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : fmtDate(v);
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const row = (tag: string, value: string, editable = !READONLY_TAGS.has(tag), label = tag): MetaRow => ({ tag, label, value, editable });

// Лёгкое чтение C2PA/Content Credentials из сырых байтов (без крипто-валидации):
// достаём читаемые строки провенанса — генератор, тип источника, действия, даты.
function scanC2PA(buf: Buffer): { present: boolean; rows: [string, string][] } {
  const rows: [string, string][] = [];
  const ascii = buf.toString('latin1');
  // Признак JUMBF/C2PA.
  const present = /c2pa|jumbf|urn:uuid:|contentauth|c2pa\.assertions/i.test(ascii) && /c2pa/i.test(ascii);
  if (!present) return { present: false, rows };
  const pick = (label: string, re: RegExp) => {
    const m = ascii.match(re);
    if (m && m[1]) rows.push([label, m[1].replace(/[^\x20-\x7E].*$/, '').trim().slice(0, 120)]);
  };
  pick('Генератор (softwareAgent)', /softwareAgent[^A-Za-z0-9]{0,6}([A-Za-z0-9 ._-]{2,60})/);
  pick('claim_generator', /claim_generator[^A-Za-z0-9]{0,6}([A-Za-z0-9 ._\/-]{2,80})/);
  pick('Тип источника (digitalSourceType)', /digitalSourceType[^A-Za-z]{0,6}([A-Za-z:.\/_-]{4,80})/);
  pick('Издатель подписи', /(OpenAI[^"'\\]{0,40}|Adobe[^"'\\]{0,40}|Google[^"'\\]{0,40}|Leica[^"'\\]{0,40})/);
  const actions = [...ascii.matchAll(/c2pa\.(created|converted|edited|opened|watermarked[.\w]*)/g)].map((m) => m[1]);
  if (actions.length) rows.push(['Действия', [...new Set(actions)].join(', ')]);
  if (/trainedAlgorithmicMedia/i.test(ascii)) rows.push(['Пометка', 'trainedAlgorithmicMedia (ИИ-генерация)']);
  if (/watermark/i.test(ascii)) rows.push(['Watermark', 'в манифесте есть отметка о водяном знаке']);
  return { present, rows };
}

async function readMeta(file: string): Promise<MetaResult> {
  const name = path.basename(file);
  const buf = await fs.promises.readFile(file);
  const sizeKB = Math.round(buf.length / 1024);
  const groups: MetaGroup[] = [];
  let gps: { lat: number; lon: number } | null = null;

  // EXIF / GPS / XMP / IPTC / ICC.
  let exif: Record<string, unknown> = {};
  try {
    exif = (await exifr.parse(buf, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: true, interop: true, makerNote: false, translateKeys: true, translateValues: true, reviveValues: true, mergeOutput: true })) || {};
  } catch {
    exif = {};
  }

  try {
    const g = await exifr.gps(buf);
    if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) gps = { lat: g.latitude, lon: g.longitude };
  } catch { /* нет GPS */ }

  // Раскладываем по группам.
  const deviceKeys = ['Make', 'Model', 'LensMake', 'LensModel', 'Software', 'HostComputer'];
  const shotKeys = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal', 'ExposureTime', 'FNumber', 'ISO', 'ISOSpeedRatings', 'FocalLength', 'FocalLengthIn35mmFormat', 'Flash', 'WhiteBalance', 'ExposureProgram', 'MeteringMode'];
  const imgKeys = ['ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'Orientation', 'ColorSpace', 'BitsPerSample', 'Compression'];
  const usedKeys = new Set<string>();
  const grp = (title: string, keys: string[]) => {
    const rows: MetaRow[] = [];
    for (const k of keys) {
      if (k in exif && exif[k] != null && fmt(exif[k]) !== '') { rows.push(row(k, fmt(exif[k]))); usedKeys.add(k); }
    }
    if (rows.length) groups.push({ title, rows });
  };

  const device = grp;
  device('Устройство и софт', deviceKeys);
  grp('Съёмка', shotKeys);
  grp('Изображение', imgKeys);

  {
    const gpsRows: MetaRow[] = [row(GPS_KEY, gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : '', true, 'Координаты (широта, долгота)')];
    for (const k of ['GPSAltitude', 'GPSImgDirection', 'GPSHPositioningError', 'GPSDateStamp', 'GPSTimeStamp']) {
      if (k in exif && exif[k] != null) { gpsRows.push(row(k, fmt(exif[k]))); usedKeys.add(k); }
    }
    groups.push({ title: 'GPS', rows: gpsRows });
  }
  // Отдельные GPS-компоненты правятся строкой «Координаты» — в «Прочее» их не тащим.
  for (const k of GPS_TAGS) usedKeys.add(k);

  // Остальные EXIF/XMP-поля — в «Прочее».
  const rest: MetaRow[] = [];
  for (const k of Object.keys(exif)) {
    if (usedKeys.has(k)) continue;
    const val = fmt(exif[k]);
    if (val === '' || val.length > 200) continue;
    rest.push(row(k, val));
  }
  if (rest.length) groups.push({ title: 'Прочие поля (EXIF/XMP/IPTC)', rows: rest.slice(0, 60) });

  // C2PA / Content Credentials.
  const c2pa = scanC2PA(buf);
  if (c2pa.present) {
    const src = c2pa.rows.length ? c2pa.rows : ([['Статус', 'манифест присутствует']] as [string, string][]);
    // Манифест подписан криптографически — правке по одному полю не поддаётся, только удаление целиком.
    groups.push({ title: 'C2PA / Content Credentials', rows: src.map(([k, v]) => row(k, v, false, k)) });
  }

  // Вердикт.
  const aiSignals = c2pa.present || /trainedAlgorithmicMedia/i.test(JSON.stringify(exif)) || /(dall-?e|midjourney|stable diffusion|gpt-image|firefly|openai|generative)/i.test(fmt(exif['Software']) + ' ' + fmt(exif['Make']));
  const hasCamera = !!(exif['Make'] || exif['Model']) && !!(exif['DateTimeOriginal'] || exif['ExposureTime'] || exif['FNumber']);
  let verdict: MetaResult['verdict'] = 'unknown';
  let verdictText = 'Недостаточно данных, чтобы уверенно судить.';
  const camera = [exif['Make'], exif['Model']].filter(Boolean).map(fmt).join(' ').trim() || null;
  const shotDate = fmt(exif['DateTimeOriginal'] || exif['CreateDate'] || '') || null;
  const stripped = !camera && !gps && !shotDate && !c2pa.present;

  if (aiSignals) { verdict = 'ai'; verdictText = 'Похоже на ИИ-генерацию (есть C2PA/AI-пометки).'; }
  else if (hasCamera) { verdict = 'camera'; verdictText = 'Похоже на реальную съёмку (есть камера + параметры экспозиции).'; }
  else if (stripped) { verdictText = 'Камера/GPS/дата отсутствуют — метаданные, похоже, вырезаны (пересылка через мессенджер/соцсеть).'; }

  const summary: MetaSummary = { camera, gps: gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : null, shotDate, c2pa: c2pa.present, stripped };
  const writable = WRITABLE_EXT.has(path.extname(file).toLowerCase());

  return { file, name, sizeKB, verdict, verdictText, summary, groups, gps, writable };
}

const emptyResult = (file: string, error: string): MetaResult => ({
  file, name: path.basename(file || ''), sizeKB: 0, verdict: 'unknown', verdictText: '',
  summary: { camera: null, gps: null, shotDate: null, c2pa: false, stripped: false },
  groups: [], gps: null, writable: false, error,
});

// Свободное место рядом с оригиналом: photo.jpg → photo_meta.jpg → photo_meta_2.jpg …
function copyTarget(file: string): string {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  let dest = path.join(dir, `${base}_meta${ext}`);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base}_meta_${i}${ext}`);
  return dest;
}

// «широта, долгота» → набор GPS-тегов. Пустая строка = стереть гео.
function gpsTags(raw: string): Record<string, unknown> | string {
  const s = raw.trim();
  if (!s) return Object.fromEntries(GPS_TAGS.map((t) => [t, null]));
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return 'GPS: нужен формат «широта, долгота», например 55.751244, 37.618423';
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'GPS: широта −90…90, долгота −180…180';
  return { GPSLatitude: lat, GPSLongitude: lon, GPSLatitudeRef: lat >= 0 ? 'N' : 'S', GPSLongitudeRef: lon >= 0 ? 'E' : 'W' };
}

interface WriteReq {
  file: string;
  edits: Record<string, string>; // тег → новое значение
  deletes: string[];             // теги на удаление
  stripAll?: boolean;            // сначала снести все метаданные, потом записать edits
  mode: 'overwrite' | 'copy';
}

async function writeMeta(req: WriteReq): Promise<MetaResult> {
  const src = req.file;
  if (!src || !fs.existsSync(src)) return emptyResult(src, 'Файл не найден');
  if (!WRITABLE_EXT.has(path.extname(src).toLowerCase())) return emptyResult(src, 'В этот формат запись метаданных не поддерживается');

  const tags: Record<string, unknown> = {};
  for (const [tag, raw] of Object.entries(req.edits || {})) {
    if (tag === GPS_KEY) {
      const g = gpsTags(raw);
      if (typeof g === 'string') return emptyResult(src, g);
      Object.assign(tags, g);
      continue;
    }
    const v = String(raw ?? '').trim();
    tags[tag] = v === '' ? null : v;
  }
  for (const tag of req.deletes || []) {
    if (tag === GPS_KEY) { for (const t of GPS_TAGS) tags[t] = null; continue; }
    tags[tag] = null;
  }

  const target = req.mode === 'copy' ? copyTarget(src) : src;
  if (req.mode === 'copy') await fs.promises.copyFile(src, target);

  try {
    // Сначала полная очистка (отдельным проходом: в одном вызове «-all=» затрёт и новые значения),
    // потом запись правок. «-overwrite_original» — чтобы не плодить файлы *_original рядом.
    if (req.stripAll) await tool().write(target, {}, { writeArgs: ['-all=', '-overwrite_original'] });
    if (Object.keys(tags).length) {
      const res = await tool().write(target, tags as never, { writeArgs: ['-overwrite_original'] });
      // «Nothing to do» — это не ошибка (например, стёрли уже пустое поле).
      const bad = (res.warnings ?? []).filter((w) => !/nothing to do/i.test(w));
      if (bad.length && !res.created && !res.updated) throw new Error(bad.join('; '));
    }
  } catch (err) {
    if (req.mode === 'copy') await fs.promises.rm(target, { force: true });
    return emptyResult(src, (err as Error).message.replace(/^Error:\s*/, ''));
  }

  return readMeta(target);
}

export function registerMetadataHandlers() {
  ipcMain.handle('meta:pick', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: IMG_EXT }, { name: 'Все файлы', extensions: ['*'] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle('meta:openMap', (_e, lat: number, lon: number) => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) shell.openExternal(`https://www.google.com/maps?q=${lat},${lon}`);
    return { ok: true };
  });

  ipcMain.handle('meta:reveal', (_e, file: string) => {
    if (file && fs.existsSync(file)) shell.showItemInFolder(file);
    return { ok: true };
  });

  ipcMain.handle('meta:read', async (_e, file: string): Promise<MetaResult> => {
    try {
      return await readMeta(file);
    } catch (err) {
      return emptyResult(file, (err as Error).message);
    }
  });

  ipcMain.handle('meta:write', async (_e, req: WriteReq): Promise<MetaResult> => {
    try {
      return await writeMeta(req);
    } catch (err) {
      return emptyResult(req?.file || '', (err as Error).message);
    }
  });

  app.on('will-quit', () => { void et?.end(); et = null; });
}
