import { useState } from 'react';

// Поле-скруббер: зажать и вести мышь влево/вправо -> значение меняется (как в After Effects).
// Двойной клик — ручной ввод. Колесо мыши — ±1.
export default function Scrubber({
  label,
  value,
  min,
  max,
  suffix = '',
  sensitivity = 0.3,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  sensitivity?: number;
  onChange: (v: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  function down(e: React.PointerEvent) {
    if (editing) return;
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startVal = value;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      onChange(clamp(Math.round(startVal + dx * sensitivity)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function wheel(e: React.WheelEvent) {
    e.preventDefault();
    onChange(clamp(value - Math.sign(e.deltaY)));
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      {editing ? (
        <input
          autoFocus
          type="number"
          min={min}
          max={max}
          defaultValue={value}
          onBlur={(e) => {
            onChange(clamp(Number(e.target.value)));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--accent-green)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
        />
      ) : (
        <div
          onPointerDown={down}
          onWheel={wheel}
          onDoubleClick={() => setEditing(true)}
          title="Зажмите и ведите мышь · колесо ±1 · двойной клик — ввод"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-tertiary)',
            border: `1px solid ${dragging ? 'var(--accent-green)' : 'var(--border)'}`,
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 14,
            cursor: 'ew-resize',
            userSelect: 'none',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>↔</span>
          <span>{value}{suffix}</span>
        </div>
      )}
    </div>
  );
}
