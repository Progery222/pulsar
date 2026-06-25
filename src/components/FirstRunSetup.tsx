import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';

interface Status {
  pythonOk: boolean;
  pythonVersion?: string;
  engines?: Record<string, boolean>;
  error?: string;
}

const ENGINE_INFO: { id: string; name: string; note: string }[] = [
  { id: 'gtts', name: 'Google TTS', note: 'Онлайн, бесплатно, без ключа, много языков (быстрая установка)' },
  { id: 'xtts', name: 'XTTS-v2', note: 'Многоязычный + клонирование (~1.8 ГБ)' },
  { id: 'silero', name: 'Silero', note: 'Русский/английский, лёгкий и быстрый' },
  { id: 'kokoro', name: 'Kokoro', note: 'Английский, очень быстрый' },
];

// Полоса прогресса: определённая (percent) или «бегущая» (indeterminate).
function ProgressBar({ percent }: { percent: number | null }) {
  return (
    <div style={{ position: 'relative', height: 8, background: 'var(--bg-tertiary)', borderRadius: 999, overflow: 'hidden' }}>
      {percent == null ? (
        <div className="bar-indeterminate" />
      ) : (
        <div style={{ height: '100%', width: `${Math.round(percent)}%`, background: 'var(--accent-green)', borderRadius: 999, transition: 'width 0.2s ease' }} />
      )}
    </div>
  );
}

// Мастер первого запуска: проверка системы и установка движков озвучки из приложения.
export default function FirstRunSetup() {
  const setShowSetup = useUIStore((s) => s.setShowSetup);
  const [status, setStatus] = useState<Status | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [pyInstalling, setPyInstalling] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function installPython() {
    setPyInstalling(true);
    setPercent(null);
    setLog([]);
    const r = await window.electronAPI.setupInstallPython();
    setPyInstalling(false);
    setPercent(null);
    if ('needsRestart' in r) setNeedsRestart(true);
    else {
      setLog((p) => [...p, `Ошибка: ${r.error}`]);
      refresh();
    }
  }

  async function refresh() {
    setStatus(await window.electronAPI.setupStatus());
  }
  useEffect(() => {
    refresh();
    const off = window.electronAPI.onSetupProgress((ev) => {
      if (typeof ev.percent === 'number') setPercent(ev.percent);
      if (ev.phase) setPhase(ev.phase);
      if (ev.line) setLog((prev) => [...prev.slice(-200), ev.line as string]);
    });
    return off;
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  async function install(engine: string) {
    setInstalling(engine);
    setPercent(null);
    setPhase('');
    setLog([]);
    const r = await window.electronAPI.setupInstall(engine);
    setInstalling(null);
    setPercent(null);
    if ('error' in r) setLog((p) => [...p, `Ошибка: ${r.error}`]);
    refresh();
  }

  async function finish() {
    await window.electronAPI.setSetting('firstRunDone', true);
    setShowSetup(false);
  }
  async function closeMinimized() {
    // Полностью убрать индикатор и больше не показывать мастер автоматически.
    await window.electronAPI.setSetting('firstRunDone', true);
    setShowSetup(false);
  }

  const busy = !!installing || pyInstalling;

  // ── Свёрнутый индикатор: компактная плашка внизу, работа продолжается ──
  if (minimized) {
    return (
      <div
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 2000, width: 320,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 14, boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            {installing ? `Установка ${installing}…` : pyInstalling ? 'Установка Python…' : 'Настройка движков'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setMinimized(false)} title="Развернуть" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}>
              ▢
            </button>
            <button onClick={closeMinimized} title="Закрыть" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}>
              ✕
            </button>
          </div>
        </div>
        <ProgressBar percent={installing || pyInstalling ? percent : 100} />
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {installing || pyInstalling
            ? `${percent != null ? Math.round(percent) + '% · ' : ''}${log[log.length - 1] ?? phase ?? 'Загрузка…'}`
            : 'Готово'}
        </div>
      </div>
    );
  }

  const card: React.CSSProperties = {
    background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div style={{ width: 600, maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 16, padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2 className="font-semibold" style={{ fontSize: 24, color: 'var(--accent-green)', marginBottom: 6 }}>
            Добро пожаловать в Pulsar
          </h2>
          <button
            onClick={() => setMinimized(true)}
            title="Свернуть"
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '4px 12px', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
          >
            —
          </button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Для озвучки нужен движок синтеза речи. Можно установить прямо сейчас или позже в «Настройках».
          Установку можно свернуть и продолжить работать.
        </p>

        {/* Статус Python */}
        <div style={{ ...card, marginBottom: 16, flexDirection: pyInstalling ? 'column' : 'row', alignItems: pyInstalling ? 'stretch' : 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%' }}>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>Python</div>
              <div style={{ fontSize: 12, color: status?.pythonOk ? 'var(--accent-green)' : 'var(--danger)' }}>
                {status === null ? 'Проверка…' : status.pythonOk ? `Найден ${status.pythonVersion ?? ''}` : 'Не найден — нужен для движков озвучки'}
              </div>
            </div>
            {needsRestart ? (
              <button onClick={() => window.electronAPI.relaunchApp()} className="btn-primary" style={{ padding: '7px 16px', fontSize: 13 }}>
                Перезапустить
              </button>
            ) : status?.pythonOk ? (
              <button onClick={refresh} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                Проверить
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button onClick={() => window.electronAPI.openPythonSite()} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                  python.org
                </button>
                <button onClick={installPython} disabled={pyInstalling} className="btn-primary" style={{ padding: '7px 16px', fontSize: 13, opacity: pyInstalling ? 0.5 : 1 }}>
                  {pyInstalling ? 'Установка…' : 'Скачать Python'}
                </button>
              </div>
            )}
          </div>
          {pyInstalling && (
            <div style={{ marginTop: 10 }}>
              <ProgressBar percent={percent} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                {log[log.length - 1] ?? 'Загрузка Python…'}
              </div>
            </div>
          )}
          {needsRestart && (
            <div style={{ fontSize: 11, color: 'var(--accent-green)', marginTop: 8 }}>
              Python установлен. Перезапустите приложение, чтобы он стал доступен.
            </div>
          )}
        </div>

        {/* Движки */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {ENGINE_INFO.map((e) => {
            const installed = status?.engines?.[e.id];
            const isInstalling = installing === e.id;
            return (
              <div key={e.id} style={{ ...card, flexDirection: isInstalling ? 'column' : 'row', alignItems: isInstalling ? 'stretch' : 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%' }}>
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
                      {isInstalling ? 'Установка…' : 'Скачать'}
                    </button>
                  )}
                </div>
                {isInstalling && (
                  <div style={{ marginTop: 10 }}>
                    <ProgressBar percent={percent} />
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                      {percent != null ? `${Math.round(percent)}%` : 'Подготовка…'}{phase ? ` · ${phase}` : ''}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Лог установки */}
        {log.length > 0 && (
          <div
            ref={logRef}
            style={{ maxHeight: 140, overflowY: 'auto', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', marginBottom: 16, whiteSpace: 'pre-wrap' }}
          >
            {log.join('\n')}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <button onClick={() => setMinimized(true)} disabled={!busy} style={{ background: 'none', border: '1px solid var(--border)', color: busy ? 'var(--text-primary)' : 'var(--text-secondary)', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer', opacity: busy ? 1 : 0.5 }}>
            Свернуть
          </button>
          <button onClick={finish} disabled={busy} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
            {status?.engines && Object.values(status.engines).some(Boolean) ? 'Готово' : 'Пропустить'}
          </button>
        </div>
      </div>
    </div>
  );
}
