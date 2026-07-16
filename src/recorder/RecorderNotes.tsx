import { useEffect, useRef, useState } from 'react';

// Окно заметок/сценария во время записи (?win=recNotes). Текст персистится в настройках,
// чтобы не терялся между сессиями и был доступен из редактора при желании.
export default function RecorderNotes() {
  const [text, setText] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.electronAPI.getSetting('recorderNotes').then((v) => {
      if (typeof v === 'string') setText(v);
    });
  }, []);

  function onChange(v: string) {
    setText(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => window.electronAPI.setSetting('recorderNotes', v), 400);
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d10', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{ WebkitAppRegion: 'drag', padding: '10px 14px', fontSize: 13, fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties}
      >
        <span>Заметки / сценарий</span>
        <button
          onClick={() => window.electronAPI.recorderCloseNotes()}
          style={{ WebkitAppRegion: 'no-drag', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 16, cursor: 'pointer' } as React.CSSProperties}
        >
          ✕
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Наберите пункты сценария — окно поверх экрана и не попадает в запись…"
        style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: '#0d0d10', color: '#e8e8ea', fontSize: 14, lineHeight: 1.5, padding: 14 }}
      />
    </div>
  );
}
