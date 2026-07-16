import { useEffect, useState } from 'react';

// Плавающая панель управления записью (отдельное always-on-top окно, ?win=recControl).
// Кнопки шлют команды главному окну (там живёт MediaRecorder), таймер приходит оттуда же.
function fmt(sec: number) {
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RecorderControlBar() {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const off = window.electronAPI.onRecorderState((s) => {
      setElapsed(s.elapsed);
      setPaused(s.paused);
    });
    return off;
  }, []);

  return (
    <div
      style={{
        WebkitAppRegion: 'drag',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        background: 'rgba(18,18,20,0.92)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: paused ? '#f5a623' : '#ff3b30',
          boxShadow: paused ? 'none' : '0 0 0 0 rgba(255,59,48,0.6)',
          animation: paused ? 'none' : 'recPulse 1.4s infinite',
        }}
      />
      <span style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', minWidth: 44 }}>{fmt(elapsed)}</span>

      <div style={{ flex: 1 }} />

      <button
        title={paused ? 'Продолжить' : 'Пауза'}
        onClick={() => window.electronAPI.recorderControlAction(paused ? 'resume' : 'pause')}
        style={{ ...btn, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {paused ? '▶' : '❚❚'}
      </button>
      <button
        title="Остановить"
        onClick={() => window.electronAPI.recorderControlAction('stop')}
        style={{ ...btn, background: '#ff3b30', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span style={{ width: 12, height: 12, background: '#fff', borderRadius: 2, display: 'inline-block' }} />
      </button>

      <style>{`@keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(255,59,48,0.55)}70%{box-shadow:0 0 0 8px rgba(255,59,48,0)}100%{box-shadow:0 0 0 0 rgba(255,59,48,0)}}`}</style>
    </div>
  );
}

const btn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  borderRadius: 10,
  border: 'none',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
