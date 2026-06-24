// Генерация .ass (Advanced SubStation Alpha) из распознанных слов + стиль.
// Чистая функция (без node-зависимостей) — общая для renderer-превью и electron-рендера.
import type { TitlesStyle, TranscriptWord } from './types';

// Нормализованная высота кадра: размер шрифта/позиции задаются в координатах 1080,
// libass масштабирует под реальное видео -> одинаковый вид при любом разрешении (и в превью).
const NORM_H = 1080;

// #RRGGBB -> ASS BBGGRR (без альфы), для \1c и \3c.
function color6(hex: string): string {
  const h = hex.replace('#', '');
  return `${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}
// непрозрачность 0..100 -> ASS альфа (00 = непрозрачно, FF = прозрачно).
function alpha2(opacityPct: number): string {
  const a = Math.round(255 * (1 - Math.min(100, Math.max(0, opacityPct)) / 100));
  return a.toString(16).padStart(2, '0').toUpperCase();
}

function fmtTime(ms: number): string {
  const cs = Math.round(ms / 10);
  const c = cs % 100;
  const s = Math.floor(cs / 100) % 60;
  const m = Math.floor(cs / 6000) % 60;
  const h = Math.floor(cs / 360000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${p2(c)}`;
}

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

// Путь скруглённого прямоугольника (ASS \p) от верхнего-левого угла (0,0) до (w,h).
export function roundRectPath(w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const R = (n: number) => Math.round(n);
  return (
    `m ${R(r)} 0 ` +
    `l ${R(w - r)} 0 b ${R(w)} 0 ${R(w)} 0 ${R(w)} ${R(r)} ` +
    `l ${R(w)} ${R(h - r)} b ${R(w)} ${R(h)} ${R(w)} ${R(h)} ${R(w - r)} ${R(h)} ` +
    `l ${R(r)} ${R(h)} b 0 ${R(h)} 0 ${R(h)} 0 ${R(h - r)} ` +
    `l 0 ${R(r)} b 0 0 0 0 ${R(r)} 0`
  );
}

export interface AssBuildOptions {
  width: number;
  height: number;
  variationIndex?: number;
  variationTotal?: number;
  marginFrac?: number; // боковой отступ как доля ширины (перенос текста в пределах зоны)
}

export function buildAss(words: TranscriptWord[], style: TitlesStyle, opts: AssBuildOptions): string {
  if (!words.length) return '';
  const idx = opts.variationIndex ?? 0;
  const total = opts.variationTotal ?? 1;

  // Нормализованный холст 1080 по высоте, ширина по аспекту реального видео.
  const aspect = opts.height > 0 ? opts.width / opts.height : 9 / 16;
  const H = NORM_H;
  const W = Math.max(1, Math.round(H * aspect));

  const jitter = total > 1 ? (idx / Math.max(1, total - 1) - 0.5) * H * 0.03 : 0;
  const posX = Math.round((style.posXPct / 100) * W);
  const posY = Math.round((style.posYPct / 100) * H + jitter);

  const baseC = color6(style.baseColor);
  const hlC = color6(style.highlightColor);
  const ml = Math.round(W * (opts.marginFrac != null ? Math.max(0.01, opts.marginFrac) : 0.05));
  const bg = style.bg;

  // Подложка = авто-обтекающий бокс (BorderStyle=3) — сам подгоняется под текст и перенос.
  // Иначе обычная обводка текста (BorderStyle=1).
  const bold = style.bold ? 1 : 0;
  let styleLine: string;
  if (bg?.enabled) {
    const pad = Math.max(6, Math.round(style.fontSize * 0.22));
    const boxColour = `&H${alpha2(bg.opacity)}${color6(bg.color)}`;
    styleLine = `Style: D,${style.font},${style.fontSize},&H00${baseC},&H00${baseC},${boxColour},&H00000000,${bold},0,0,0,100,100,0,0,3,${pad},0,5,${ml},${ml},0,1`;
  } else {
    styleLine = `Style: D,${style.font},${style.fontSize},&H00${baseC},&H00${baseC},&H00000000,&H64000000,${bold},0,0,0,100,100,0,0,1,${style.outline},1,5,${ml},${ml},0,1`;
  }

  const header =
    `[Script Info]\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${W}\n` +
    `PlayResY: ${H}\n` +
    `WrapStyle: 0\n\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ` +
    `Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, ` +
    `Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `${styleLine}\n\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const esc = (t: string) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
  const word = (w: TranscriptWord) => esc(style.uppercase ? w.text.toUpperCase() : w.text);
  const lines = groupLines(words, Math.max(1, style.maxWordsPerLine));
  const posTag = `\\an5\\pos(${posX},${posY})`;

  const events: string[] = [];
  for (const line of lines) {
    const lStart = fmtTime(line[0].start);
    const lEnd = fmtTime(line[line.length - 1].end);

    if (style.karaoke) {
      // Текущее слово — цветом подсветки, остальные — базовым. Отдельное событие на каждое слово.
      line.forEach((w, i) => {
        const segStart = fmtTime(w.start);
        const segEnd = fmtTime(i + 1 < line.length ? line[i + 1].start : w.end);
        const txt = line
          .map((ww, j) => `{\\1c&H${j === i ? hlC : baseC}&}${word(ww)}`)
          .join(' ');
        events.push(`Dialogue: 1,${segStart},${segEnd},D,,0,0,0,,{${posTag}}${txt}`);
      });
    } else {
      const txt = `{\\1c&H${baseC}&}` + line.map((w) => word(w)).join(' ');
      events.push(`Dialogue: 1,${lStart},${lEnd},D,,0,0,0,,{${posTag}\\fad(120,120)}${txt}`);
    }
  }

  return header + events.join('\n') + '\n';
}
