import { useEffect, useState } from 'react';
import { CHANGELOG, entriesSince, type ChangelogEntry } from '../data/changelog';

// Окно «Что нового». Показывается один раз после обновления: сравниваем версию
// приложения с последней показанной. Если пропущено несколько релизов — покажем
// их все сразу, чтобы изменения не потерялись.

const KEY = 'pulsar.lastSeenVersion';

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // хранилище недоступно — покажем окно, это не страшно
  }
}

function writeLastSeen(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch { /* не записалось — окно появится ещё раз, но ничего не сломается */ }
}

export default function WhatsNew({ force, onClose }: { force?: boolean; onClose?: () => void } = {}) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI.appVersion().then((v) => {
      if (!alive) return;
      setVersion(v);
      if (force) {
        // Ручной вызов из настроек — показываем последний релиз.
        setEntries(CHANGELOG.slice(0, 1));
        return;
      }
      const last = readLastSeen();
      if (last === v) return; // эту версию уже показывали
      const list = entriesSince(last, v);
      // Версия без записи в списке (например, промежуточный хотфикс) — просто
      // запоминаем её и молчим, окно ни о чём не сообщит.
      if (!list.length) {
        writeLastSeen(v);
        return;
      }
      setEntries(list);
    });
    return () => { alive = false; };
  }, [force]);

  function close() {
    if (version) writeLastSeen(version);
    setEntries(null);
    onClose?.();
  }

  if (!entries || entries.length === 0) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 16,
          overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--accent-green)', fontWeight: 600 }}>
            Обновление установлено
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 6 }}>
            Pulsar {version}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>
            {entries.length > 1
              ? `Накопилось обновлений: ${entries.length}`
              : entries[0].title}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 24px 8px' }}>
          {entries.map((entry, ei) => (
            <div key={entry.version} style={{ paddingTop: ei === 0 ? 16 : 20 }}>
              {entries.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{entry.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{entry.version} · {entry.date}</span>
                </div>
              )}
              {entry.items.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                  <div
                    style={{
                      width: 34, height: 34, flexShrink: 0, borderRadius: 9, display: 'grid', placeItems: 'center',
                      fontSize: 17, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                    }}
                  >
                    {item.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {item.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Полный список — в настройках, «Что нового»
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={close}
            style={{
              padding: '9px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'var(--accent-green)', color: 'var(--accent-fg)', fontSize: 13.5, fontWeight: 600,
            }}
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
