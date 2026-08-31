// Пресеты голосов OmniVoice (voice design по описанию) — общие для Озвучки, Дубляжа и AI-ролика.
// Формат значения: 'design:<атрибуты через ", ">', 'clone:<путь к аудио>' — клонирование голоса
// из файла, '' — авто (случайный голос). Модель принимает только фиксированный словарь атрибутов:
// female/male, child/teenager/young adult/middle-aged/elderly, very low/low/moderate/high/very high pitch,
// whisper, <страна> accent — произвольные слова отклоняет.
// Чистые данные без React, чтобы импортировать и в main-процесс.
export const OMNI_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'Авто (случайный голос)' },
  { value: 'design:female, young adult', label: 'Женский — молодой' },
  { value: 'design:female, middle-aged', label: 'Женский — средний возраст' },
  { value: 'design:female, high pitch', label: 'Женский — высокий' },
  { value: 'design:female, low pitch', label: 'Женский — низкий' },
  { value: 'design:female, elderly', label: 'Женский — пожилой' },
  { value: 'design:male, young adult', label: 'Мужской — молодой' },
  { value: 'design:male, middle-aged', label: 'Мужской — средний возраст' },
  { value: 'design:male, low pitch', label: 'Мужской — низкий, глубокий' },
  { value: 'design:male, very low pitch', label: 'Мужской — очень низкий' },
  { value: 'design:male, elderly', label: 'Мужской — пожилой' },
  { value: 'design:male, teenager', label: 'Мужской — подросток' },
  { value: 'design:female, child', label: 'Детский' },
  { value: 'design:female, whisper', label: 'Женский — шёпот' },
  { value: 'design:male, whisper', label: 'Мужской — шёпот' },
];

export const CLONE_PREFIX = 'clone:';

export function isCloneVoice(voice: string): boolean {
  return voice.startsWith(CLONE_PREFIX);
}

export function cloneVoiceFile(voice: string): string {
  return isCloneVoice(voice) ? voice.slice(CLONE_PREFIX.length) : '';
}

export type TtsEngineChoice = 'auto' | 'omnivoice' | 'edge';

export const ENGINE_OPTIONS: { value: TtsEngineChoice; label: string }[] = [
  { value: 'auto', label: 'Авто (OmniVoice, если установлен)' },
  { value: 'omnivoice', label: 'OmniVoice — офлайн, клонирование голоса' },
  { value: 'edge', label: 'Edge TTS — онлайн, голоса Microsoft' },
];
