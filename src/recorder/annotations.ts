// Аннотации поверх записи: стрелки, текст, прямоугольник-подсветка. Координаты
// нормализованы (0..1) внутри области контента, не зумятся вместе с камерой.

export type AnnKind = 'arrow' | 'text' | 'box';

export interface Annotation {
  id: string;
  kind: AnnKind;
  startMs: number;
  endMs: number;
  x: number; // 0..1 — точка/левый-верх/хвост стрелки
  y: number;
  x2: number; // 0..1 — конец стрелки / правый-низ прямоугольника (для текста игнор)
  y2: number;
  text: string;
  color: string;
}

export const ANN_COLORS = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff'];

export function isActive(a: Annotation, tMs: number): boolean {
  return tMs >= a.startMs && tMs <= a.endMs;
}

function toPx(nx: number, ny: number, cx: number, cy: number, cw: number, ch: number) {
  return { x: cx + nx * cw, y: cy + ny * ch };
}

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  anns: Annotation[],
  tMs: number,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  W: number,
  selectedId: string | null,
  showHandles: boolean,
) {
  const lw = Math.max(2, W * 0.005);
  for (const a of anns) {
    if (!isActive(a, tMs)) continue;
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (a.kind === 'arrow') {
      const p1 = toPx(a.x, a.y, cx, cy, cw, ch);
      const p2 = toPx(a.x2, a.y2, cx, cy, cw, ch);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      // Наконечник.
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const head = lw * 4;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - head * Math.cos(ang - Math.PI / 6), p2.y - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(p2.x - head * Math.cos(ang + Math.PI / 6), p2.y - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (a.kind === 'box') {
      const p1 = toPx(Math.min(a.x, a.x2), Math.min(a.y, a.y2), cx, cy, cw, ch);
      const p2 = toPx(Math.max(a.x, a.x2), Math.max(a.y, a.y2), cx, cy, cw, ch);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    } else if (a.kind === 'text') {
      const p = toPx(a.x, a.y, cx, cy, cw, ch);
      const fs = Math.round(W * 0.03);
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(a.text || 'Текст').width;
      const padX = fs * 0.4;
      const padY = fs * 0.25;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x - padX, p.y - padY, tw + padX * 2, fs + padY * 2);
      ctx.fillStyle = a.color;
      ctx.fillText(a.text || 'Текст', p.x, p.y);
    }

    // Ручки выделения (только в превью).
    if (showHandles && a.id === selectedId) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0a84ff';
      ctx.lineWidth = 2;
      const pts = a.kind === 'text' ? [toPx(a.x, a.y, cx, cy, cw, ch)] : [toPx(a.x, a.y, cx, cy, cw, ch), toPx(a.x2, a.y2, cx, cy, cw, ch)];
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(5, W * 0.006), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export type Handle = 'p1' | 'p2' | 'body';

// Что под точкой (nx,ny в 0..1 контента) среди активных аннотаций. Сверху — последние.
export function hitTest(anns: Annotation[], nx: number, ny: number, tMs: number, aspect: number): { id: string; handle: Handle } | null {
  const near = 0.03;
  for (let i = anns.length - 1; i >= 0; i--) {
    const a = anns[i];
    if (!isActive(a, tMs)) continue;
    const d1 = Math.hypot((nx - a.x) * aspect, ny - a.y);
    if (d1 < near) return { id: a.id, handle: 'p1' };
    if (a.kind !== 'text') {
      const d2 = Math.hypot((nx - a.x2) * aspect, ny - a.y2);
      if (d2 < near) return { id: a.id, handle: 'p2' };
    }
    // Тело: для box — внутри; для стрелки — близко к линии; для текста — рядом с точкой.
    if (a.kind === 'box') {
      if (nx >= Math.min(a.x, a.x2) && nx <= Math.max(a.x, a.x2) && ny >= Math.min(a.y, a.y2) && ny <= Math.max(a.y, a.y2)) {
        return { id: a.id, handle: 'body' };
      }
    } else if (a.kind === 'arrow') {
      // Расстояние до отрезка.
      const vx = a.x2 - a.x;
      const vy = a.y2 - a.y;
      const len2 = vx * vx + vy * vy || 1e-6;
      let t = ((nx - a.x) * vx + (ny - a.y) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * vx;
      const py = a.y + t * vy;
      if (Math.hypot((nx - px) * aspect, ny - py) < near) return { id: a.id, handle: 'body' };
    } else if (a.kind === 'text') {
      if (nx >= a.x - 0.02 && nx <= a.x + 0.2 && ny >= a.y - 0.02 && ny <= a.y + 0.08) return { id: a.id, handle: 'body' };
    }
  }
  return null;
}
