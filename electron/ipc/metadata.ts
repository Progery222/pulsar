import { ipcMain, dialog, shell } from 'electron';
import exifr from 'exifr';
import fs from 'node:fs';
import path from 'node:path';

// Модуль «Метаданные» — ЧЕСТНЫЙ инспектор: загрузил фото → видишь всё (EXIF, GPS, XMP,
// C2PA/Content Credentials, вердикт ИИ/реал). Только чтение, без правки/подделки.

const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'avif', 'gif'];

interface MetaGroup { title: string; rows: [string, string][]; }
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
  error?: string;
}

const fmt = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

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
    const rows: [string, string][] = [];
    for (const k of keys) {
      if (k in exif && exif[k] != null && fmt(exif[k]) !== '') { rows.push([k, fmt(exif[k])]); usedKeys.add(k); }
    }
    if (rows.length) groups.push({ title, rows });
  };

  const device = grp;
  device('Устройство и софт', deviceKeys);
  grp('Съёмка', shotKeys);
  grp('Изображение', imgKeys);

  if (gps) {
    const gpsRows: [string, string][] = [['Координаты', `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`]];
    for (const k of ['GPSAltitude', 'GPSImgDirection', 'GPSHPositioningError', 'GPSDateStamp', 'GPSTimeStamp']) {
      if (k in exif && exif[k] != null) { gpsRows.push([k, fmt(exif[k])]); usedKeys.add(k); }
    }
    groups.push({ title: 'GPS', rows: gpsRows });
  }

  // Остальные EXIF/XMP-поля — в «Прочее».
  const rest: [string, string][] = [];
  for (const k of Object.keys(exif)) {
    if (usedKeys.has(k)) continue;
    const val = fmt(exif[k]);
    if (val === '' || val.length > 200) continue;
    rest.push([k, val]);
  }
  if (rest.length) groups.push({ title: 'Прочие поля (EXIF/XMP/IPTC)', rows: rest.slice(0, 60) });

  // C2PA / Content Credentials.
  const c2pa = scanC2PA(buf);
  if (c2pa.present) groups.push({ title: 'C2PA / Content Credentials', rows: c2pa.rows.length ? c2pa.rows : [['Статус', 'манифест присутствует']] });

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
  else if (!groups.length) verdictText = 'Метаданных нет (файл очищен или формат без EXIF).';

  const summary: MetaSummary = { camera, gps: gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : null, shotDate, c2pa: c2pa.present, stripped };

  return { file, name, sizeKB, verdict, verdictText, summary, groups, gps };
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

  ipcMain.handle('meta:read', async (_e, file: string): Promise<MetaResult> => {
    try {
      return await readMeta(file);
    } catch (err) {
      return { file, name: path.basename(file || ''), sizeKB: 0, verdict: 'unknown', verdictText: '', summary: { camera: null, gps: null, shotDate: null, c2pa: false, stripped: false }, groups: [], gps: null, error: (err as Error).message };
    }
  });
}
