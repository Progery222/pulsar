import { ipcMain, dialog, shell, app } from 'electron';
import exifr from 'exifr';
import fs from 'node:fs';
import path from 'node:path';
import { ExifTool } from 'exiftool-vendored';
import { jitterCoords, formatCoords } from '../../src/metadata/geo';

// Модуль «Метаданные» — инспектор + редактор: загрузил фото или видео → видишь всё (EXIF, GPS,
// XMP, QuickTime, C2PA, вердикт ИИ/реал) и можешь править любое поле, удалять, чистить всё.
// Фото читаются exifr (быстро, без подпроцесса), видео — exiftool'ом; пишет всегда exiftool.

const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'avif', 'gif'];
const VID_EXT = ['mp4', 'mov', 'm4v', '3gp', '3g2', 'mkv', 'webm', 'avi', 'mpg', 'mpeg', 'wmv', 'flv', 'm2ts', 'ts'];
const MEDIA_EXT = [...IMG_EXT, ...VID_EXT];

type Kind = 'image' | 'video';
const kindOf = (file: string): Kind => (VID_EXT.includes(path.extname(file).slice(1).toLowerCase()) ? 'video' : 'image');

const exiftoolBin = (require('exiftool-vendored.exe') as string).replace('app.asar', 'app.asar.unpacked');
let et: ExifTool | null = null;
const tool = (): ExifTool => (et ??= new ExifTool({ exiftoolPath: exiftoolBin, taskTimeoutMillis: 300000 }));

// Ключ псевдо-поля координат: правится одной строкой «широта, долгота».
const GPS_KEY = '__gps';
const GPS_TAGS = ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'GPSPosition', 'GPSDateStamp', 'GPSTimeStamp', 'GPSDateTime'];

// Поля, которые описывают сам пиксельный буфер / контейнер — править их бессмысленно
// (файл от этого не изменится, а у видео exiftool такие теги и не пишет).
const READONLY_TAGS = new Set([
  'ImageWidth', 'ImageHeight', 'ImageSize', 'Megapixels', 'FileSize', 'FileType', 'FileTypeExtension', 'MIMEType',
  'Compression', 'BitsPerSample', 'SamplesPerPixel', 'PhotometricInterpretation', 'StripOffsets', 'StripByteCounts',
  'RowsPerStrip', 'PlanarConfiguration', 'YCbCrSubSampling', 'ThumbnailOffset', 'ThumbnailLength',
  // Видео/контейнер.
  'Duration', 'MediaDuration', 'TrackDuration', 'PreviewDuration', 'SelectionDuration', 'VideoFrameRate', 'AvgBitrate',
  'CompressorName', 'CompressorID', 'SourceImageWidth', 'SourceImageHeight', 'AudioFormat', 'AudioChannels',
  'AudioSampleRate', 'AudioBitsPerSample', 'MajorBrand', 'MinorVersion', 'CompatibleBrands', 'MovieHeaderVersion',
  'TrackHeaderVersion', 'MediaHeaderVersion', 'HandlerType', 'HandlerClass', 'HandlerVendorID', 'TimeScale',
  'MediaTimeScale', 'TrackID', 'NextTrackID', 'MediaDataSize', 'MediaDataOffset', 'GraphicsMode', 'OpColor',
  'BitDepth', 'VideoFullRangeFlag', 'ColorProfiles', 'ColorRepresentation', 'MatrixStructure', 'Balance',
  'ImageSizeRatio', 'Rotation', 'MaxBitrate', 'BufferSize',
]);

// Системные/служебные ключи из exiftool — в списке полей им делать нечего.
const SKIP_TAGS = new Set([
  'SourceFile', 'errors', 'warnings', 'zone', 'tz', 'tzSource', 'Directory', 'FileName', 'FilePermissions',
  'FileAccessDate', 'FileInodeChangeDate', 'FileCreateDate', 'FileModifyDate', 'ExifToolVersion',
]);

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
  kind: Kind;
  writable: boolean; // формат, в который exiftool умеет писать
  error?: string;
}

// В какие форматы exiftool умеет писать метаданные.
// Фото: у AVIF/GIF поддержка неполная. Видео: только семейство QuickTime — MKV/WEBM/AVI читаются, но не пишутся.
const WRITABLE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.mp4', '.mov', '.m4v', '.3gp', '.3g2']);

// QuickTime хранит время в UTC. С этим флагом exiftool помечает его зоной, а мы показываем и
// принимаем локальное время — что ввёл, то и увидишь обратно.
const QT_ARGS = ['-api', 'QuickTimeUTC=1'];

const two = (n: number) => String(n).padStart(2, '0');
// Даты показываем в EXIF-формате «2024:05:01 13:45:07» — так же их и принимает exiftool при записи.
const fmtDate = (d: Date) => `${d.getFullYear()}:${two(d.getMonth() + 1)}:${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

// Контейнеры от ffmpeg и прочих конвертеров пишут нулевую дату — это «даты нет», а не дата.
const ZERO_DATE = /^0000[:\-]00[:\-]00([ T]00:00:00)?Z?$/;

const fmt = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : fmtDate(v);
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'object') {
    // exiftool отдаёт даты объектами ExifDateTime/ExifDate — приводим к локальному времени.
    const o = v as { toDate?: () => Date; rawValue?: string };
    if (typeof o.toDate === 'function') { const d = o.toDate(); return d instanceof Date && !Number.isNaN(d.getTime()) ? fmtDate(d) : fmt(o.rawValue); }
    if (typeof o.rawValue === 'string') return fmt(o.rawValue);
    return JSON.stringify(v);
  }
  const s = String(v);
  return ZERO_DATE.test(s.trim()) ? '' : s;
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

// Видео целиком в память не тянем (бывают гигабайты) — для C2PA-скана хватает головы файла:
// в MP4 манифест лежит в uuid-боксе сразу за ftyp.
const HEAD_BYTES = 4 * 1024 * 1024;

async function readHead(file: string, limit: number): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(limit, size);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

// ── Видео: читает exiftool (exifr контейнеры не понимает вообще) ──────────────
const VIDEO_DEVICE_KEYS = ['Make', 'Model', 'Software', 'LensModel', 'Encoder', 'HandlerDescription', 'AndroidVersion', 'AndroidManufacturer', 'AndroidModel'];
const VIDEO_SHOT_KEYS = ['CreateDate', 'ModifyDate', 'DateTimeOriginal', 'TrackCreateDate', 'TrackModifyDate', 'MediaCreateDate', 'MediaModifyDate', 'ContentCreateDate'];
const VIDEO_TECH_KEYS = ['ImageWidth', 'ImageHeight', 'Duration', 'VideoFrameRate', 'AvgBitrate', 'CompressorName', 'Rotation', 'AudioFormat', 'AudioChannels', 'AudioSampleRate', 'MajorBrand', 'FileType'];
const VIDEO_GPS_EXTRA = ['GPSAltitude', 'GPSAltitudeRef', 'GPSDateTime'];
// Гео у видео — единый тег GPSCoordinates; GPSLatitude/Longitude exiftool выводит из него.
const VIDEO_GPS_TAGS = ['GPSCoordinates', 'GPSPosition', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'GPSDateTime'];

async function readVideoMeta(file: string): Promise<MetaResult> {
  const name = path.basename(file);
  const sizeKB = Math.round((await fs.promises.stat(file)).size / 1024);
  const groups: MetaGroup[] = [];

  let tags: Record<string, unknown> = {};
  try {
    tags = (await tool().read(file, { readArgs: QT_ARGS })) as unknown as Record<string, unknown>;
  } catch (err) {
    return emptyResult(file, (err as Error).message);
  }

  const lat = Number(tags['GPSLatitude']);
  const lon = Number(tags['GPSLongitude']);
  const gps = Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : null;

  const used = new Set<string>(SKIP_TAGS);
  const grp = (title: string, keys: string[]) => {
    const rows: MetaRow[] = [];
    for (const k of keys) {
      if (used.has(k)) continue;
      const val = fmt(tags[k]);
      if (val === '') continue;
      rows.push(row(k, val));
      used.add(k);
    }
    if (rows.length) groups.push({ title, rows });
  };

  grp('Устройство и софт', VIDEO_DEVICE_KEYS);
  grp('Съёмка', VIDEO_SHOT_KEYS);
  grp('Видео и звук', VIDEO_TECH_KEYS);

  {
    const gpsRows: MetaRow[] = [row(GPS_KEY, gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : '', true, 'Координаты (широта, долгота)')];
    for (const k of VIDEO_GPS_EXTRA) {
      const val = fmt(tags[k]);
      if (val) gpsRows.push(row(k, val));
    }
    groups.push({ title: 'GPS', rows: gpsRows });
  }
  for (const k of VIDEO_GPS_TAGS) used.add(k);

  const rest: MetaRow[] = [];
  for (const k of Object.keys(tags)) {
    if (used.has(k)) continue;
    const val = fmt(tags[k]);
    if (val === '' || val.length > 200) continue;
    rest.push(row(k, val));
  }
  if (rest.length) groups.push({ title: 'Прочие поля (QuickTime/XMP)', rows: rest.slice(0, 60) });

  const c2pa = scanC2PA(await readHead(file, HEAD_BYTES));
  if (c2pa.present) {
    const src = c2pa.rows.length ? c2pa.rows : ([['Статус', 'манифест присутствует']] as [string, string][]);
    // Тег служебный (__c2pa*), а подпись человеческая: раньше подпись шла тегом,
    // и «Генератор (softwareAgent)» уезжал в запись, ломая её целиком.
    groups.push({ title: 'C2PA / Content Credentials', rows: src.map(([k, v], i) => row(`__c2pa${i}`, v, false, k)) });
  }

  const camera = [tags['Make'], tags['Model']].filter(Boolean).map(fmt).join(' ').trim() || null;
  const shotDate = fmt(tags['CreateDate'] || tags['DateTimeOriginal'] || '') || null;
  const stripped = !camera && !gps && !shotDate && !c2pa.present;
  const aiSignals = c2pa.present || /(sora|runway|pika|kling|luma|veo|midjourney|stable *video|generative)/i.test(fmt(tags['Software']) + ' ' + fmt(tags['Encoder']) + ' ' + fmt(tags['Make']));

  let verdict: MetaResult['verdict'] = 'unknown';
  let verdictText = 'Недостаточно данных, чтобы уверенно судить.';
  if (aiSignals) { verdict = 'ai'; verdictText = 'Похоже на ИИ-генерацию (есть C2PA/AI-пометки).'; }
  else if (camera && shotDate) { verdict = 'camera'; verdictText = 'Похоже на съёмку с камеры (есть модель устройства + дата).'; }
  else if (stripped) { verdictText = 'Камера/GPS/дата отсутствуют — метаданные, похоже, вырезаны при перекодировании или пересылке.'; }

  const summary: MetaSummary = { camera, gps: gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : null, shotDate, c2pa: c2pa.present, stripped };
  return { file, name, sizeKB, verdict, verdictText, summary, groups, gps, kind: 'video', writable: WRITABLE_EXT.has(path.extname(file).toLowerCase()) };
}

async function readMeta(file: string): Promise<MetaResult> {
  if (kindOf(file) === 'video') return readVideoMeta(file);
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
    // Тег служебный (__c2pa*), а подпись человеческая: раньше подпись шла тегом,
    // и «Генератор (softwareAgent)» уезжал в запись, ломая её целиком.
    groups.push({ title: 'C2PA / Content Credentials', rows: src.map(([k, v], i) => row(`__c2pa${i}`, v, false, k)) });
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

  return { file, name, sizeKB, verdict, verdictText, summary, groups, gps, kind: 'image', writable };
}

const emptyResult = (file: string, error: string): MetaResult => ({
  file, name: path.basename(file || ''), sizeKB: 0, verdict: 'unknown', verdictText: '',
  summary: { camera: null, gps: null, shotDate: null, c2pa: false, stripped: false },
  groups: [], gps: null, kind: kindOf(file || ''), writable: false, error,
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
// У фото это пара GPSLatitude/GPSLongitude с полушариями, у видео — единый QuickTime:GPSCoordinates.
function gpsTags(raw: string, kind: Kind = 'image'): Record<string, unknown> | string {
  const s = raw.trim();
  const all = kind === 'video' ? VIDEO_GPS_TAGS : GPS_TAGS;
  if (!s) return Object.fromEntries(all.map((t) => [t, null]));
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return 'GPS: нужен формат «широта, долгота», например 55.751244, 37.618423';
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'GPS: широта −90…90, долгота −180…180';
  if (kind === 'video') return { 'QuickTime:GPSCoordinates': `${lat}, ${lon}` };
  return { GPSLatitude: lat, GPSLongitude: lon, GPSLatitudeRef: lat >= 0 ? 'N' : 'S', GPSLongitudeRef: lon >= 0 ? 'E' : 'W' };
}

// У видео эти поля должны лечь в QuickTime — туда их пишут телефоны. Без префикса
// exiftool сложил бы их в XMP, и плеер/галерея их бы не увидели.
const VIDEO_TAG_GROUP: Record<string, string> = {
  Make: 'QuickTime:Make', Model: 'QuickTime:Model', Software: 'QuickTime:Software',
  CreateDate: 'QuickTime:CreateDate', ModifyDate: 'QuickTime:ModifyDate',
};

// exiftool принимает только такие имена; всё остальное валит запись целиком.
const TAG_NAME_RE = /^[A-Za-z0-9_:*?+#^][A-Za-z0-9_:\-*?+#^]*$/;

// Отсев перед записью: служебные строки интерфейса (C2PA и прочие псевдо-поля)
// и любые имена, которые exiftool не примет. Раньше одно такое поле — например
// сохранённое в старом пресете — обрушивало сохранение всего файла.
// READONLY_TAGS сюда же: это размеры кадра, длительность, кодек и прочее, что
// описывает сам файл. Записать их технически можно, но получится ложь — другие
// программы читают их как настоящие. В интерфейсе они не редактируются, а вот
// пресет, сохранённый до этой проверки, мог такое протащить.
const writableTag = (tag: string): boolean =>
  tag === GPS_KEY || (!tag.startsWith('__') && TAG_NAME_RE.test(tag) && !READONLY_TAGS.has(tag));

// edits/deletes из UI → набор тегов для exiftool. Строка в ответе = текст ошибки валидации.
function buildTags(edits: Record<string, string> = {}, deletes: string[] = [], kind: Kind = 'image'): Record<string, unknown> | string {
  const video = kind === 'video';
  const name = (t: string) => (video ? VIDEO_TAG_GROUP[t] ?? t : t);
  const tags: Record<string, unknown> = {};
  for (const [tag, raw] of Object.entries(edits)) {
    if (!writableTag(tag)) continue;
    if (tag === GPS_KEY) {
      const g = gpsTags(raw, kind);
      if (typeof g === 'string') return g;
      Object.assign(tags, g);
      continue;
    }
    const v = String(raw ?? '').trim();
    tags[name(tag)] = v === '' ? null : v;
  }
  for (const tag of deletes) {
    if (!writableTag(tag)) continue;
    if (tag === GPS_KEY) { for (const t of (video ? VIDEO_GPS_TAGS : GPS_TAGS)) tags[t] = null; continue; }
    tags[name(tag)] = null;
  }
  return tags;
}

// C2PA — подписанный JUMBF-манифест, его нельзя достоверно отредактировать
// отдельными полями. Любая запись в файл делает подпись недействительной,
// поэтому перед сохранением удаляем манифест целиком.
const C2PA_REMOVE_ARGS = ['-jumbf:all='];

// Записать теги в конкретный файл. Бросает исключение с текстом от exiftool.
async function applyTags(target: string, tags: Record<string, unknown>, stripAll?: boolean) {
  const extra = kindOf(target) === 'video' ? QT_ARGS : [];
  // Сначала полная очистка (отдельным проходом: в одном вызове «-all=» затрёт и новые значения),
  // потом запись правок. «-overwrite_original» — чтобы не плодить файлы *_original рядом.
  if (stripAll) await tool().write(target, {}, { writeArgs: ['-all=', ...C2PA_REMOVE_ARGS, '-overwrite_original', ...extra] });
  if (Object.keys(tags).length) {
    const res = await tool().write(target, tags as never, { writeArgs: [...C2PA_REMOVE_ARGS, '-overwrite_original', ...extra] });
    // «Nothing to do» — это не ошибка (например, стёрли уже пустое поле).
    const bad = (res.warnings ?? []).filter((w) => !/nothing to do/i.test(w));
    if (bad.length && !res.created && !res.updated) throw new Error(bad.join('; '));
  }
}

interface WriteReq {
  file: string;
  edits: Record<string, string>; // тег → новое значение
  deletes: string[];             // теги на удаление
  stripAll?: boolean;            // сначала снести все метаданные, потом записать edits
  mode: 'overwrite' | 'copy' | 'saveAs';
  dest?: string;                 // для mode='saveAs' — путь, выбранный в диалоге
}

async function writeMeta(req: WriteReq): Promise<MetaResult> {
  const src = req.file;
  if (!src || !fs.existsSync(src)) return emptyResult(src, 'Файл не найден');
  if (!WRITABLE_EXT.has(path.extname(src).toLowerCase())) return emptyResult(src, 'В этот формат запись метаданных не поддерживается');

  const tags = buildTags(req.edits, req.deletes, kindOf(src));
  if (typeof tags === 'string') return emptyResult(src, tags);

  const copy = req.mode !== 'overwrite';
  const target = req.mode === 'saveAs' ? (req.dest || '') : req.mode === 'copy' ? copyTarget(src) : src;
  if (req.mode === 'saveAs' && !target) return emptyResult(src, 'Не выбран путь для сохранения');
  if (copy) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(src, target);
  }

  try {
    await applyTags(target, tags, req.stripAll);
  } catch (err) {
    if (copy) await fs.promises.rm(target, { force: true });
    return emptyResult(src, (err as Error).message.replace(/^Error:\s*/, ''));
  }

  return readMeta(target);
}

// ─── Рандомайзер: «снято на такой-то телефон, там-то, тогда-то» ──────────────
// Наборы взяты из реальных EXIF: связка Make/Model/Software/объектив/фокусное правдоподобна.

interface Device { Make: string; Model: string; Software: string; LensModel: string; FocalLength: number; FocalLengthIn35mmFormat: number; FNumber: number }

const DEVICES: Device[] = [
  { Make: 'Apple', Model: 'iPhone 15 Pro', Software: '17.5.1', LensModel: 'iPhone 15 Pro back triple camera 6.765mm f/1.78', FocalLength: 6.765, FocalLengthIn35mmFormat: 24, FNumber: 1.78 },
  { Make: 'Apple', Model: 'iPhone 14', Software: '16.6', LensModel: 'iPhone 14 back dual wide camera 5.7mm f/1.5', FocalLength: 5.7, FocalLengthIn35mmFormat: 26, FNumber: 1.5 },
  { Make: 'Apple', Model: 'iPhone 13 Pro Max', Software: '15.4.1', LensModel: 'iPhone 13 Pro Max back triple camera 5.7mm f/1.5', FocalLength: 5.7, FocalLengthIn35mmFormat: 26, FNumber: 1.5 },
  { Make: 'Apple', Model: 'iPhone 12', Software: '14.8', LensModel: 'iPhone 12 back dual wide camera 4.2mm f/1.6', FocalLength: 4.2, FocalLengthIn35mmFormat: 26, FNumber: 1.6 },
  { Make: 'Apple', Model: 'iPhone SE (3rd generation)', Software: '16.3.1', LensModel: 'iPhone SE (3rd generation) back camera 3.99mm f/1.8', FocalLength: 3.99, FocalLengthIn35mmFormat: 28, FNumber: 1.8 },
  { Make: 'samsung', Model: 'SM-S928B', Software: 'S928BXXU3AXK6', LensModel: '', FocalLength: 6.3, FocalLengthIn35mmFormat: 24, FNumber: 1.7 },
  { Make: 'samsung', Model: 'SM-S911B', Software: 'S911BXXU3BWK4', LensModel: '', FocalLength: 6.3, FocalLengthIn35mmFormat: 24, FNumber: 1.8 },
  { Make: 'samsung', Model: 'SM-A546B', Software: 'A546BXXU5CWK1', LensModel: '', FocalLength: 5.4, FocalLengthIn35mmFormat: 26, FNumber: 1.8 },
  { Make: 'samsung', Model: 'SM-A266B', Software: 'A266BXXU4BYI2', LensModel: '', FocalLength: 4.7, FocalLengthIn35mmFormat: 26, FNumber: 1.8 },
  { Make: 'Xiaomi', Model: '23127PN0CG', Software: 'OS1.0.4.0.UNCCNXM', LensModel: '', FocalLength: 6.71, FocalLengthIn35mmFormat: 23, FNumber: 1.42 },
  { Make: 'Xiaomi', Model: '2201123G', Software: 'V14.0.3.0.TLCMIXM', LensModel: '', FocalLength: 6.62, FocalLengthIn35mmFormat: 24, FNumber: 1.9 },
  { Make: 'Xiaomi', Model: '22111317I', Software: 'V14.0.6.0.TMGMIXM', LensModel: '', FocalLength: 5.31, FocalLengthIn35mmFormat: 26, FNumber: 1.8 },
  { Make: 'Google', Model: 'Pixel 8 Pro', Software: 'HL1.240118.003', LensModel: 'Pixel 8 Pro back camera 6.9mm f/1.68', FocalLength: 6.9, FocalLengthIn35mmFormat: 25, FNumber: 1.68 },
  { Make: 'Google', Model: 'Pixel 7', Software: 'TQ3A.230805.001', LensModel: 'Pixel 7 back camera 6.81mm f/1.85', FocalLength: 6.81, FocalLengthIn35mmFormat: 25, FNumber: 1.85 },
  { Make: 'HUAWEI', Model: 'ELS-NX9', Software: 'ELS-NX9 11.0.0.260', LensModel: '', FocalLength: 5.6, FocalLengthIn35mmFormat: 27, FNumber: 1.9 },
  { Make: 'OnePlus', Model: 'CPH2451', Software: 'CPH2451_13.1.0.581', LensModel: '', FocalLength: 6.06, FocalLengthIn35mmFormat: 23, FNumber: 1.8 },
  { Make: 'realme', Model: 'RMX3771', Software: 'RMX3771_13.1.0.101', LensModel: '', FocalLength: 5.59, FocalLengthIn35mmFormat: 26, FNumber: 1.75 },
];

// Города: центр + разброс в градусах (~разумный радиус по городу).
const CITIES: { name: string; lat: number; lon: number; r: number }[] = [
  { name: 'Москва', lat: 55.7558, lon: 37.6173, r: 0.12 },
  { name: 'Санкт-Петербург', lat: 59.9343, lon: 30.3351, r: 0.1 },
  { name: 'Новосибирск', lat: 55.0084, lon: 82.9357, r: 0.08 },
  { name: 'Екатеринбург', lat: 56.8389, lon: 60.6057, r: 0.07 },
  { name: 'Казань', lat: 55.7963, lon: 49.1088, r: 0.07 },
  { name: 'Краснодар', lat: 45.0355, lon: 38.9753, r: 0.06 },
  { name: 'Сочи', lat: 43.5855, lon: 39.7231, r: 0.06 },
  { name: 'Минск', lat: 53.9023, lon: 27.5619, r: 0.08 },
  { name: 'Алматы', lat: 43.2389, lon: 76.8897, r: 0.08 },
  { name: 'Ташкент', lat: 41.2995, lon: 69.2401, r: 0.08 },
  { name: 'Тбилиси', lat: 41.7151, lon: 44.8271, r: 0.06 },
  { name: 'Ереван', lat: 40.1792, lon: 44.4991, r: 0.05 },
  { name: 'Стамбул', lat: 41.0082, lon: 28.9784, r: 0.15 },
  { name: 'Дубай', lat: 25.2048, lon: 55.2708, r: 0.12 },
  { name: 'Бангкок', lat: 13.7563, lon: 100.5018, r: 0.12 },
  { name: 'Бали', lat: -8.4095, lon: 115.1889, r: 0.2 },
  // США и Европа: раньше офлайн-список был только по СНГ, и поиск «New York»
  // без интернета не находил ничего.
  { name: 'New York', lat: 40.7128, lon: -74.006, r: 0.15 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, r: 0.18 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298, r: 0.12 },
  { name: 'Miami', lat: 25.7617, lon: -80.1918, r: 0.1 },
  { name: 'Las Vegas', lat: 36.1699, lon: -115.1398, r: 0.1 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, r: 0.08 },
  { name: 'Seattle', lat: 47.6062, lon: -122.3321, r: 0.1 },
  { name: 'Austin', lat: 30.2672, lon: -97.7431, r: 0.1 },
  { name: 'Houston', lat: 29.7604, lon: -95.3698, r: 0.14 },
  { name: 'Boston', lat: 42.3601, lon: -71.0589, r: 0.08 },
  { name: 'Denver', lat: 39.7392, lon: -104.9903, r: 0.1 },
  { name: 'Atlanta', lat: 33.749, lon: -84.388, r: 0.1 },
  { name: 'London', lat: 51.5074, lon: -0.1278, r: 0.14 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, r: 0.1 },
  { name: 'Berlin', lat: 52.52, lon: 13.405, r: 0.12 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686, r: 0.08 },
  { name: 'Rome', lat: 41.9028, lon: 12.4964, r: 0.1 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041, r: 0.07 },
  { name: 'Prague', lat: 50.0755, lon: 14.4378, r: 0.08 },
  { name: 'Lisbon', lat: 38.7223, lon: -9.1393, r: 0.08 },
  { name: 'Warsaw', lat: 52.2297, lon: 21.0122, r: 0.1 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, r: 0.15 },
  { name: 'Seoul', lat: 37.5665, lon: 126.978, r: 0.12 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, r: 0.08 },
  { name: 'Toronto', lat: 43.6532, lon: -79.3832, r: 0.12 },
  { name: 'Mexico City', lat: 19.4326, lon: -99.1332, r: 0.15 },
  { name: 'Sao Paulo', lat: -23.5505, lon: -46.6333, r: 0.15 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, r: 0.12 },
];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const EXPOSURES = ['1/2000', '1/1250', '1/800', '1/500', '1/320', '1/250', '1/160', '1/120', '1/100', '1/60', '1/50', '1/33', '1/25'];
const ISOS = [25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1250, 1600];

export interface RandOpts {
  device: boolean;              // Make/Model/Software/объектив
  shot: boolean;                // выдержка/диафрагма/ISO/фокусное/баланс белого
  gps: boolean;                 // координаты
  date: boolean;                // дата съёмки
  city?: string | null;         // конкретный город; null/пусто = случайный
  deviceModel?: string | null;  // конкретная модель («Make Model»); null = случайная
  dateFrom?: string;            // 'YYYY-MM-DD'
  dateTo?: string;
}

const dayMs = 86400000;

function randomTags(o: RandOpts, kind: Kind = 'image'): Record<string, string> {
  const out: Record<string, string> = {};
  const dev = (o.deviceModel && DEVICES.find((d) => `${d.Make} ${d.Model}` === o.deviceModel)) || pick(DEVICES);
  const video = kind === 'video';

  if (o.device) {
    out.Make = dev.Make;
    out.Model = dev.Model;
    out.Software = dev.Software;
    if (dev.LensModel && !video) out.LensModel = dev.LensModel;
  }
  // Выдержка/диафрагма/ISO — понятия из фотосъёмки; в контейнере видео таких тегов нет.
  if (o.shot && !video) {
    out.ExposureTime = pick(EXPOSURES);
    out.FNumber = String(dev.FNumber);
    out.ISO = String(pick(ISOS));
    out.FocalLength = String(dev.FocalLength);
    out.FocalLengthIn35mmFormat = String(dev.FocalLengthIn35mmFormat);
    out.WhiteBalance = 'Auto';
    out.Flash = 'No Flash';
    out.MeteringMode = 'Multi-segment';
    out.ExposureProgram = 'Program AE';
    out.ColorSpace = 'sRGB';
  }
  if (o.gps) {
    const c = (o.city && CITIES.find((x) => x.name === o.city)) || pick(CITIES);
    const lat = c.lat + rnd(-c.r, c.r);
    const lon = c.lon + rnd(-c.r, c.r);
    out[GPS_KEY] = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }
  if (o.date) {
    const to = o.dateTo ? Date.parse(o.dateTo) : Date.now();
    const from = o.dateFrom ? Date.parse(o.dateFrom) : (Number.isFinite(to) ? to : Date.now()) - 365 * dayMs;
    const lo = Number.isFinite(from) ? from : Date.now() - 365 * dayMs;
    const hi = Number.isFinite(to) && to > lo ? to : lo + 365 * dayMs;
    // Время суток — дневное, чтобы «съёмка» выглядела естественно.
    const d = new Date(lo + Math.random() * (hi - lo));
    d.setHours(8 + Math.floor(Math.random() * 13), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
    const s = fmtDate(d);
    out.CreateDate = s;
    out.ModifyDate = s;
    if (video) { out.TrackCreateDate = s; out.TrackModifyDate = s; out.MediaCreateDate = s; out.MediaModifyDate = s; }
    else out.DateTimeOriginal = s;
  }
  return out;
}

// ─── Пакетная обработка ─────────────────────────────────────────────────────

interface BatchReq {
  files: string[];
  valuesMode: 'same' | 'random';       // одинаковые значения на все / свои для каждого фото
  edits: Record<string, string>;       // для valuesMode='same'
  deletes: string[];
  stripAll?: boolean;
  rand: RandOpts;                      // для valuesMode='random'
  // Если задано, координаты для каждого файла считаются заново вокруг этой точки.
  gpsJitter?: { lat: number; lon: number; jitterKm: number };
  target: 'overwrite' | 'copy' | 'folder';
  outDir?: string;                     // для target='folder'
}

interface BatchResult { ok: number; failed: { name: string; error: string }[]; dir: string | null; canceled: boolean }

let batchCancel = false;

// Свободное имя в папке назначения (без затирания уже лежащих файлов).
function freeName(dir: string, name: string): string {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let dest = path.join(dir, name);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${base}_${i}${ext}`);
  return dest;
}

async function runBatch(req: BatchReq, send: (ev: { done: number; total: number; name: string }) => void): Promise<BatchResult> {
  batchCancel = false;
  const all = req.files || [];
  const files = all.filter((f) => WRITABLE_EXT.has(path.extname(f).toLowerCase()));
  // Неподдерживаемые не выбрасываем молча — они попадают в отчёт с причиной.
  const failed: BatchResult['failed'] = all
    .filter((f) => !WRITABLE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ name: path.basename(f), error: 'в этот формат запись не поддерживается' }));
  let ok = 0;

  if (req.target === 'folder') {
    if (!req.outDir) return { ok: 0, failed: [{ name: '', error: 'Не выбрана папка назначения' }], dir: null, canceled: false };
    await fs.promises.mkdir(req.outDir, { recursive: true });
  }
  const outDir = req.target === 'folder' ? req.outDir! : null;

  for (let i = 0; i < files.length; i++) {
    const src = files[i];
    const name = path.basename(src);
    if (batchCancel) return { ok, failed, dir: outDir, canceled: true };
    send({ done: i, total: files.length, name });

    // Для 'random' значения генерятся заново на каждый файл — метаданные у всех получаются разные.
    const kind = kindOf(src);
    const edits = req.valuesMode === 'random' ? randomTags(req.rand, kind) : { ...req.edits };
    // Разброс места: своя точка на каждый файл, чтобы координаты не повторялись.
    if (req.gpsJitter && req.valuesMode === 'same') {
      const j = req.gpsJitter;
      edits[GPS_KEY] = formatCoords(jitterCoords({ lat: j.lat, lon: j.lon }, j.jitterKm));
    }
    const tags = buildTags(edits, req.deletes, kind);
    if (typeof tags === 'string') { failed.push({ name, error: tags }); continue; }

    let target = src;
    try {
      if (!fs.existsSync(src)) throw new Error('файл не найден');
      if (req.target === 'copy') { target = copyTarget(src); await fs.promises.copyFile(src, target); }
      else if (outDir) { target = freeName(outDir, name); await fs.promises.copyFile(src, target); }
      await applyTags(target, tags, req.stripAll);
      ok++;
    } catch (err) {
      if (target !== src) await fs.promises.rm(target, { force: true }).catch(() => {});
      failed.push({ name, error: (err as Error).message.replace(/^Error:\s*/, '') });
    }
  }
  send({ done: files.length, total: files.length, name: '' });
  return { ok, failed, dir: outDir, canceled: false };
}

// ─── Пресеты: сохранённый набор полей, чтобы не набивать одно и то же руками ──
// Лежат в userData, а не в localStorage: пресеты переживают чистку кэша окна
// и остаются при переустановке приложения.

export interface MetaPreset {
  id: string;
  name: string;
  fields: Record<string, string>; // тег → значение, включая псевдо-поле __gps
  // Место с разбросом: координаты берутся не точкой, а случайно в круге вокруг неё,
  // заново для каждого файла — иначе у всей пачки стоит одна координата до шестого знака.
  gps?: { lat: number; lon: number; jitterKm: number };
  updatedAt: number;
}

const presetsFile = () => path.join(app.getPath('userData'), 'meta-presets.json');

async function loadPresets(): Promise<MetaPreset[]> {
  try {
    const raw = await fs.promises.readFile(presetsFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // файла ещё нет или он побился — начинаем с пустого списка
  }
}

async function savePresets(list: MetaPreset[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(presetsFile()), { recursive: true });
  await fs.promises.writeFile(presetsFile(), JSON.stringify(list, null, 2), 'utf8');
}

// ─── Поиск места по названию (Nominatim/OpenStreetMap) ───────────────────────
// Нужен интернет; если его нет, в UI остаётся встроенный список городов и ручной ввод.
interface GeoHit { name: string; lat: number; lon: number }

async function geocode(query: string): Promise<GeoHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // Сначала встроенный список — он работает офлайн и мгновенно.
  const local = CITIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).map((c) => ({
    name: c.name,
    lat: c.lat,
    lon: c.lon,
  }));

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&accept-language=ru&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Pulsar/1.0 (metadata module)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return local;
    const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    const remote = data
      .map((d) => ({ name: String(d.display_name ?? ''), lat: Number(d.lat), lon: Number(d.lon) }))
      .filter((d) => d.name && Number.isFinite(d.lat) && Number.isFinite(d.lon));
    // Локальные совпадения вперёд, дальше сетевые без дублей по координатам.
    const seen = new Set(local.map((l) => `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`));
    return [...local, ...remote.filter((r) => !seen.has(`${r.lat.toFixed(3)},${r.lon.toFixed(3)}`))];
  } catch {
    return local; // нет сети/таймаут — отдаём то, что есть офлайн
  }
}

export function registerMetadataHandlers() {
  ipcMain.handle('meta:pick', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Фото и видео', extensions: MEDIA_EXT }, { name: 'Фото', extensions: IMG_EXT }, { name: 'Видео', extensions: VID_EXT }, { name: 'Все файлы', extensions: ['*'] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle('meta:pickMany', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Фото и видео', extensions: MEDIA_EXT }, { name: 'Фото', extensions: IMG_EXT }, { name: 'Видео', extensions: VID_EXT }],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('meta:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  // Все картинки из папки — чтобы не тыкать файлы по одному.
  ipcMain.handle('meta:scanFolder', async (_e, dir: string): Promise<string[]> => {
    try {
      const names = await fs.promises.readdir(dir);
      return names
        .filter((n) => MEDIA_EXT.includes(path.extname(n).slice(1).toLowerCase()))
        .map((n) => path.join(dir, n))
        .sort();
    } catch { return []; }
  });

  // Путь для «Сохранить как…»: диалог с подставленным именем-копией.
  ipcMain.handle('meta:pickSavePath', async (_e, src: string) => {
    const ext = path.extname(src || '.jpg');
    const r = await dialog.showSaveDialog({
      defaultPath: src ? path.join(path.dirname(src), `${path.basename(src, ext)}_meta${ext}`) : undefined,
      filters: [{ name: 'Изображение', extensions: [ext.slice(1) || 'jpg'] }],
    });
    return r.canceled ? null : (r.filePath ?? null);
  });

  ipcMain.handle('meta:random', (_e, opts: RandOpts, kind: Kind = 'image'): Record<string, string> => randomTags(opts, kind));

  ipcMain.handle('meta:presetsLoad', (): Promise<MetaPreset[]> => loadPresets());

  ipcMain.handle('meta:presetsSave', async (_e, list: MetaPreset[]) => {
    try {
      await savePresets(Array.isArray(list) ? list : []);
      return { ok: true as const };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('meta:geocode', async (_e, query: string): Promise<GeoHit[]> => {
    try {
      return await geocode(query);
    } catch {
      return [];
    }
  });

  ipcMain.handle('meta:catalog', () => ({
    devices: DEVICES.map((d) => `${d.Make} ${d.Model}`),
    cities: CITIES.map((c) => c.name),
  }));

  ipcMain.handle('meta:batch', async (e, req: BatchReq): Promise<BatchResult> => {
    try {
      return await runBatch(req, (ev) => e.sender.send('meta:batchProgress', ev));
    } catch (err) {
      return { ok: 0, failed: [{ name: '', error: (err as Error).message }], dir: null, canceled: false };
    }
  });

  ipcMain.handle('meta:batchCancel', () => { batchCancel = true; return { ok: true }; });

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
