import { useUIStore } from '../store/uiStore';

// Иконка "Домой" для возврата на стартовый экран выбора режима (§3.2 ТЗ VUB).
export default function HomeButton() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  return (
    <button
      title="На главную"
      onClick={() => setAppMode('select')}
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        zIndex: 1000,
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    </button>
  );
}
