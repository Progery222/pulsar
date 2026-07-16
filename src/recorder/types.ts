// Типы модуля «Запись экрана».

export interface RecorderSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

export interface CursorSample {
  t: number; // мс от старта записи
  x: number; // абсолютные экранные DIP-координаты
  y: number;
}

export interface RecordedDisplay {
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export type Quality = '1080p' | '1440p' | '4k' | 'native';

export interface RecordingResult {
  webmPath: string;
  editPath?: string; // mp4 с корректной длительностью для редактора/перемотки
  webcamPath?: string; // сырой webm вебкамеры (если писалась)
  webcamEditPath?: string; // mp4 вебкамеры для редактора
  durationMs: number;
  cursor: CursorSample[];
  display: RecordedDisplay | null;
  width: number;
  height: number;
}
