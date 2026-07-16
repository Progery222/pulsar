import { useEffect, useRef, useState } from 'react';

// Окно заметок/сценария во время записи (?win=recNotes). Текст персистится в настройках,
// чтобы не терялся между сессиями и был доступен из редактора при желании.
export default function RecorderNotes() {
  const [text, setText] = useState('');
  const [scroll, setScroll] = useState(false);
  const [speed, setSpeed] = useState(1);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.electronAPI.getSetting('recorderNotes').then((v) => {
      if (typeof v === 'string') setText(v);
    });
  }, []);

  // Телепромптер: плавная автопрокрутка текста.
  useEffect(() => {
    if (!scroll) return;
    let raf = 0;
    let acc = 0;
    const step = () => {
      const el = areaRef.current;
      if (el) {
        acc += 0.35 * speed;
        if (acc >= 1) {
          el.scrollTop += Math.floor(acc);
          acc -= Math.floor(acc);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scroll, speed]);

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
        <span>Заметки / телепромптер</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setScroll((s) => !s)}
            title="Автопрокрутка (телепромптер)"
            style={{ WebkitAppRegion: 'no-drag', background: scroll ? '#ccff00' : 'rgba(255,255,255,0.12)', color: scroll ? '#04120c' : '#fff', border: 'none', borderRadius: 6, fontSize: 11, padding: '3px 8px', cursor: 'pointer' } as React.CSSProperties}
          >
            {scroll ? '❚❚' : '▶'}
          </button>
          <button
            onClick={() => window.electronAPI.recorderCloseNotes()}
            style={{ WebkitAppRegion: 'no-drag', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 16, cursor: 'pointer' } as React.CSSProperties}
          >
            ✕
          </button>
        </div>
      </div>
      {scroll && (
        <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Скорость</span>
          <input type="range" min={0.3} max={3} step={0.1} value={speed} onChange={(e) => setSpeed(+e.target.value)} style={{ flex: 1 }} />
        </div>
      )}
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Наберите сценарий — окно поверх экрана, не попадает в запись. ▶ включает автопрокрутку (телепромптер)…"
        style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: '#0d0d10', color: '#e8e8ea', fontSize: 15, lineHeight: 1.6, padding: 14 }}
      />
    </div>
  );
}
