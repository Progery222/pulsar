import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import FloatingWindow from './FloatingWindow';

interface HistoryEntry {
  id: string;
  mode: 'editor' | 'vub' | 'cleaner';
  title: string;
  createdAt: number;
  outputDir: string;
  files: string[];
  settings: unknown;
}

const MODE_LABEL: Record<HistoryEntry['mode'], string> = {
  editor: 'Монтаж',
  vub: 'Уникализатор',
  cleaner: 'Замена титров',
};

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Плавающее мини-окно «История»: открыть папку результата, повторить режим, удалить.
export default function HistoryPanel() {
  const setShowHistory = useUIStore((s) => s.setShowHistory);
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  async function reload() {
    setEntries((await window.electronAPI.historyList()) as HistoryEntry[]);
  }
  useEffect(() => {
    reload();
  }, []);

  async function remove(id: string) {
    await window.electronAPI.historyRemove(id);
    reload();
  }
  async function clearAll() {
    if (window.confirm('Очистить всю историю? Файлы на диске останутся.')) {
      await window.electronAPI.historyClear();
      reload();
    }
  }

  const smallBtn: React.CSSProperties = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
    color: 'var(--text-primary)',
  };

  return (
    <FloatingWindow
      title="История"
      onClose={() => setShowHistory(false)}
      initial={{ x: 32, y: 64 }}
    >
      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          Пока пусто. Завершённые задачи будут появляться здесь.
        </p>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <button onClick={clearAll} style={{ ...smallBtn, color: 'var(--text-secondary)' }}>
              Очистить всё
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {entries.map((e) => (
              <div key={e.id} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-green)', background: 'var(--bg-secondary)', borderRadius: 5, padding: '2px 7px' }}>
                    {MODE_LABEL[e.mode]}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {fmtDate(e.createdAt)} • файлов: {e.files.length}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {e.outputDir && (
                    <button onClick={() => window.electronAPI.openFolder(e.outputDir)} style={smallBtn}>
                      Открыть папку
                    </button>
                  )}
                  <button onClick={() => { setAppMode(e.mode); setShowHistory(false); }} style={smallBtn}>
                    Повторить
                  </button>
                  <button onClick={() => remove(e.id)} style={{ ...smallBtn, color: 'var(--danger)' }}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </FloatingWindow>
  );
}
