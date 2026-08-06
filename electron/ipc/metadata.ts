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

// edits/deletes из UI → набор тегов для exiftool. Строка в ответе = текст ошибки валидации.
function buildTags(edits: Record<string, string> = {}, deletes: string[] = []): Record<string, unknown> | string {
  const tags: Record<string, unknown> = {};
  for (const [tag, raw] of Object.entries(edits)) {
    if (tag === GPS_KEY) {
      const g = gpsTags(raw);
      if (typeof g === 'string') return g;
      Object.assign(tags, g);
      continue;
    }
    const v = String(raw ?? '').trim();
    tags[tag] = v === '' ? null : v;
  }
  for (const tag of deletes) {
    if (tag === GPS_KEY) { for (const t of GPS_TAGS) tags[t] = null; continue; }
    tags[tag] = null;
  }
  return tags;
}

// Записать теги в конкретный файл. Бросает исключение с текстом от exiftool.
async function applyTags(target: string, tags: Record<string, unknown>, stripAll?: boolean) {
  // Сначала полная очистка (отдельным проходом: в одном вызове «-all=» затрёт и новые значения),
  // потом запись правок. «-overwrite_original» — чтобы не плодить файлы *_original рядом.
  if (stripAll) await tool().write(target, {}, { writeArgs: ['-all=', '-overwrite_original'] });
  if (Object.keys(tags).length) {
    const res = await tool().write(target, tags as never, { writeArgs: ['-overwrite_original'] });
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

  const tags = buildTags(req.edits, req.deletes);
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

function randomTags(o: RandOpts): Record<string, string> {
  const out: Record<string, string> = {};
  const dev = (o.deviceModel && DEVICES.find((d) => `${d.Make} ${d.Model}` === o.deviceModel)) || pick(DEVICES);

  if (o.device) {
    out.Make = dev.Make;
    out.Model = dev.Model;
    out.Software = dev.Software;
    if (dev.LensModel) out.LensModel = dev.LensModel;
  }
  if (o.shot) {
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
    out.DateTimeOriginal = s;
    out.CreateDate = s;
    out.ModifyDate = s;
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
  const files = (req.files || []).filter((f) => WRITABLE_EXT.has(path.extname(f).toLowerCase()));
  const failed: BatchResult['failed'] = [];
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

    // Для 'random' значения генерятся заново на каждое фото — метаданные у всех получаются разные.
    const edits = req.valuesMode === 'random' ? randomTags(req.rand) : req.edits;
    const tags = buildTags(edits, req.deletes);
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

export function registerMetadataHandlers() {
  ipcMain.handle('meta:pick', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: IMG_EXT }, { name: 'Все файлы', extensions: ['*'] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle('meta:pickMany', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Изображения', extensions: IMG_EXT }],
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
        .filter((n) => IMG_EXT.includes(path.extname(n).slice(1).toLowerCase()))
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

  ipcMain.handle('meta:random', (_e, opts: RandOpts): Record<string, string> => randomTags(opts));

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
