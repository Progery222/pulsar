import { useQueueStore, type Job } from '../store/queueStore';
import { useUIStore } from '../store/uiStore';
import FloatingWindow from './FloatingWindow';

const MODE_LABEL: Record<Job['mode'], string> = {
  editor: 'Монтаж',
  vub: 'Уникализатор',
  cleaner: 'Замена титров',
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'В очереди',
  detecting: 'Детект',
  processing: 'Обработка',
  done: 'Готово',
  error: 'Ошибка',
};

function statusColor(s: string): string {
  if (s === 'error') return 'var(--danger)';
  if (s === 'done') return 'var(--accent-green)';
  return 'var(--text-secondary)';
}

// Плавающее мини-окно «Очередь»: живой прогресс всех режимов.
export default function QueuePanel() {
  const jobs = useQueueStore((s) => s.jobs);
  const clearFinished = useQueueStore((s) => s.clearFinished);
  const setShowQueue = useUIStore((s) => s.setShowQueue);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'processing' || j.status === 'detecting').length;

  function cancelAll() {
    window.electronAPI.cancelVub();
    window.electronAPI.cancelCleaner();
    window.electronAPI.cancelRender();
  }

  const smallBtn: React.CSSProperties = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  };

  return (
    <FloatingWindow
      title={<>Очередь {active > 0 && <span style={{ color: 'var(--accent-green)' }}>({active})</span>}</>}
      onClose={() => setShowQueue(false)}
      initial={{ x: window.innerWidth - 492, y: 64 }}
    >
      {jobs.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          Очередь пуста. Запущенные задачи появятся здесь — прогресс сохраняется при переключении режимов.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {active > 0 && (
              <button onClick={cancelAll} style={{ ...smallBtn, color: 'var(--danger)' }}>
                Отменить всё
              </button>
            )}
            {jobs.some((j) => j.status === 'done' || j.status === 'error') && (
              <button onClick={clearFinished} style={{ ...smallBtn, color: 'var(--text-secondary)' }}>
                Очистить завершённые
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {jobs.map((j) => (
              <div key={j.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.name}
                  </span>
                  <span style={{ fontSize: 11, color: statusColor(j.status), flexShrink: 0 }}>
                    {MODE_LABEL[j.mode]} • {STATUS_LABEL[j.status] ?? j.status}
                  </span>
                </div>
                <div style={{ height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(j.percent)}%`, background: 'var(--accent-green)', transition: 'width 0.2s ease' }} />
                </div>
                {j.status === 'error' && j.error && (
                  <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>{j.error}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </FloatingWindow>
  );
}
