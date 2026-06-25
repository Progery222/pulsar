import { useQueueStore, type Job } from '../store/queueStore';

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

// Единая очередь: показывает прогресс всех режимов, в т.ч. при переключении вкладок.
export default function QueueScreen() {
  const jobs = useQueueStore((s) => s.jobs);
  const clearFinished = useQueueStore((s) => s.clearFinished);

  function cancelAll() {
    window.electronAPI.cancelVub();
    window.electronAPI.cancelCleaner();
    window.electronAPI.cancelRender();
  }

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'processing' || j.status === 'detecting').length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '80px 24px 48px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)' }}>
            Очередь {active > 0 && <span style={{ color: 'var(--accent-green)' }}>({active})</span>}
          </h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {active > 0 && (
              <button
                onClick={cancelAll}
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
              >
                Отменить всё
              </button>
            )}
            {jobs.some((j) => j.status === 'done' || j.status === 'error') && (
              <button
                onClick={clearFinished}
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
              >
                Очистить завершённые
              </button>
            )}
          </div>
        </div>

        {jobs.length === 0 ? (
          <p style={{ fontSize: 15, color: 'var(--text-secondary)' }}>
            Очередь пуста. Запущенные задачи будут отображаться здесь — прогресс сохраняется при переключении режимов.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '8px 0', fontWeight: 600 }}>Задача</th>
                <th style={{ padding: '8px 0', fontWeight: 600, width: 130 }}>Режим</th>
                <th style={{ padding: '8px 0', fontWeight: 600, width: 110 }}>Статус</th>
                <th style={{ padding: '8px 0', fontWeight: 600, width: 180 }}>Прогресс</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 0', maxWidth: 260 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</div>
                    {j.status === 'error' && j.error && (
                      <div style={{ fontSize: 11, color: 'var(--danger)', whiteSpace: 'normal', marginTop: 2 }}>{j.error}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>{MODE_LABEL[j.mode]}</td>
                  <td style={{ padding: '8px 0', color: statusColor(j.status) }}>{STATUS_LABEL[j.status] ?? j.status}</td>
                  <td style={{ padding: '8px 0' }}>
                    <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round(j.percent)}%`, background: 'var(--accent-green)', transition: 'width 0.2s ease' }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
