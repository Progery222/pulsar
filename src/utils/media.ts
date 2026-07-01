// Утилиты для работы с медиафайлами в renderer.

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'];

// Преобразование абсолютного пути в URL кастомной схемы media://.
export function mediaUrl(absolutePath: string): string {
  return `media:///${encodeURIComponent(absolutePath)}`;
}

export function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function extensionOf(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.includes(extensionOf(filePath));
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionOf(filePath));
}

// Форматирование секунд в M:SS.
export function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
