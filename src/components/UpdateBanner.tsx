import { useEffect, useState } from 'react';

type Status =
  | { state: 'none' }
  | { state: 'available'; version?: string }
  | { state: 'downloading'; percent?: number }
  | { state: 'ready'; version?: string }
  | { state: 'error'; error?: string };

// Баннер обновления (вверху справа). Появляется, когда доступна новая версия.
export default function UpdateBanner() {
  const [status, setStatus] = useState<Status>({ state: 'none' });

  useEffect(() => {
    const off = window.electronAPI.onUpdateStatus((s) => setStatus(s as Status));
    return off;
  }, []);

  if (status.state === 'none' || status.state === 'error') return null;

  const wrap: React.CSSProperties = {
    position: 'fixed',
    top: 12,
    right: 12,
    zIndex: 1500,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--accent-green)',
    borderRadius: 10,
    padding: '8px 12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    fontSize: 13,
    color: 'var(--text-primary)',
  };
  const greenBtn: React.CSSProperties = {
    background: 'var(--accent-green)',
    color: '#0D0D0D',
    border: 'none',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };

  if (status.state === 'available') {
    return (
      <div style={wrap}>
        <span>🔄 Доступно обновление{status.version ? ` v${status.version}` : ''}</span>
        <button style={greenBtn} onClick={() => window.electronAPI.downloadUpdate()}>
          Обновить
        </button>
      </div>
    );
  }
  if (status.state === 'downloading') {
    return (
      <div style={wrap}>
        <span>Загрузка обновления… {status.percent ?? 0}%</span>
      </div>
    );
  }
  // ready
  return (
    <div style={wrap}>
      <span>✅ Обновление готово{status.version ? ` v${status.version}` : ''}</span>
      <button style={greenBtn} onClick={() => window.electronAPI.installUpdate()}>
        Перезапустить
      </button>
    </div>
  );
}
