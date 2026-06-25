import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import type { ScreenName } from '../types';

// Предыдущий экран во внутреннем потоке Монтажа.
const PREV_SCREEN: Partial<Record<ScreenName, ScreenName>> = {
  media: 'home',
  music: 'media',
  processing: 'music',
  editor: 'home',
};

// Единая панель навигации: «Назад», «На главную», «Выход». Видна на всех экранах,
// кроме стартового — чтобы из любого режима всегда был очевидный выход.
export default function TopBar() {
  const appMode = useUIStore((s) => s.appMode);
  const setAppMode = useUIStore((s) => s.setAppMode);
  const currentScreen = useProjectStore((s) => s.currentScreen);
  const setCurrentScreen = useProjectStore((s) => s.setCurrentScreen);

  function goBack() {
    // В режиме Монтаж — шаг назад по внутреннему потоку, с первого экрана — на старт.
    if (appMode === 'editor') {
      const prev = PREV_SCREEN[currentScreen];
      if (prev) setCurrentScreen(prev);
      else setAppMode('select');
      return;
    }
    // Остальные режимы (VUB, Cleaner, Settings, History) — сразу на старт.
    setAppMode('select');
  }

  function goHome() {
    setAppMode('select');
  }

  function quit() {
    if (window.confirm('Выйти из приложения?')) window.electronAPI.quitApp();
  }

  const btn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 12px',
    borderRadius: 8,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    fontSize: 13,
    cursor: 'pointer',
  };

  return (
    <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 1000, display: 'flex', gap: 8 }}>
      <button title="Назад" onClick={goBack} style={btn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Назад
      </button>
      <button title="На главную" onClick={goHome} style={btn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        На главную
      </button>
      <button title="Выход" onClick={quit} style={{ ...btn, color: 'var(--text-secondary)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Выход
      </button>
    </div>
  );
}
