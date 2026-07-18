import { useState } from 'react';
import { useUIStore, type AppMode } from '../store/uiStore';

const I = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

// Компактная карточка режима: иконка слева, текст справа. Заполняет ячейку сетки.
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
      className="mode-card-in flex items-center text-left"
      style={{
        ['--i' as string]: index,
        width: '100%',
        gap: 14,
        background: 'var(--bg-secondary)',
        border: `1px solid ${hover ? 'var(--accent-green)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 14,
        transition: 'border-color 0.16s ease, transform 0.16s ease',
        transform: hover ? 'translateY(-2px)' : 'none',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 44,
          height: 44,
          borderRadius: 11,
          background: 'var(--bg-tertiary)',
          color: 'var(--accent-green)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <h2 className="font-semibold" style={{ fontSize: 14.5, color: 'var(--text-primary)', margin: 0 }}>
          {title}
        </h2>
        <p style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--text-secondary)', margin: '3px 0 0' }}>
          {description}
        </p>
      </div>
    </button>
  );
}

type ModeDef = {
  title: string;
  description: string;
  icon: React.ReactNode;
  mode?: AppMode;
  onClick?: (ctx: { setAppMode: (m: AppMode) => void; setMontageChoose: (v: boolean) => void }) => void;
};

const CATEGORIES: { name: string; items: ModeDef[] }[] = [
  {
    name: 'Видео',
    items: [
      {
        title: 'Запись экрана',
        description: 'Захват экрана/окна в высоком качестве с авто-зумом к курсору',
        mode: 'recorder',
        icon: (
          <svg {...I(24)}>
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            <circle cx="8.5" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        title: 'Монтаж',
        description: 'Автоматический монтаж видео в ритм музыки',
        onClick: ({ setMontageChoose }) => setMontageChoose(true),
        icon: (
          <svg {...I(24)}>
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
          </svg>
        ),
      },
      {
        title: 'Шаблоны (AI)',
        description: 'Фото → вырезка фона → дизайн-шаблон с анимацией и текстом',
        mode: 'templates',
        icon: (
          <svg {...I(24)}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
            <circle cx="15" cy="15" r="1.6" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        title: 'Скачать видео',
        description: 'Загрузка по ссылкам с TikTok, YouTube, Instagram (пачкой)',
        mode: 'download',
        icon: (
          <svg {...I(24)}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        ),
      },
    ],
  },
  {
    name: 'Уникализация',
    items: [
      {
        title: 'Уникализатор (VUB)',
        description: 'Массовая уникализация видео для обхода алгоритмов',
        mode: 'vub',
        icon: (
          <svg {...I(24)}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        ),
      },
      {
        title: 'Замена титров (AI)',
        description: 'Поиск чужих титров/водяных знаков и автоперекрытие своими',
        mode: 'cleaner',
        icon: (
          <svg {...I(24)}>
            <path d="M3 3h18v18H3z" />
            <path d="M7 8h6" />
            <path d="M7 12h4" />
            <rect x="13" y="13" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        title: 'Удаление фона',
        description: 'ИИ-вырезание фона у изображений, кисть-доводка и экспорт PNG',
        mode: 'cutout',
        icon: (
          <svg {...I(24)}>
            <path d="M3 3h7v7H3z" />
            <path d="M14 14h7v7h-7z" />
            <path d="M14 3l7 7" />
            <path d="M3 14l7 7" />
          </svg>
        ),
      },
      {
        title: 'Изображения',
        description: 'Пакетное сжатие, размер, конвертация форматов, кроп, фильтры — локально',
        mode: 'imgopt',
        icon: (
          <svg {...I(24)}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        ),
      },
    ],
  },
  {
    name: 'Озвучка',
    items: [
      {
        title: 'Озвучка (TTS)',
        description: 'Генерация речи из текста и наложение на видео',
        mode: 'tts',
        icon: (
          <svg {...I(24)}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        ),
      },
      {
        title: 'Дубляж (AI)',
        description: 'Перевод и озвучка видео на другой язык по таймингам',
        mode: 'dub',
        icon: (
          <svg {...I(24)}>
            <path d="M5 8l6 6" />
            <path d="M4 14l6-6 2-3" />
            <path d="M2 5h12" />
            <path d="M7 2h1" />
            <path d="M22 22l-5-10-5 10" />
            <path d="M14 18h6" />
          </svg>
        ),
      },
    ],
  },
];

export default function ModeSelector() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const toggleQueue = useUIStore((s) => s.toggleQueue);
  const toggleHistory = useUIStore((s) => s.toggleHistory);
  const [montageChoose, setMontageChoose] = useState(false);

  let cardIndex = 0;

  return (
    <div
      className="flex h-full w-full flex-col items-center"
      style={{ background: 'var(--bg-primary)', padding: '32px 32px', overflowY: 'auto' }}
    >
      <div style={{ width: '100%', maxWidth: 920, margin: 'auto 0' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--accent-green)', marginBottom: 4, textAlign: 'center' }}>
          Pulsar
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28, textAlign: 'center' }}>
          Выберите режим работы
        </p>

        {CATEGORIES.map((cat) => (
          <div key={cat.name} style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                marginBottom: 10,
                paddingLeft: 2,
              }}
            >
              {cat.name}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 12,
              }}
            >
              {cat.items.map((m) => (
                <ModeCard
                  key={m.title}
                  index={cardIndex++}
                  title={m.title}
                  description={m.description}
                  icon={m.icon}
                  onClick={() =>
                    m.onClick ? m.onClick({ setAppMode, setMontageChoose }) : m.mode && setAppMode(m.mode)
                  }
                />
              ))}
            </div>
          </div>
        ))}

        {/* Вспомогательные разделы: очередь и история — мини-окна; настройки — экран. */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
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

      {/* Выбор режима монтажа: быстрый (beat-sync) или Pro (мульти-трек). */}
      {montageChoose && (
        <div
          onClick={() => setMontageChoose(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 28,
              width: 'min(620px, 92vw)',
            }}
          >
            <h2 className="font-semibold" style={{ fontSize: 22, color: 'var(--text-primary)', marginBottom: 6 }}>
              Режим монтажа
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 22 }}>
              Выберите способ работы над роликом
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ChooserCard
                title="Быстрый"
                sub="beat-sync"
                description="Авто-нарезка в ритм за 1–2 клика. Один видеоряд, стили и эффекты."
                onClick={() => setAppMode('editor')}
              />
              <ChooserCard
                title="Студия"
                sub="WebGPU"
                description="Проф. редактор: цветокор, эффекты, маски, ключи, экспорт до 4K."
                onClick={() => setAppMode('studio')}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChooserCard({
  title,
  sub,
  description,
  onClick,
}: {
  title: string;
  sub: string;
  description: string;
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
        background: 'var(--bg-tertiary)',
        border: `1px solid ${hover ? 'var(--accent-green)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 20,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, transform 0.15s ease',
        transform: hover ? 'translateY(-2px)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="font-semibold" style={{ fontSize: 18, color: 'var(--text-primary)' }}>
          {title}
        </span>
        <span style={{ fontSize: 12, color: 'var(--accent-green)' }}>{sub}</span>
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{description}</p>
    </button>
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
