import { useEffect, useRef, useState } from 'react';

interface Props {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  initial?: { x: number; y: number };
  width?: number;
}

// Плавающее мини-окно: перетаскивается за шапку, поверх любого экрана.
export default function FloatingWindow({ title, onClose, children, initial, width = 460 }: Props) {
  const [pos, setPos] = useState(initial ?? { x: window.innerWidth - width - 32, y: 64 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy));
      setPos({ x, y });
    }
    function onUp() {
      drag.current = null;
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width,
        maxHeight: 'calc(100vh - 96px)',
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border)',
          cursor: 'move',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
          title="Закрыть"
        >
          ✕
        </button>
      </div>
      <div style={{ overflowY: 'auto', padding: 14 }}>{children}</div>
    </div>
  );
}
