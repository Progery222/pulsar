import { useCallback, useRef } from 'react';

// Переиспользуемые UI-компоненты VUB. Используют CSS-переменные палитры проекта (§4 ТЗ).

// Блок-обёртка параметра (фон --bg-secondary, скругление 8px, padding 16px).
export function Block({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

// Кастомный чекбокс (галочка цвета --accent-green).
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <span
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: `1px solid ${checked ? 'var(--accent-green)' : 'var(--border)'}`,
          background: checked ? 'var(--accent-green)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
        }}
      >
        {checked && (
          <svg className="vub-check-mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      {label != null && (
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{label}</span>
      )}
    </label>
  );
}

// Тумблер (Switch).
export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? 'var(--accent-green)' : 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.18s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: checked ? '#000' : '#fff',
          transition: 'left 0.18s ease',
        }}
      />
    </button>
  );
}

// Стилизованный выпадающий список (фон --bg-tertiary, граница --border).
export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        color: 'var(--text-primary)',
        padding: '8px 12px',
        fontSize: 14,
        outline: 'none',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Обычный (одиночный) слайдер.
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="vub-slider"
      style={{
        width: '100%',
        background: `linear-gradient(to right, var(--accent-green) ${pct}%, var(--bg-tertiary) ${pct}%)`,
      }}
    />
  );
}

// Двойной Range Slider: трек неактивный --bg-tertiary, активный (между ползунками) --accent-green.
export function RangeSlider({
  min,
  max,
  step = 1,
  valueMin,
  valueMax,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  valueMin: number;
  valueMax: number;
  onChange: (lo: number, hi: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const span = max - min;
  const loPct = ((valueMin - min) / span) * 100;
  const hiPct = ((valueMax - min) / span) * 100;

  const drag = useCallback(
    (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const move = (clientX: number) => {
        const rect = track.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        let raw = min + ratio * span;
        raw = Math.round(raw / step) * step;
        if (which === 'lo') onChange(Math.min(raw, valueMax), valueMax);
        else onChange(valueMin, Math.max(raw, valueMin));
      };
      const onMove = (ev: PointerEvent) => move(ev.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [min, span, step, valueMin, valueMax, onChange]
  );

  const knob = (left: number, handler: (e: React.PointerEvent) => void) => (
    <div
      onPointerDown={handler}
      style={{
        position: 'absolute',
        left: `${left}%`,
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
        cursor: 'pointer',
      }}
    />
  );

  return (
    <div ref={trackRef} style={{ position: 'relative', height: 16, margin: '8px 0' }}>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: 4,
          borderRadius: 4,
          background: 'var(--bg-tertiary)',
          transform: 'translateY(-50%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${loPct}%`,
          width: `${hiPct - loPct}%`,
          height: 4,
          borderRadius: 4,
          background: 'var(--accent-green)',
          transform: 'translateY(-50%)',
        }}
      />
      {knob(loPct, drag('lo'))}
      {knob(hiPct, drag('hi'))}
    </div>
  );
}
