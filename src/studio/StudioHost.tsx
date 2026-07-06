import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';

// Хост «Студии» — встроенный редактор (сборка кладётся в public/studio/).
// Грузится в iframe (свой WebGPU/WebCodecs-контекст, изолированно от нашего UI).
export default function StudioHost() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [ready, setReady] = useState<null | boolean>(null);

  useEffect(() => {
    let alive = true;
    fetch('studio/index.html', { method: 'HEAD' })
      .then((r) => alive && setReady(r.ok))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, []);

  if (ready === false) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'var(--bg-primary)', color: 'var(--text-primary)', padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Студия ещё не собрана</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: 520, lineHeight: 1.5 }}>
          Модуль редактора подключается отдельной сборкой (кладётся в <code>public/studio/</code>). Как соберём — плитка откроет его здесь.
        </div>
        <button onClick={() => setAppMode('select')} style={{ marginTop: 8, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13 }}>← На главную</button>
      </div>
    );
  }
  if (ready === null) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: 13 }}>Загрузка Студии…</div>;
  }
  return (
    <iframe
      src="studio/index.html"
      title="Студия"
      allow="camera; microphone; clipboard-read; clipboard-write; fullscreen"
      style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#0b0b0b' }}
    />
  );
}
