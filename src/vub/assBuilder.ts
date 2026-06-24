// Генерация .ass (Advanced SubStation Alpha) из распознанных слов + стиль.
// Чистая функция (без node-зависимостей) — общая для renderer-превью и electron-рендера.
import type { TitlesStyle, TranscriptWord } from './types';

// #RRGGBB -> &H00BBGGRR (ASS: alpha,B,G,R; alpha 00 = непрозрачно).
function assColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

// мс -> h:mm:ss.cc
function fmtTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const c = cs % 100;
  const s = Math.floor(cs / 100) % 60;
  const m = Math.floor(cs / 6000) % 60;
  const h = Math.floor(cs / 360000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${p2(c)}`;
}

// Группировка слов в строки: по числу слов и по паузам между словами.
function groupLines(words: TranscriptWord[], maxWords: number): TranscriptWord[][] {
  const lines: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (cur.length >= maxWords || (prev && gap > 600)) {
      if (cur.length) lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export interface AssBuildOptions {
  width: number;
  height: number;
  variationIndex?: number;
  variationTotal?: number;
}

// Возвращает текст .ass-файла. Пусто, если слов нет.
export function buildAss(
  words: TranscriptWord[],
  style: TitlesStyle,
  opts: AssBuildOptions
): string {
  if (!words.length) return '';
  const { width, height } = opts;
  const idx = opts.variationIndex ?? 0;
  const total = opts.variationTotal ?? 1;

  // Точная позиция центра титра (\an5 + \pos) из процентов кадра.
  const jitter = total > 1 ? (idx / Math.max(1, total - 1) - 0.5) * height * 0.03 : 0;
  const posX = Math.round((style.posXPct / 100) * width);
  const posY = Math.round((style.posYPct / 100) * height + jitter);

  const fontSize = style.fontSize;
  // В караоке: Primary = подсветка (активное слово), Secondary = базовый цвет.
  const primary = style.karaoke ? assColor(style.highlightColor) : assColor(style.baseColor);
  const secondary = assColor(style.baseColor);
  const outlineColor = '&H00000000';

  const header =
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${width}\n` +
    `PlayResY: ${height}\n` +
    `WrapStyle: 0\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ` +
    `Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, ` +
    `Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: D,${style.font},${fontSize},${primary},${secondary},${outlineColor},&H64000000,` +
    `1,0,0,0,100,100,0,0,1,${style.outline},1,5,${Math.round(width * 0.06)},` +
    `${Math.round(width * 0.06)},0,1\n\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const esc = (t: string) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
  const lines = groupLines(words, Math.max(1, style.maxWordsPerLine));
  // Префикс позиции: центрируем блок на (posX, posY) + плавное появление.
  const posTag = `{\\an5\\pos(${posX},${posY})\\fad(120,120)}`;

  const events = lines
    .map((line) => {
      const start = fmtTime(line[0].start);
      const end = fmtTime(line[line.length - 1].end);
      let text: string;
      if (style.karaoke) {
        text = line
          .map((w) => {
            const durCs = Math.max(1, Math.round((w.end - w.start) / 10));
            const word = style.uppercase ? w.text.toUpperCase() : w.text;
            return `{\\k${durCs}}${esc(word)} `;
          })
          .join('')
          .trimEnd();
      } else {
        text = line.map((w) => (style.uppercase ? w.text.toUpperCase() : w.text)).join(' ');
        text = esc(text);
      }
      return `Dialogue: 0,${start},${end},D,,0,0,0,,${posTag}${text}`;
    })
    .join('\n');

  return header + events + '\n';
}
