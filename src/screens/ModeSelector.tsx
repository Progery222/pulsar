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

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
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
        <ModeCard
          title="Замена титров (AI)"
          description="Поиск чужих титров/водяных знаков и автоперекрытие своими"
          onClick={() => setAppMode('cleaner')}
          icon={
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18v18H3z" />
              <path d="M7 8h6" />
              <path d="M7 12h4" />
              <rect x="13" y="13" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
            </svg>
          }
        />
      </div>

      {/* Вспомогательные разделы: история и настройки. */}
      <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
        <button onClick={() => setAppMode('history')} style={miniCard}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l4 2" />
          </svg>
          История
        </button>
        <button onClick={() => setAppMode('settings')} style={miniCard}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Настройки
        </button>
      </div>
    </div>
  );
}

const miniCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 24px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text-primary)',
  fontSize: 14,
  cursor: 'pointer',
};
