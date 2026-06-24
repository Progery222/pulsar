import { useRef, useState } from 'react';
import type { Zone } from './store';

// Редактор зон перекрытия: фон — кадр видео, поверх рисуем/удаляем прямоугольники.
export default function ZoneEditor({
  videoSrc,
  zones,
  onAdd,
  onRemove,
  width = 300,
  titleZoneIndex = -1,
}: {
  videoSrc: string;
  zones: Zone[];
  onAdd: (z: Zone) => void;
  onRemove: (i: number) => void;
  width?: number;
  titleZoneIndex?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState(16 / 9); // h/w
  const [draft, setDraft] = useState<Zone | null>(null);
  const H = Math.round(width * aspect);

  function startDraw(e: React.PointerEvent) {
    if ((e.target as HTMLElement).dataset.del) return; // клик по кнопке удаления
    const box = ref.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width;
    const sy = (e.clientY - r.top) / r.height;
    const move = (ev: PointerEvent) => {
      const cx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const cy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      setDraft({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft((d) => {
        if (d && d.w > 0.02 && d.h > 0.01) onAdd({ x: +d.x.toFixed(4), y: +d.y.toFixed(4), w: +d.w.toFixed(4), h: +d.h.toFixed(4) });
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const rect = (z: Zone, i: number | null) => {
    const isTitle = i !== null && i === titleZoneIndex;
    return (
    <div
      key={i ?? 'draft'}
      style={{
        position: 'absolute',
        left: `${z.x * 100}%`,
        top: `${z.y * 100}%`,
        width: `${z.w * 100}%`,
        height: `${z.h * 100}%`,
        border: isTitle ? '2px solid var(--accent-green)' : '2px dashed var(--accent-green)',
        background: isTitle ? 'rgba(204,255,0,0.22)' : 'rgba(204,255,0,0.12)',
      }}
    >
      {i !== null && (
        <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 11, color: '#000', background: 'var(--accent-green)', borderRadius: 3, padding: '0 4px', fontWeight: 600 }}>
          {i + 1}{isTitle ? ' · Т' : ''}
        </span>
      )}
      {i !== null && (
        <button
          data-del="1"
          onClick={(e) => { e.stopPropagation(); onRemove(i); }}
          style={{ position: 'absolute', top: -10, right: -10, width: 20, height: 20, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: '20px', padding: 0 }}
        >
          ×
        </button>
      )}
    </div>
    );
  };

  return (
    <div
      ref={ref}
      onPointerDown={startDraw}
      style={{ position: 'relative', width, height: H, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#000', cursor: 'crosshair', flexShrink: 0 }}
    >
      <video
        ref={vidRef}
        src={videoSrc}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          const v = vidRef.current;
          if (v && v.videoWidth) setAspect(v.videoHeight / v.videoWidth);
          if (v) v.currentTime = Math.min(1, (v.duration || 4) * 0.25);
        }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
      />
      {zones.map((z, i) => rect(z, i))}
      {draft && rect(draft, null)}
    </div>
  );
}
