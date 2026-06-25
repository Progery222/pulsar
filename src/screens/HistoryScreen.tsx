import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';

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
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Экран истории выполненных задач: открыть папку результата, повторить режим, удалить.
export default function HistoryScreen() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  async function reload() {
    const list = (await window.electronAPI.historyList()) as HistoryEntry[];
    setEntries(list);
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

  const btn: React.CSSProperties = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '80px 24px 48px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)' }}>
            История
          </h1>
          {entries.length > 0 && (
            <button onClick={clearAll} style={{ ...btn, color: 'var(--text-secondary)' }}>
              Очистить всё
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <p style={{ fontSize: 15, color: 'var(--text-secondary)' }}>
            Пока пусто. Завершённые задачи будут появляться здесь.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--accent-green)',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 6,
                        padding: '2px 8px',
                      }}
                    >
                      {MODE_LABEL[e.mode]}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.title}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {fmtDate(e.createdAt)} • файлов: {e.files.length}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {e.outputDir && (
                    <button onClick={() => window.electronAPI.openFolder(e.outputDir)} style={btn}>
                      Открыть папку
                    </button>
                  )}
                  <button onClick={() => setAppMode(e.mode)} style={btn}>
                    Повторить
                  </button>
                  <button onClick={() => remove(e.id)} style={{ ...btn, color: 'var(--danger)' }}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
