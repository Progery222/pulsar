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
  const [feather, setFeather] = useState(2);
  const [outlineW, setOutlineW] = useState(6);
  const [outlineColor, setOutlineColor] = useState('#ffffff');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const origImgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const fitZoom = useCallback((iw: number, ih: number) => {
    const wrap = wrapRef.current;
    if (!wrap || !iw || !ih) return 1;
    const z = Math.min((wrap.clientWidth - 24) / iw, (wrap.clientHeight - 24) / ih, 1);
    return isFinite(z) && z > 0 ? z : 1;
  }, []);

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
        setZoom(fitZoom(img.naturalWidth, img.naturalHeight));
      };
      img.src = URL.createObjectURL(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить фон');
      setStatus('error');
    }
  }, [fitZoom]);

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
    setCursor({ x: e.clientX, y: e.clientY });
    if (!paintingRef.current) return;
    const p = toImg(e);
    const last = lastRef.current;
    if (last) {
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

  // Растушевать края (лёгкое размытие всего кадра — мягкие границы без чёрного ореола).
  const applyFeather = useCallback(() => {
    const c = canvasRef.current;
    if (!c || feather <= 0) return;
    const ctx = c.getContext('2d')!;
    const snap = document.createElement('canvas');
    snap.width = c.width;
    snap.height = c.height;
    snap.getContext('2d')!.drawImage(c, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(snap, 0, 0);
    ctx.filter = 'none';
  }, [feather]);

  // Обводка силуэта заданным цветом и толщиной.
  const applyOutline = useCallback(() => {
    const c = canvasRef.current;
    if (!c || outlineW <= 0) return;
    const w = c.width;
    const h = c.height;
    const ctx = c.getContext('2d')!;
    // Копия текущего результата.
    const top = document.createElement('canvas');
    top.width = w;
    top.height = h;
    top.getContext('2d')!.drawImage(c, 0, 0);
    // Силуэт в цвете обводки (по альфе текущего).
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(c, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = outlineColor;
    sctx.fillRect(0, 0, w, h);
    // Дилатация: рисуем силуэт по кругу смещений позади оригинала.
    ctx.clearRect(0, 0, w, h);
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(a) * outlineW, Math.sin(a) * outlineW);
    }
    ctx.drawImage(top, 0, 0);
  }, [outlineW, outlineColor]);

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

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.altKey)) return;
      e.preventDefault();
      setZoom((z) => Math.min(6, Math.max(0.1, z * (e.deltaY < 0 ? 1.1 : 0.9))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status]);

  const cursorPx = brush * zoom; // радиус кисти на экране

  return (
    <div
      className="screen-fade"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', gap: 14, overflow: 'hidden' }}
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

      {status === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary,#161616)', padding: 3, borderRadius: 9 }}>
            <ToolBtn active={tool === 'erase'} onClick={() => setTool('erase')}>🩹 Стереть</ToolBtn>
            <ToolBtn active={tool === 'restore'} onClick={() => setTool('restore')}>↩ Вернуть</ToolBtn>
          </div>
          <label style={lbl}>Кисть
            <input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(+e.target.value)} />
            <span style={num}>{brush}</span>
          </label>
          <label style={lbl}>Зум
            <input type="range" min={0.1} max={6} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
            <span style={num}>{Math.round(zoom * 100)}%</span>
          </label>
          <label style={lbl}>Растушёвка
            <input type="range" min={0} max={12} value={feather} onChange={(e) => setFeather(+e.target.value)} />
            <span style={num}>{feather}</span>
          </label>
          <button onClick={applyFeather} style={btn(false, false)}>Растушевать</button>
          <label style={lbl}>Обводка
            <input type="range" min={0} max={40} value={outlineW} onChange={(e) => setOutlineW(+e.target.value)} />
            <span style={num}>{outlineW}</span>
            <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)}
              style={{ width: 26, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          </label>
          <button onClick={applyOutline} style={btn(false, false)}>Обвести</button>
          <button onClick={run} style={btn(false, false)}>Заново ИИ</button>
        </div>
      )}

      {srcUrl && (
        <div
          ref={wrapRef}
          style={{ flex: 1, minHeight: 0, borderRadius: 12, border: '1px solid var(--border,#2a2a2a)', overflow: 'auto', background: CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => { onUp(); setCursor(null); }}
            onPointerEnter={(e) => setCursor({ x: e.clientX, y: e.clientY })}
            style={{
              display: status === 'done' ? 'block' : 'none',
              width: canvasRef.current ? canvasRef.current.width * zoom : undefined,
              height: canvasRef.current ? canvasRef.current.height * zoom : undefined,
              cursor: 'none',
              imageRendering: zoom > 1.5 ? 'pixelated' : 'auto',
              touchAction: 'none',
              flexShrink: 0,
            }}
          />
          {status !== 'done' && (
            <img src={srcUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          )}
        </div>
      )}

      {/* Круг-курсор кисти (как в Photoshop) */}
      {status === 'done' && cursor && (
        <div
          style={{
            position: 'fixed', left: cursor.x, top: cursor.y, width: cursorPx * 2, height: cursorPx * 2,
            marginLeft: -cursorPx, marginTop: -cursorPx, borderRadius: '50%',
            border: `1px solid ${tool === 'erase' ? '#ff5c5c' : '#c8ff00'}`,
            boxShadow: '0 0 0 1px rgba(0,0,0,.6)', pointerEvents: 'none', zIndex: 60,
          }}
        />
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
const num: React.CSSProperties = { width: 40, textAlign: 'right' };

function btn(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: primary ? 'none' : '1px solid var(--border, #333)',
    background: primary ? 'var(--accent, #c8ff00)' : 'transparent',
    color: primary ? '#0a0a0a' : 'var(--text-primary, #eee)',
  };
}
