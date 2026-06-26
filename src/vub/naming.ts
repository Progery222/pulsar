// Единая логика имени выходного файла (общая для UI и electron-рендера).

export interface NameArgs {
  baseName: string; // имя исходника без расширения
  variationIndex: number; // 0-based
  variationTotal: number;
  globalIndex: number; // сквозной индекс по всей очереди (0-based)
  totalFiles: number;
  pattern: string; // пользовательский шаблон (пусто = авто)
}

export function outFileName(a: NameArgs): string {
  const p = a.pattern.trim().replace(/[\\/:*?"<>|]/g, ''); // убираем запрещённые символы
  let name: string;
  if (p) {
    name = a.totalFiles === 1 ? p : `${p}_${a.globalIndex + 1}`;
  } else {
    name = a.variationTotal > 1 ? `${a.baseName}_pulsar_${a.variationIndex + 1}` : `${a.baseName}_pulsar`;
  }
  return `${name}.mp4`;
}
