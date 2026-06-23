import { useRef, type PointerEvent } from 'react';

// Timeline (§5.5): полоса 24px со скраббером 16px (перетаскивание мышью) и
// полосой маркеров эффектов 8px (оранжевые точки 6px) над ней.
export default function Timeline({
  value,
  markers,
  onChange,
}: {
  value: number; // 0..1 — позиция скраббера
  markers: number[]; // позиции маркеров эффектов, 0..1
  onChange: (value: number) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  function pctFromEvent(e: PointerEvent) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function onPointerDown(e: PointerEvent) {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onChange(pctFromEvent(e));
  }
  function onPointerMove(e: PointerEvent) {
    if (dragging.current) onChange(pctFromEvent(e));
  }
  function onPointerUp() {
    dragging.current = false;
  }

  return (
    <div className="w-full select-none">
      {/* Полоса маркеров эффектов (8px) */}
      <div className="relative w-full" style={{ height: 8 }}>
        {markers.map((m, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${m * 100}%`,
              top: 1,
              width: 6,
              height: 6,
              marginLeft: -3,
              backgroundColor: 'var(--accent-orange)',
            }}
          />
        ))}
      </div>

      {/* Полоса таймлайна (24px) со скраббером */}
      <div
        ref={barRef}
        className="relative flex w-full cursor-pointer items-center"
        style={{ height: 24 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="h-1 w-full rounded-full bg-bg-tertiary">
          <div
            className="h-1 rounded-full"
            style={{ width: `${value * 100}%`, backgroundColor: 'var(--accent-green)' }}
          />
        </div>
        <span
          className="absolute rounded-full bg-white shadow"
          style={{ left: `${value * 100}%`, width: 16, height: 16, marginLeft: -8 }}
        />
      </div>
    </div>
  );
}
