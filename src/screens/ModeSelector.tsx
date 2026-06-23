import { useState } from 'react';
import { useUIStore } from '../store/uiStore';

// Стартовый экран выбора режима (§3 ТЗ VUB).
function ModeCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex flex-col items-start text-left"
      style={{
        width: 320,
        height: 400,
        background: 'var(--bg-secondary)',
        border: `1px solid ${hover ? 'var(--accent-green)' : 'var(--border)'}`,
        borderRadius: 16,
        padding: 32,
        transition: 'border-color 0.18s ease',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          background: 'var(--bg-tertiary)',
          color: 'var(--accent-green)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 'auto',
        }}
      >
        {icon}
      </div>
      <h2
        className="font-semibold"
        style={{ fontSize: 24, color: 'var(--text-primary)', marginBottom: 12 }}
      >
        {title}
      </h2>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {description}
      </p>
    </button>
  );
}

export default function ModeSelector() {
  const setAppMode = useUIStore((s) => s.setAppMode);

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center"
      style={{ background: 'var(--bg-primary)' }}
    >
      <h1
        className="font-semibold"
        style={{ fontSize: 40, color: 'var(--accent-green)', marginBottom: 8 }}
      >
        Pulsar
      </h1>
      <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 48 }}>
        Выберите режим работы
      </p>

      <div style={{ display: 'flex', gap: 32 }}>
        <ModeCard
          title="Монтаж"
          description="Автоматический монтаж видео в ритм музыки"
          onClick={() => setAppMode('editor')}
          icon={
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
          }
        />
        <ModeCard
          title="Уникализатор (VUB)"
          description="Массовая уникализация видео для обхода алгоритмов"
          onClick={() => setAppMode('vub')}
          icon={
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
