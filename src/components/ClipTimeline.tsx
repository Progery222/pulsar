import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { mediaUrl } from '../utils/media';

const PX_PER_SEC = 34; // ширина блока ∝ длительности; этот же масштаб для trim

// Миниатюра кадра клипа (ленивая загрузка через media:thumb, кэш в main).
function ClipThumb({ src, time }: { src: string; time: number }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.electronAPI.thumb(src, time).then((p) => {
      if (alive) setThumb(p);
    });
    return () => {
      alive = false;
    };
  }, [src, time]);
  return thumb ? (
    <img src={mediaUrl(thumb)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  ) : (
    <div style={{ width: '100%', height: '100%', background: '#000' }} />
  );
}

// Интерактивный таймлайн монтажа: клипы блоками. Выбор / удаление / перетаскивание.
export default function ClipTimeline() {
  const clips = useProjectStore((s) => s.generatedClips);
  const reorderClips = useProjectStore((s) => s.reorderClips);
  const removeClip = useProjectStore((s) => s.removeClip);
  const [sel, setSel] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Trim: тянем края клипа -> меняем старт/длину.
  const trimRef = useRef<{ i: number; side: 'l' | 'r'; startX: number; origStart: number; origDur: number } | null>(null);
  const onTrimMove = useCallback((e: PointerEvent) => {
    const d = trimRef.current;
    if (!d) return;
    const delta = (e.clientX - d.startX) / PX_PER_SEC;
    const trim = useProjectStore.getState().trimClip;
    if (d.side === 'r') {
      trim(d.i, d.origStart, d.origDur + delta);
    } else {
      const ns = Math.max(0, d.origStart + delta);
      trim(d.i, ns, d.origDur - (ns - d.origStart));
    }
  }, []);
  const onTrimUp = useCallback(() => {
    trimRef.current = null;
    window.removeEventListener('pointermove', onTrimMove);
    window.removeEventListener('pointerup', onTrimUp);
  }, [onTrimMove]);
  const onTrimDown = (e: React.PointerEvent, i: number, side: 'l' | 'r') => {
    e.stopPropagation();
    e.preventDefault();
    const c = clips[i];
    trimRef.current = { i, side, startX: e.clientX, origStart: c.startTime, origDur: c.duration };
    window.addEventListener('pointermove', onTrimMove);
    window.addEventListener('pointerup', onTrimUp);
  };

  if (!clips.length) return null;

  const grip = (side: 'l' | 'r'): React.CSSProperties => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side === 'l' ? 'left' : 'right']: 0,
    width: 8,
    cursor: 'ew-resize',
    background: `linear-gradient(${side === 'l' ? 'to right' : 'to left'}, rgba(204,255,0,0.5), transparent)`,
    zIndex: 2,
  });

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Таймлайн ({clips.length} клипов)
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          перетащи — поменять порядок · выбери — удалить
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
        {clips.map((c, i) => {
          const w = Math.max(44, Math.min(160, Math.round(c.duration * 34)));
          const isSel = sel === i;
          const isOver = overIdx === i && dragFrom !== null && dragFrom !== i;
          return (
            <div
              key={i}
              draggable={!isSel}
              onDragStart={() => setDragFrom(i)}
              onDragEnd={() => {
                setDragFrom(null);
                setOverIdx(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== i) reorderClips(dragFrom, i);
                setDragFrom(null);
                setOverIdx(null);
              }}
              onClick={() => setSel(isSel ? null : i)}
              title={`Клип ${i + 1} · ${c.duration.toFixed(1)}с`}
              style={{
                position: 'relative',
                flexShrink: 0,
                width: w,
                height: 64,
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'grab',
                border: isSel ? '2px solid var(--accent-green)' : isOver ? '2px dashed var(--accent-green)' : '2px solid transparent',
                opacity: dragFrom === i ? 0.4 : 1,
              }}
            >
              <ClipThumb src={c.sourceFile} time={c.startTime} />
              {isSel && <div onPointerDown={(e) => onTrimDown(e, i, 'l')} style={grip('l')} title="Тянуть — обрезать слева" />}
              {isSel && <div onPointerDown={(e) => onTrimDown(e, i, 'r')} style={grip('r')} title="Тянуть — изменить длину" />}
              <span
                style={{
                  position: 'absolute',
                  left: 3,
                  bottom: 2,
                  fontSize: 10,
                  color: '#fff',
                  background: 'rgba(0,0,0,0.55)',
                  borderRadius: 3,
                  padding: '0 4px',
                  pointerEvents: 'none',
                }}
              >
                {c.duration.toFixed(1)}с
              </span>
              {c.effectSlots.length > 0 && (
                <span style={{ position: 'absolute', right: 3, top: 2, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-green)' }} />
              )}
              {isSel && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeClip(i);
                    setSel(null);
                  }}
                  title="Удалить клип"
                  style={{
                    position: 'absolute',
                    right: 2,
                    bottom: 2,
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: 'var(--danger)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
