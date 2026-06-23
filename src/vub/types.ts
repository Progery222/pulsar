// Сериализуемые типы модуля VUB — общие для renderer и electron-процесса (§5 ТЗ VUB).

export type VubTabKey =
  | 'videos'
  | 'params'
  | 'effects'
  | 'watermark'
  | 'text'
  | 'template'
  | 'metadata'
  | 'performance';

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
}

export interface VubText {
  spintax: string;
  font: string;
  size: number;
  color: string;
  position: 'top' | 'center' | 'bottom';
}

export interface VubTemplate {
  folder: string | null;
  everySeconds: number;
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
  cleanMetadata: boolean;
  threads: number;
  variations: number; // количество уникальных вариаций на каждое видео
  outputDir: string;
}

// Событие прогресса (main -> renderer).
export interface VubProgressEvent {
  id: string;
  status: ProgressStatus;
  percent: number;
  error?: string;
}
