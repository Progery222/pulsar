import { useCallback, useEffect, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';

type Status = 'idle' | 'processing' | 'done' | 'error';
type Tool = 'erase' | 'restore';

const CHECKER =
  'repeating-conic-gradient(#2a2a2a 0% 25%, #1c1c1c 0% 50%) 50% / 20px 20px';

export default function CutoutScreen() {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(40);
  const [zoom, setZoom] = useState(1);

  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const origImgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Нужно изображение (PNG/JPG/WebP).');
      setStatus('error');
      return;
    }
    fileRef.current = file;
    setSrcUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    const img = new Image();
    img.onload = () => (origImgRef.current = img);
    img.src = URL.createObjectURL(file);
    setStatus('idle');
    setError('');
    setProgress(0);
    setZoom(1);
  }, []);

  const run = useCallback(async () => {
    const file = fileRef.current;
    if (!file) return;
    setStatus('processing');
    setError('');
    setProgress(0);
    try {
      const blob = await removeBackground(file, {
        progress: (key, current, total) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress(pct);
          setProgressLabel(
            key.startsWith('fetch') ? `Загрузка модели… ${pct}%` : `Обработка… ${pct}%`,
          );
        },
        output: { format: 'image/png' },
      });
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (!c) return;
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        setStatus('done');
        // Вписать по ширине контейнера примерно.
        setZoom(1);
      };
      img.src = URL.createObjectURL(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить фон');
      setStatus('error');
    }
  }, []);

  // Рисование кистью по холсту (в координатах изображения).
  const stamp = useCallback(
    (x: number, y: number) => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, brush, 0, Math.PI * 2);
      ctx.closePath();
      if (tool === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.fill();
      } else {
        ctx.clip();
        ctx.globalCompositeOperation = 'source-over';
        const o = origImgRef.current;
        if (o) ctx.drawImage(o, 0, 0, c.width, c.height);
      }
      ctx.restore();
    },
    [brush, tool],
  );

  const toImg = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (status !== 'done') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    paintingRef.current = true;
    const p = toImg(e);
    lastRef.current = p;
    stamp(p.x, p.y);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!paintingRef.current) return;
    const p = toImg(e);
    const last = lastRef.current;
    if (last) {
      // интерполяция вдоль штриха
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, brush / 3);
      for (let d = step; d < dist; d += step) {
        stamp(last.x + (dx * d) / dist, last.y + (dy * d) / dist);
      }
    }
    stamp(p.x, p.y);
    lastRef.current = p;
  };
  const onUp = () => {
    paintingRef.current = false;
    lastRef.current = null;
  };

  const download = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = fileRef.current?.name.replace(/\.[^.]+$/, '') || 'cutout';
      a.download = `${base}-no-bg.png`;
      a.click();
    }, 'image/png');
  }, []);

  // Зум колесом (Ctrl/Alt) над холстом.
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.altKey)) return;
      e.preventDefault();
      setZoom((z) => Math.min(6, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status]);

  return (
    <div
      className="screen-fade"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', gap: 16, overflow: 'hidden' }}
    >
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>Удаление фона</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          ИИ вырезает фон локально. Первый запуск скачивает модель (~40 МБ), дальше — из кэша. Доводите результат кистями.
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: '1.5px dashed var(--border, #333)', borderRadius: 12, padding: srcUrl ? 8 : 36,
          textAlign: 'center', cursor: 'pointer', color: 'var(--text-secondary)', background: 'var(--bg-secondary, #141414)', flexShrink: 0,
        }}
      >
        {srcUrl ? 'Другое изображение — клик или перетащите' : 'Перетащите изображение сюда или нажмите, чтобы выбрать'}
        <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
      </div>

      {/* Панель инструментов */}
      {status === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary,#161616)', padding: 3, borderRadius: 9 }}>
            <ToolBtn active={tool === 'erase'} onClick={() => setTool('erase')}>🩹 Стереть</ToolBtn>
            <ToolBtn active={tool === 'restore'} onClick={() => setTool('restore')}>↩ Вернуть</ToolBtn>
          </div>
          <label style={lbl}>Кисть
            <input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(+e.target.value)} />
            <span style={{ width: 30, textAlign: 'right' }}>{brush}</span>
          </label>
          <label style={lbl}>Зум
            <input type="range" min={0.2} max={6} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
            <span style={{ width: 34, textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
          </label>
          <button onClick={run} style={btn(false, false)}>Заново ИИ</button>
        </div>
      )}

      {/* Холст */}
      {srcUrl && (
        <div style={{ flex: 1, minHeight: 0, borderRadius: 12, border: '1px solid var(--border,#2a2a2a)', overflow: 'auto', background: CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            style={{
              display: status === 'done' ? 'block' : 'none',
              width: canvasRef.current ? canvasRef.current.width * zoom : undefined,
              height: canvasRef.current ? canvasRef.current.height * zoom : undefined,
              cursor: 'crosshair',
              imageRendering: zoom > 1.5 ? 'pixelated' : 'auto',
              touchAction: 'none',
            }}
          />
          {status !== 'done' && (
            <img src={srcUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          )}
        </div>
      )}

      {status === 'processing' && (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary,#222)', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent, #c8ff00)', transition: 'width .2s' }} />
        </div>
      )}
      {status === 'processing' && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{progressLabel}</div>
      )}
      {error && <div style={{ color: '#ff6b6b', fontSize: 13, flexShrink: 0 }}>{error}</div>}

      {srcUrl && (
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          {status !== 'done' && (
            <button onClick={run} disabled={status === 'processing'} style={btn(true, status === 'processing')}>
              {status === 'processing' ? 'Обработка…' : 'Удалить фон'}
            </button>
          )}
          <button onClick={download} disabled={status !== 'done'} style={btn(status === 'done', status !== 'done')}>
            Скачать PNG
          </button>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer',
      background: active ? 'var(--accent, #c8ff00)' : 'transparent',
      color: active ? '#0a0a0a' : 'var(--text-secondary, #aaa)',
    }}>{children}</button>
  );
}

const lbl: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)',
};

function btn(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: primary ? 'none' : '1px solid var(--border, #333)',
    background: primary ? 'var(--accent, #c8ff00)' : 'transparent',
    color: primary ? '#0a0a0a' : 'var(--text-primary, #eee)',
  };
}
