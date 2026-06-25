import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';

interface Status {
  pythonOk: boolean;
  pythonVersion?: string;
  engines?: Record<string, boolean>;
  error?: string;
}

const ENGINE_INFO: { id: string; name: string; note: string }[] = [
  { id: 'xtts', name: 'XTTS-v2', note: 'Многоязычный + клонирование (рекомендуется, ~1.8 ГБ)' },
  { id: 'silero', name: 'Silero', note: 'Русский/английский, лёгкий и быстрый' },
  { id: 'kokoro', name: 'Kokoro', note: 'Английский, очень быстрый' },
];

// Мастер первого запуска: проверка системы и установка движков озвучки из приложения.
export default function FirstRunSetup() {
  const setShowSetup = useUIStore((s) => s.setShowSetup);
  const [status, setStatus] = useState<Status | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setStatus(await window.electronAPI.setupStatus());
  }
  useEffect(() => {
    refresh();
    const off = window.electronAPI.onSetupProgress((line) =>
      setLog((prev) => [...prev.slice(-200), line])
    );
    return off;
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  async function install(engine: string) {
    setInstalling(engine);
    setLog([]);
    const r = await window.electronAPI.setupInstall(engine);
    setInstalling(null);
    if ('error' in r) setLog((p) => [...p, `Ошибка: ${r.error}`]);
    refresh();
  }

  async function finish() {
    await window.electronAPI.setSetting('firstRunDone', true);
    setShowSetup(false);
  }

  const card: React.CSSProperties = {
    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div style={{ width: 600, maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 16, padding: 28 }}>
        <h2 className="font-semibold" style={{ fontSize: 24, color: 'var(--accent-green)', marginBottom: 6 }}>
          Добро пожаловать в Pulsar
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Для озвучки нужен движок синтеза речи. Можно установить прямо сейчас или позже в «Настройках».
        </p>

        {/* Статус Python */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>Python</div>
            <div style={{ fontSize: 12, color: status?.pythonOk ? 'var(--accent-green)' : 'var(--danger)' }}>
              {status === null ? 'Проверка…' : status.pythonOk ? `Найден ${status.pythonVersion ?? ''}` : 'Не найден — установите Python 3.10+ с python.org'}
            </div>
          </div>
          <button onClick={refresh} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
            Проверить
          </button>
        </div>

        {/* Движки */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {ENGINE_INFO.map((e) => {
            const installed = status?.engines?.[e.id];
            return (
              <div key={e.id} style={card}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{e.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.note}</div>
                </div>
                {installed ? (
                  <span style={{ fontSize: 13, color: 'var(--accent-green)', flexShrink: 0 }}>Установлен ✓</span>
                ) : (
                  <button
                    onClick={() => install(e.id)}
                    disabled={!status?.pythonOk || !!installing}
                    className="btn-primary"
                    style={{ padding: '7px 16px', fontSize: 13, flexShrink: 0, opacity: !status?.pythonOk || installing ? 0.4 : 1 }}
                  >
                    {installing === e.id ? 'Установка…' : 'Скачать'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Лог установки */}
        {log.length > 0 && (
          <div
            ref={logRef}
            style={{ maxHeight: 160, overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', marginBottom: 16, whiteSpace: 'pre-wrap' }}
          >
            {log.join('\n')}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button onClick={finish} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
            {status?.engines && Object.values(status.engines).some(Boolean) ? 'Готово' : 'Пропустить'}
          </button>
        </div>
      </div>
    </div>
  );
}
