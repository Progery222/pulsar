// Формирование субтитров из слов Whisper (тайминги в мс) и экспорт в SRT/VTT/TXT.
export interface Word {
  text: string;
  start: number; // мс
  end: number;
}
export interface Cue {
  start: number; // мс
  end: number;
  text: string;
}

const MAX_CHARS = 42;
const MAX_GAP_MS = 800;

// Группируем слова в реплики: по длине строки, концу фразы и паузам.
export function groupWords(words: Word[]): Cue[] {
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim() });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const text = cur.map((x) => x.text).join(' ');
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    if (text.length >= MAX_CHARS || /[.!?…]$/.test(w.text) || gap > MAX_GAP_MS) flush();
  }
  flush();
  return cues;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}
function fmtTime(ms: number, sep: string): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msec = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(msec, 3)}`;
}

export function toSRT(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${fmtTime(c.start, ',')} --> ${fmtTime(c.end, ',')}\n${c.text}\n`)
    .join('\n');
}

export function toVTT(cues: Cue[]): string {
  return 'WEBVTT\n\n' + cues.map((c) => `${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${c.text}\n`).join('\n');
}

export function toTXT(cues: Cue[]): string {
  return cues.map((c) => c.text).join('\n');
}
