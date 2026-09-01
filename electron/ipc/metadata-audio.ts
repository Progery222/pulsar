import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

// Аудио для модуля «Метаданные»: чтение тегов трека и запись их обратно.
//
// Почему это отдельный файл, а не пара строк в metadata.ts: у звука другой
// инструмент записи. exiftool отказывается писать почти во все аудиоформаты —
// на mp3, wav, flac, ogg, opus, aiff, aac и wma он отвечает «Writing of MP3
// files is not yet supported». Читает он их нормально, поэтому разделение труда:
// читаем exiftool'ом, пишем ffmpeg'ом (ремультиплексирование с -c copy, звук
// не пережимается). Исключение — M4A: это контейнер QuickTime, exiftool пишет
// его напрямую, а ffmpeg в MP4 всегда затирает кодировщик своим значением.

export const AUD_EXT = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'aac', 'aiff', 'aif', 'wma'];

/** Форматы, в которые ffmpeg умеет писать теги. Список проверен экспериментом, а не по документации. */
export const WRITABLE_AUDIO_EXT = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav']);

/** M4A пишет exiftool: ffmpeg в контейнере MP4 подставляет туда собственное «Lavf…». */
export const AUDIO_EXIFTOOL_EXT = new Set(['.m4a']);

/** Канонические поля, которые видит и правит пользователь. Порядок — как в интерфейсе. */
export const AUDIO_FIELDS = [
  'Title', 'Artist', 'Album', 'AlbumArtist', 'Composer', 'Genre',
  'Year', 'Track', 'Disc', 'Comment', 'Copyright', 'Publisher', 'Encoder', 'Language',
] as const;

export type AudioField = (typeof AUDIO_FIELDS)[number];

const FIELD_SET = new Set<string>(AUDIO_FIELDS);
export const isAudioField = (tag: string): boolean => FIELD_SET.has(tag);

/** Имена тегов пользователю ничего не говорят — показываем по-русски. */
export const AUDIO_LABELS: Record<AudioField, string> = {
  Title: 'Название', Artist: 'Исполнитель', Album: 'Альбом', AlbumArtist: 'Исполнитель альбома',
  Composer: 'Композитор', Genre: 'Жанр', Year: 'Год', Track: 'Трек', Disc: 'Диск',
  Comment: 'Комментарий', Copyright: 'Авторские права', Publisher: 'Издатель',
  Encoder: 'Кодировщик', Language: 'Язык',
};

/**
 * Одно и то же поле в каждом контейнере называется по-своему: год — это
 * RecordingTime в MP3, Date во FLAC и OGG, ContentCreateDate в M4A и DateCreated
 * в WAV; альбом в WAV зовётся Product, комментарий во FLAC — Description.
 * Берём первое найденное, поэтому порядок значим.
 */
const READ_ALIASES: Record<AudioField, string[]> = {
  Title: ['Title', 'TIT2'],
  Artist: ['Artist', 'TPE1'],
  Album: ['Album', 'Product', 'TALB'],
  AlbumArtist: ['AlbumArtist', 'Band', 'TPE2'],
  Composer: ['Composer', 'TCOM'],
  Genre: ['Genre', 'TCON'],
  Year: ['RecordingTime', 'Date', 'DateCreated', 'ContentCreateDate', 'Year', 'ReleaseDate', 'DateTimeOriginal'],
  Track: ['Track', 'TrackNumber', 'TRCK'],
  Disc: ['DiscNumber', 'PartOfSet', 'TPOS'],
  Comment: ['Comment', 'Description', 'COMM'],
  Copyright: ['Copyright', 'TCOP'],
  Publisher: ['Publisher', 'Label', 'TPUB'],
  // EncodedBy первым: именно туда мы пишем. У OGG/Opus поле Encoder занято
  // строкой кодека («Lavc… libvorbis») из заголовка потока, а Technician — это
  // RIFF ITCH, куда ложится WAV.
  Encoder: ['EncodedBy', 'Encoder', 'EncoderSettings', 'Technician', 'Vendor', 'Software', 'Tool'],
  Language: ['Language', 'MediaLanguageCode', 'TLAN'],
};

export const AUDIO_ALIAS_TAGS = new Set<string>(Object.values(READ_ALIASES).flat());

/**
 * Ключи ffmpeg. Кодировщик пишется как encoded_by, и это не стилистика:
 * без -fflags +bitexact ffmpeg затирает наше значение своим «Lavf60.16.100»,
 * то есть штампует отпечаток в каждый файл. С bitexact ключ encoder не пишется
 * вовсе, а encoded_by проходит и ложится в TENC у MP3 и в ENCODED_BY у Vorbis.
 */
const FFMPEG_KEYS: Record<AudioField, string> = {
  Title: 'title', Artist: 'artist', Album: 'album', AlbumArtist: 'album_artist',
  Composer: 'composer', Genre: 'genre', Year: 'date', Track: 'track', Disc: 'disc',
  Comment: 'comment', Copyright: 'copyright', Publisher: 'publisher',
  Encoder: 'encoded_by', Language: 'language',
};

/** Технические поля: описывают сам звук, править их бессмысленно. */
export const AUDIO_TECH_TAGS = [
  'Duration', 'AudioBitrate', 'AvgBitrate', 'SampleRate', 'AudioSampleRate', 'Channels',
  'AudioChannels', 'NumChannels', 'ChannelMode', 'BitsPerSample', 'AudioBitsPerSample',
  'Encoding', 'AudioFormat', 'MPEGAudioVersion', 'AudioLayer', 'TotalSamples',
  'AvgBytesPerSec', 'BlockSizeMin', 'BlockSizeMax', 'FrameSizeMin', 'FrameSizeMax',
  'MD5Signature', 'ID3Size', 'MSStereo', 'IntensityStereo', 'Emphasis',
  'CopyrightFlag', 'OriginalMedia', 'VBRBitrate',
];

export function pickAudio(tags: Record<string, unknown>, field: AudioField): unknown {
  for (const alias of READ_ALIASES[field]) {
    const v = tags[alias];
    if (v != null && String(v) !== '') return v;
  }
  return undefined;
}

// Границы слова обязательны: без них «udio» находится внутри слова «Studio»,
// и любой файл из FL Studio, Studio One или Pro Tools объявлялся бы
// сгенерированным нейросетью.
const AI_AUDIO_RE = /\b(suno|udio|eleven ?labs|elevenlabs|mubert|soundraw|boomy|aiva|stable ?audio|musicgen|audiocraft|riffusion|beatoven|loudly|soundful)\b/i;

const AI_SCAN_KEYS = [
  'Encoder', 'EncoderSettings', 'EncodedBy', 'Vendor', 'Software', 'Tool',
  'Comment', 'Description', 'Publisher', 'Copyright', 'Title', 'Artist',
];

/** Улика в виде «поле: значение» или null. На слух ничего не анализируем. */
export function audioAiSignal(tags: Record<string, unknown>): string | null {
  for (const k of AI_SCAN_KEYS) {
    const v = tags[k];
    if (v == null) continue;
    const m = AI_AUDIO_RE.exec(String(v));
    if (m) return `${k}: ${m[1]}`;
  }
  return null;
}

/**
 * Поля, в которых генераторы оставляют свой след. Их и чистим при сохранении —
 * ровно так же, как у фото и видео удаляется манифест C2PA: пометка о том, что
 * файл сгенерирован, не должна пережить редактирование метаданных.
 *
 * Технические поля (Vendor, EncoderSettings) сюда не входят: они приходят из
 * заголовка потока и тегами не являются, ffmpeg их не перепишет.
 */
const AI_CLEANABLE: AudioField[] = ['Encoder', 'Comment', 'Publisher', 'Copyright', 'Title', 'Artist', 'Album'];

/**
 * Какие канонические поля несут след генератора. Возвращает имена полей,
 * чтобы вызывающий мог их очистить.
 */
export function audioAiFields(tags: Record<string, unknown>): AudioField[] {
  const hit: AudioField[] = [];
  for (const f of AI_CLEANABLE) {
    const v = pickAudio(tags, f);
    if (v != null && AI_AUDIO_RE.test(String(v))) hit.push(f);
  }
  return hit;
}

/** Ограничения контейнеров, о которых честнее сказать заранее. */
export const AUDIO_FORMAT_NOTES: Record<string, string> = {
  '.wav': 'WAV хранит теги в RIFF INFO, где нет Юникода: кириллица в них портится. Для русских названий берите MP3, FLAC или M4A.',
  '.opus': 'Opus сохраняет не все поля — номер трека и диска в нём теряются.',
  '.ogg': 'В OGG строка кодека перезаписывается при сохранении тегов — это особенность формата.',
};

const NON_WRITABLE_REASON: Record<string, string> = {
  '.aiff': 'В AIFF теги не записываются',
  '.aif': 'В AIFF теги не записываются',
  '.aac': 'В сыром AAC негде хранить теги — пересохраните в M4A',
  '.wma': 'В WMA теги не записываются',
};

export const audioWriteBlockReason = (file: string): string | null =>
  NON_WRITABLE_REASON[path.extname(file).toLowerCase()] ?? null;

// ─── Запись через ffmpeg ─────────────────────────────────────────────────────

const ffmpegBin = (): string => {
  const p = require('ffmpeg-static') as string;
  // В собранном приложении бинарь лежит распакованным рядом с asar.
  return String(p).replace('app.asar', 'app.asar.unpacked');
};

function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBin(), args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, _o, stderr) => {
      if (err) {
        const line = String(stderr || '').trim().split('\n').filter(Boolean).pop() ?? err.message;
        reject(new Error(line.slice(0, 300)));
        return;
      }
      resolve();
    });
  });
}

/**
 * Записать теги в аудиофайл.
 *
 * `-c copy` копирует поток как есть — звук не пережимается. `-map 0` сохраняет
 * все дорожки, включая обложку. `-fflags +bitexact` убирает автоштамп ffmpeg.
 */
export async function writeAudioTags(
  file: string,
  fields: Record<string, unknown>,
  stripAll?: boolean,
): Promise<void> {
  const blocked = audioWriteBlockReason(file);
  if (blocked) throw new Error(blocked);

  const ext = path.extname(file).toLowerCase();
  if (!WRITABLE_AUDIO_EXT.has(ext)) throw new Error('В этот формат запись тегов не поддерживается');

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', file,
    '-map', '0', '-c', 'copy',
    // -1 отвязывает метаданные источника: всё, что не переписано ниже, исчезает.
    '-map_metadata', stripAll ? '-1' : '0',
    '-fflags', '+bitexact',
  ];

  for (const field of AUDIO_FIELDS) {
    if (!(field in fields)) continue;
    const raw = fields[field];
    // Пустое значение — команда стереть поле.
    args.push('-metadata', `${FFMPEG_KEYS[field]}=${raw == null ? '' : String(raw)}`);
  }

  // ffmpeg не пишет в файл, который сам читает, — пишем рядом и подменяем.
  const tmp = path.join(path.dirname(file), `.ffm-${process.pid}-${Date.now()}${ext}`);
  args.push(tmp);

  try {
    await runFfmpeg(args);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// ─── Рандомайзер ─────────────────────────────────────────────────────────────

/** Чем реально собирают музыку. Строки взяты из живых файлов. */
export const AUDIO_ENCODERS = [
  'LAME 3.100', 'LAME 3.99.5', 'LAME 3.98.4',
  'iTunes 12.12.10', 'iTunes 12.9.6',
  'FL Studio 21', 'FL Studio 20.8',
  'Ableton Live 11.3', 'Ableton Live 12.0',
  'Logic Pro 10.8', 'Logic Pro X 10.7',
  'Adobe Audition 24.0', 'Adobe Audition CC 2019',
  'Audacity 3.4.2', 'Audacity 3.2.5',
  'Reaper 7.09', 'Cubase 13', 'Studio One 6.5', 'Pro Tools 2023.12',
  'dBpoweramp 17.6', 'Exact Audio Copy 1.6', 'foobar2000 2.1',
];

/** Жанры из стандартного списка ID3 — произвольные строки туда писать не принято. */
export const AUDIO_GENRES = [
  'Pop', 'Rock', 'Hip-Hop', 'Electronic', 'House', 'Techno', 'Trance', 'Drum & Bass',
  'Ambient', 'Jazz', 'Blues', 'Classical', 'Folk', 'Country', 'R&B', 'Soul', 'Funk',
  'Reggae', 'Metal', 'Punk', 'Indie', 'Lo-Fi', 'Soundtrack', 'Instrumental',
];

export interface AudioRandOpts {
  device: boolean; // → кодировщик
  shot: boolean;   // → жанр
  date: boolean;   // → год
  dateFrom?: string;
  dateTo?: string;
  encoder?: string | null; // конкретный кодировщик; null = случайный
  genre?: string | null;
}

const dayMs = 86_400_000;

/**
 * Исполнителя, название и альбом НЕ придумываем: подставлять выдуманное
 * авторство там, где оно читается как настоящее, — плохое поведение
 * по умолчанию. Эти поля пользователь заполняет сам.
 */
export function randomAudioTags(o: AudioRandOpts): Record<string, string> {
  const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
  const out: Record<string, string> = {};

  if (o.device) out.Encoder = (o.encoder && AUDIO_ENCODERS.includes(o.encoder) ? o.encoder : pick(AUDIO_ENCODERS));
  if (o.shot) out.Genre = (o.genre && AUDIO_GENRES.includes(o.genre) ? o.genre : pick(AUDIO_GENRES));

  if (o.date) {
    const to = o.dateTo ? Date.parse(o.dateTo) : Date.now();
    const from = o.dateFrom ? Date.parse(o.dateFrom) : (Number.isFinite(to) ? to : Date.now()) - 365 * dayMs;
    const lo = Number.isFinite(from) ? from : Date.now() - 365 * dayMs;
    const hi = Number.isFinite(to) && to > lo ? to : lo + 365 * dayMs;
    // У звука в ходу год, а не дата с точностью до секунды: так пишут теги
    // реальные кодировщики и так показывают плееры.
    out.Year = String(new Date(lo + Math.random() * (hi - lo)).getFullYear());
  }

  return out;
}
