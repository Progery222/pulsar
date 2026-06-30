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

// Устранение коллизий имён: если несколько исходников дают одинаковое выходное имя
// (например, все файлы названы «004»), к повторам добавляется _2, _3 … — иначе они
// перезаписывают друг друга и на выходе остаётся один файл.
export function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    if (!seen.has(n)) {
      seen.add(n);
      return n;
    }
    const dot = n.lastIndexOf('.');
    const base = dot >= 0 ? n.slice(0, dot) : n;
    const ext = dot >= 0 ? n.slice(dot) : '';
    let k = 2;
    let candidate = `${base}_${k}${ext}`;
    while (seen.has(candidate)) {
      k++;
      candidate = `${base}_${k}${ext}`;
    }
    seen.add(candidate);
    return candidate;
  });
}
