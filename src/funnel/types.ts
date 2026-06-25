// Сериализуемые типы модуля «Воронка» (Funnel) — общие для renderer и electron-процесса.

// Этап обработки одной задачи воронки.
export type FunnelStage =
  | 'queued'
  | 'downloading'
  | 'analyzing'
  | 'processing'
  | 'done'
  | 'error';

// Целевые языки дубляжа/субтитров (коды соответствуют ТЗ: EN, ES, FR, BR, TR).
export interface FunnelLangOption {
  code: string; // 'en' | 'es' | 'fr' | 'br' | 'tr'
  label: string;
}

export const FUNNEL_LANGS: FunnelLangOption[] = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fr', label: 'FR' },
  { code: 'br', label: 'BR' },
  { code: 'tr', label: 'TR' },
];

// Запрос на запуск воронки (renderer -> main).
export interface FunnelStartRequest {
  url: string;
  targetLanguages: string[]; // подмножество кодов из FUNNEL_LANGS
  uniqueize: boolean; // применять лёгкую уникализацию к результату
  outputDir: string;
  model?: string; // slug модели OpenRouter для классификации
  asr?: 'assemblyai' | 'whisper'; // движок распознавания речи для дубляжа
}

// Задача воронки в очереди (одно скачанное видео).
export interface FunnelItem {
  id: string;
  name: string;
  stage: FunnelStage;
  percent: number;
  branch?: number; // 1..5 — определённая ветка
  stageLabel?: string; // человекочитаемый текущий этап
  error?: string;
  outputs: string[]; // пути готовых файлов
}

// Событие прогресса (main -> renderer). Частичное обновление задачи по id.
export interface FunnelProgressEvent {
  id: string;
  name?: string;
  stage?: FunnelStage;
  percent?: number;
  branch?: number;
  stageLabel?: string;
  error?: string;
  output?: string; // добавить путь в список результатов
}
