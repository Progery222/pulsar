import { useState } from 'react';
import { useUIStore } from '../store/uiStore';

// Карточка режима — адаптивная (заполняет ячейку сетки), с анимацией появления.
function ModeCard({
  title,
  description,
  icon,
  onClick,
  index,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  index: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="mode-card-in flex flex-col items-start text-left"
      style={{
        ['--i' as string]: index,
        width: '100%',
        minHeight: 210,
        background: 'var(--bg-secondary)',
        border: `1px solid ${hover ? 'var(--accent-green)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: 22,
        transition: 'border-color 0.18s ease, transform 0.18s ease',
        transform: hover ? 'translateY(-3px)' : 'none',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 68,
          height: 68,
          borderRadius: 16,
          background: 'var(--bg-tertiary)',
          color: 'var(--accent-green)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          marginBottom: 'auto',
        }}
      >
        {icon}
      </div>
      <h2 className="font-semibold" style={{ fontSize: 19, color: 'var(--text-primary)', margin: '18px 0 6px' }}>
        {title}
      </h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{description}</p>
    </button>
  );
}

export default function ModeSelector() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const toggleQueue = useUIStore((s) => s.toggleQueue);
  const toggleHistory = useUIStore((s) => s.toggleHistory);

  const I = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center"
      style={{ background: 'var(--bg-primary)', padding: '24px 32px', overflowY: 'auto' }}
    >
      <h1 className="font-semibold" style={{ fontSize: 36, color: 'var(--accent-green)', marginBottom: 6 }}>
        Pulsar
      </h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 36 }}>Выберите режим работы</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 18,
          width: '100%',
          maxWidth: 980,
        }}
      >
        <ModeCard
          index={0}
          title="Монтаж"
          description="Автоматический монтаж видео в ритм музыки"
          onClick={() => setAppMode('editor')}
          icon={
            <svg {...I(38)}>
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
          }
        />
        <ModeCard
          index={1}
          title="Уникализатор (VUB)"
          description="Массовая уникализация видео для обхода алгоритмов"
          onClick={() => setAppMode('vub')}
          icon={
            <svg {...I(38)}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          }
        />
        <ModeCard
          index={2}
          title="Замена титров (AI)"
          description="Поиск чужих титров/водяных знаков и автоперекрытие своими"
          onClick={() => setAppMode('cleaner')}
          icon={
            <svg {...I(38)}>
              <path d="M3 3h18v18H3z" />
              <path d="M7 8h6" />
              <path d="M7 12h4" />
              <rect x="13" y="13" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
            </svg>
          }
        />
        <ModeCard
          index={3}
          title="Озвучка (TTS)"
          description="Генерация речи из текста и наложение на видео"
          onClick={() => setAppMode('tts')}
          icon={
            <svg {...I(38)}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          }
        />
        <ModeCard
          index={4}
          title="Дубляж (AI)"
          description="Перевод и озвучка видео на другой язык по таймингам"
          onClick={() => setAppMode('dub')}
          icon={
            <svg {...I(38)}>
              <path d="M5 8l6 6" />
              <path d="M4 14l6-6 2-3" />
              <path d="M2 5h12" />
              <path d="M7 2h1" />
              <path d="M22 22l-5-10-5 10" />
              <path d="M14 18h6" />
            </svg>
          }
        />
        <ModeCard
          index={5}
          title="Воронка (AI)"
          description="Скачивание по ссылке, AI-классификация и авто-обработка по веткам"
          onClick={() => setAppMode('funnel')}
          icon={
            <svg {...I(38)}>
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="18" cy="6" r="2.5" />
              <circle cx="12" cy="18" r="2.5" />
              <path d="M6 8.5v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3" />
              <path d="M12 13.5v2" />
            </svg>
          }
        />
        <ModeCard
          index={6}
          title="Скачать видео"
          description="Загрузка по ссылкам с TikTok, YouTube, Instagram и др. (пачкой)"
          onClick={() => setAppMode('download')}
          icon={
            <svg {...I(38)}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          }
        />
      </div>

      {/* Вспомогательные разделы: очередь и история — мини-окна; настройки — экран. */}
      <div style={{ display: 'flex', gap: 14, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={toggleQueue} style={miniCard}>
          <svg {...I(17)}>
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Очередь
        </button>
        <button onClick={toggleHistory} style={miniCard}>
          <svg {...I(17)}>
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l4 2" />
          </svg>
          История
        </button>
        <button onClick={() => setAppMode('settings')} style={miniCard}>
          <svg {...I(17)}>
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
  padding: '10px 20px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontSize: 14,
  cursor: 'pointer',
};
