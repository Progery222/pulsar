// Сериализуемые типы модуля VUB — общие для renderer и electron-процесса (§5 ТЗ VUB).

export type VubTabKey =
  | 'videos'
  | 'params'
  | 'effects'
  | 'hard'
  | 'hooks'
  | 'watermark'
  | 'text'
  | 'titles'
  | 'template'
  | 'metadata'
  | 'performance';

// Слово из транскрибации (тайминги в миллисекундах).
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

// Подложка (плашка) под текстом титра.
export interface TitleBg {
  enabled: boolean;
  color: string; // HEX
  opacity: number; // затемнение/непрозрачность, 0..100 (100 = полностью непрозрачная)
  widthPct: number; // ширина, % ширины кадра (10..100)
  heightPct: number; // высота, % высоты кадра (3..40)
  radius: number; // скругление углов, px
}

// Авто-титры: распознавание речи (AssemblyAI) + стиль наложения.
export interface TitlesStyle {
  enabled: boolean;
  language: string; // 'auto' | 'ru' | 'en' | ...
  font: string;
  fontSize: number; // px в координатах кадра
  baseColor: string; // основной цвет текста
  highlightColor: string; // цвет подсветки активного слова (караоке)
  outline: number; // толщина обводки, px
  posXPct: number; // позиция центра титра по X, % ширины кадра (0..100)
  posYPct: number; // позиция центра титра по Y, % высоты кадра (0..100)
  karaoke: boolean; // пословная подсветка
  uppercase: boolean;
  bold: boolean; // жирное начертание
  maxWordsPerLine: number;
  bg: TitleBg; // подложка под текстом
}

export interface VubVideo {
  id: string;
  path: string;
  name: string;
}

export interface RangeParam {
  enabled: boolean;
  min: number;
  max: number;
}

export interface VubParams {
  brightness: RangeParam;
  contrast: RangeParam;
  sharpness: RangeParam;
  volume: RangeParam;
  duration: RangeParam;
  rotation: RangeParam; // лёгкий поворот видео, градусы
  pitch: RangeParam; // сдвиг тона аудио в полутонах (анти-Shazam), длительность сохраняется
  zoom: RangeParam; // зум/кадрирование, % (сдвигает композицию -> ломает перцептивный хеш видео)
}

// Жёсткие анти-детект фильтры: нелинейно меняют каждый кадр/спектр, ломать хеш
// сильнее косметики, но заметнее на глаз/слух (и тяжелее по CPU).
export interface VubHard {
  drift: boolean; // непрерывный дрейф кадра (зум + синусоидальный сдвиг кропа по времени)
  warp: boolean; // лёгкая дисторсия линзы (нелинейное смещение пикселей)
  frameBlend: boolean; // смешение соседних кадров (motion blur)
  fpsInterp: boolean; // интерполяция в другой fps (другой временной отпечаток, тяжело)
  audioFx: boolean; // vibrato + эхо (ломает тембр/аудио-отпечаток)
}

export type MirrorMode = 'random' | 'always' | 'never';

export interface VubEffects {
  darken: { enabled: boolean; duration: number; audioFadeIn: boolean };
  mirror: { enabled: boolean; mode: MirrorMode };
  grid: { enabled: boolean; opacityMin: number; opacityMax: number };
  gridColor: { enabled: boolean; colors: string[] };
  gridSize: { enabled: boolean; size: number };
}

export interface WatermarkZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VubWatermark {
  file: string | null;
  zones: WatermarkZone[];
  scale: number; // размер водяного знака как доля ширины кадра (0.02..0.4)
}

export interface VubText {
  spintax: string;
  font: string;
  size: number;
  color: string;
  position: 'top' | 'center' | 'bottom';
}

// Шаблон (склейка): из папки берутся случайные клипы и вставляются в видео в
// случайных местах (cutaway-вставки). count — сколько клипов вставить.
export interface VubTemplate {
  enabled: boolean;
  folder: string | null;
  count: number;
}

// Хуки: папка с короткими роликами-«зацепками». Случайный хук добавляется в начало
// видео. Если копий несколько — каждая копия получает свой (разный) хук.
export interface VubHooks {
  enabled: boolean;
  folder: string | null;
}

// Апскейл: повышение разрешения рендером (ломает перцептивный хеш сильнее косметики).
// target — целевая длинная сторона кадра в px (источник меньше — апскейлим, больше — не трогаем).
export interface VubUpscale {
  enabled: boolean;
  target: number; // 1920 (FullHD) | 2560 (2K) | 3840 (4K)
}

export type ProgressStatus = 'queued' | 'processing' | 'done' | 'error';

export interface FileProgress {
  id: string;
  name: string;
  status: ProgressStatus;
  percent: number;
  error?: string;
}

// Запрос на пакетную обработку очереди (renderer -> main).
export interface VubProcessRequest {
  videos: VubVideo[];
  params: VubParams;
  effects: VubEffects;
  watermark: VubWatermark;
  text: VubText;
  template: VubTemplate;
  hooks: VubHooks;
  hard: VubHard;
  cleanMetadata: boolean;
  nativeExport: boolean; // метаданные «нативного экспорта с телефона (Pulsar)» вместо случайных
  upscale: VubUpscale;
  titles: TitlesStyle;
  threads: number;
  variations: number; // количество уникальных вариаций на каждое видео
  namePattern: string; // свой шаблон имени файлов (пусто = имя оригинала + _pulsar)
  outputDir: string;
}

// Событие прогресса (main -> renderer).
export interface VubProgressEvent {
  id: string;
  status: ProgressStatus;
  percent: number;
  error?: string;
}
