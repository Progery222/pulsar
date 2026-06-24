import { useRef } from 'react';
import type { TitlesStyle } from '../types';

const POOL = ['ВАШ', 'ТЕКСТ', 'ТИТРА', 'ЗДЕСЬ', 'ПРИМЕР'];
const PREVIEW_W = 240;
const NORM_H = 1080; // размер шрифта/подложки задаётся в координатах высоты 1080 (как в рендере)

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Превью титра с перетаскиванием по координатам (X/Y в % кадра).
export default function TitlePreview({
  style,
  onMove,
  videoSrc,
}: {
  style: TitlesStyle;
  onMove: (xPct: number, yPct: number) => void;
  videoSrc?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const H = Math.round((PREVIEW_W * 16) / 9);
  const scale = H / NORM_H; // тот же масштаб, что и при рендере
  const fontPx = Math.max(7, style.fontSize * scale);
  const outlinePx = style.outline * scale;

  const words = POOL.slice(0, Math.max(1, Math.min(style.maxWordsPerLine, POOL.length)));
  const cased = (w: string) => (style.uppercase ? w.toUpperCase() : w.toLowerCase());

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const box = ref.current;
    if (!box) return;
    const move = (clientX: number, clientY: number) => {
      const r = box.getBoundingClientRect();
      const x = Math.min(98, Math.max(2, ((clientX - r.left) / r.width) * 100));
      const y = Math.min(98, Math.max(2, ((clientY - r.top) / r.height) * 100));
      onMove(Math.round(x), Math.round(y));
    };
    move(e.clientX, e.clientY);
    const onMv = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMv);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMv);
    window.addEventListener('pointerup', onUp);
  }

  const textStyle: React.CSSProperties = {
    fontFamily: `'${style.font}', sans-serif`,
    fontSize: fontPx,
    fontWeight: style.bold ? 800 : 500,
    lineHeight: 1.15,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    WebkitTextStroke: outlinePx > 0 ? `${outlinePx}px #000` : undefined,
    paintOrder: 'stroke fill',
    cursor: 'grab',
    userSelect: 'none',
    textShadow: '0 1px 4px rgba(0,0,0,0.5)',
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Превью (перетащите титр)
      </div>
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: PREVIEW_W,
          height: H,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: 'linear-gradient(135deg, #2b3a4a 0%, #16202b 60%, #0c1116 100%)',
        }}
      >
        {videoSrc && (
          <video
            ref={vidRef}
            src={videoSrc}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={() => {
              const v = vidRef.current;
              if (v) v.currentTime = Math.min(1, (v.duration || 4) * 0.25);
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '18%', background: 'rgba(255,107,53,0.07)' }} />

        {/* Текст с авто-обтекающей подложкой (как BorderStyle=3) */}
        <div
          onPointerDown={startDrag}
          style={{
            position: 'absolute',
            left: `${style.posXPct}%`,
            top: `${style.posYPct}%`,
            transform: 'translate(-50%, -50%)',
            maxWidth: '92%',
            ...textStyle,
            background: style.bg.enabled ? hexToRgba(style.bg.color, style.bg.opacity / 100) : undefined,
            padding: style.bg.enabled ? `${fontPx * 0.12}px ${fontPx * 0.22}px` : undefined,
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          }}
        >
          {words.map((w, i) => (
            <span key={i} style={{ color: style.karaoke && i === 0 ? style.highlightColor : style.baseColor }}>
              {cased(w)}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        X: {style.posXPct}% · Y: {style.posYPct}%
      </div>
    </div>
  );
}
