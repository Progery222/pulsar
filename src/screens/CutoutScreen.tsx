import { useCallback, useEffect, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';

type Status = 'idle' | 'processing' | 'done' | 'error';
type Tool = 'erase' | 'restore';

interface Item {
  id: string;
  name: string;
  file: File;
  srcUrl: string;
  status: Status;
  progress: number;
  progressLabel: string;
  error?: string;
}

const CHECKER =
  'repeating-conic-gradient(#2a2a2a 0% 25%, #1c1c1c 0% 50%) 50% / 20px 20px';

let idc = 0;
const uid = () => `it-${++idc}`;

export default function CutoutScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [feather, setFeather] = useState(2);
  const [outlineW, setOutlineW] = useState(6);
  const [outlineColor, setOutlineColor] = useState('#ffffff');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // Персистентные пиксели результата и оригинал по каждому item.
  const resMap = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const origMap = useRef<Map<string, HTMLImageElement>>(new Map());

  const sel = items.find((i) => i.id === selId) || null;
  const patch = (id: string, p: Partial<Item>) =>
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const fitZoom = useCallback((iw: number, ih: number) => {
    const wrap = wrapRef.current;
    if (!wrap || !iw || !ih) return 1;
    const z = Math.min((wrap.clientWidth - 24) / iw, (wrap.clientHeight - 24) / ih, 1);
    return isFinite(z) && z > 0 ? z : 1;
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const next: Item[] = imgs.map((file) => {
      const id = uid();
      const srcUrl = URL.createObjectURL(file);
      const oimg = new Image();
      oimg.onload = () => origMap.current.set(id, oimg);
      oimg.src = srcUrl;
      return { id, name: file.name, file, srcUrl, status: 'idle', progress: 0, progressLabel: '' };
    });
    setItems((arr) => [...arr, ...next]);
    setSelId((cur) => cur ?? next[0].id);
  }, []);

  // Показать в холсте выбранный item.
  const showItem = useCallback(
    (id: string | null) => {
      const c = canvasRef.current;
      if (!c) return;
      const res = id ? resMap.current.get(id) : null;
      if (res) {
        c.width = res.width;
        c.height = res.height;
        c.getContext('2d')!.drawImage(res, 0, 0);
        setZoom(fitZoom(res.width, res.height));
      }
    },
    [fitZoom],
  );

  useEffect(() => {
    if (sel && sel.status === 'done') showItem(sel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, sel?.status]);

  // Сохранить пиксели холста в item.
  const syncToItem = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !selId) return;
    let res = resMap.current.get(selId);
    if (!res || res.width !== c.width || res.height !== c.height) {
      res = document.createElement('canvas');
      res.width = c.width;
      res.height = c.height;
      resMap.current.set(selId, res);
    }
    const rctx = res.getContext('2d')!;
    rctx.clearRect(0, 0, res.width, res.height);
    rctx.drawImage(c, 0, 0);
  }, [selId]);

  const processItem = useCallback(
    async (item: Item) => {
      patch(item.id, { status: 'processing', progress: 0, error: undefined });
      try {
        const blob = await removeBackground(item.file, {
          progress: (key, cur, total) => {
            const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
            patch(item.id, {
              progress: pct,
              progressLabel: key.startsWith('fetch') ? `Модель… ${pct}%` : `Обработка… ${pct}%`,
            });
          },
          output: { format: 'image/png' },
        });
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const res = document.createElement('canvas');
            res.width = img.naturalWidth;
            res.height = img.naturalHeight;
            res.getContext('2d')!.drawImage(img, 0, 0);
            resMap.current.set(item.id, res);
            patch(item.id, { status: 'done', progress: 100 });
            resolve();
          };
          img.src = URL.createObjectURL(blob);
        });
      } catch (e) {
        patch(item.id, { status: 'error', error: e instanceof Error ? e.message : 'Ошибка' });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const processAll = useCallback(async () => {
    setBatchRunning(true);
    const todo = items.filter((i) => i.status === 'idle' || i.status === 'error');
    for (const it of todo) {
      // eslint-disable-next-line no-await-in-loop
      await processItem(it);
    }
    setBatchRunning(false);
    // Обновить холст, если выбранный только что обработан.
    if (selId) showItem(selId);
  }, [items, processItem, selId, showItem]);

  // ── Инструменты рисования ──
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
        const o = selId ? origMap.current.get(selId) : null;
        if (o) ctx.drawImage(o, 0, 0, c.width, c.height);
      }
      ctx.restore();
    },
    [brush, tool, selId],
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
    if (sel?.status !== 'done') return;
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
      for (let d = step; d < dist; d += step) stamp(last.x + (dx * d) / dist, last.y + (dy * d) / dist);
    }
    stamp(p.x, p.y);
    lastRef.current = p;
  };
  const onUp = () => {
    if (paintingRef.current) syncToItem();
    paintingRef.current = false;
    lastRef.current = null;
  };

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
    syncToItem();
  }, [feather, syncToItem]);

  const applyOutline = useCallback(() => {
    const c = canvasRef.current;
    if (!c || outlineW <= 0) return;
    const w = c.width;
    const h = c.height;
    const ctx = c.getContext('2d')!;
    const top = document.createElement('canvas');
    top.width = w;
    top.height = h;
    top.getContext('2d')!.drawImage(c, 0, 0);
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(c, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = outlineColor;
    sctx.fillRect(0, 0, w, h);
    ctx.clearRect(0, 0, w, h);
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(a) * outlineW, Math.sin(a) * outlineW);
    }
    ctx.drawImage(top, 0, 0);
    syncToItem();
  }, [outlineW, outlineColor, syncToItem]);

  const downloadOne = useCallback((item: Item) => {
    const res = resMap.current.get(item.id);
    if (!res) return;
    res.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = item.name.replace(/\.[^.]+$/, '') || 'cutout';
      a.download = `${base}-no-bg.png`;
      a.click();
    }, 'image/png');
  }, []);

  const downloadAll = useCallback(async () => {
    for (const it of items.filter((i) => i.status === 'done')) {
      downloadOne(it);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 250));
    }
  }, [items, downloadOne]);

  const removeItem = (id: string) => {
    resMap.current.delete(id);
    origMap.current.delete(id);
    if (selId === id) {
      const remaining = items.filter((i) => i.id !== id);
      setSelId(remaining[0]?.id ?? null);
    }
    setItems((arr) => arr.filter((i) => i.id !== id));
  };

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
  }, [selId]);

  const cursorPx = brush * zoom;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const pendingCount = items.filter((i) => i.status === 'idle' || i.status === 'error').length;

  return (
    <div className="screen-fade" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: 12, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Удаление фона</h1>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
          Пакетно: добавьте изображения, удалите фон у всех, затем правьте каждое отдельно. ИИ работает локально.
        </p>
      </div>

      {/* Верхняя панель пакета */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={() => inputRef.current?.click()} style={btn(true, false)}>+ Добавить изображения</button>
        <button onClick={processAll} disabled={batchRunning || pendingCount === 0} style={btn(false, batchRunning || pendingCount === 0)}>
          {batchRunning ? 'Обработка…' : `Удалить фон у всех (${pendingCount})`}
        </button>
        <button onClick={downloadAll} disabled={doneCount === 0} style={btn(false, doneCount === 0)}>Скачать все ({doneCount})</button>
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Лента миниатюр */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flexShrink: 0, paddingBottom: 4 }}>
          {items.map((it) => (
            <div key={it.id} onClick={() => setSelId(it.id)}
              style={{
                position: 'relative', width: 74, height: 74, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
                border: `2px solid ${selId === it.id ? 'var(--accent, #c8ff00)' : 'transparent'}`,
                background: CHECKER, overflow: 'hidden',
              }}>
              <img src={it.srcUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: it.status === 'done' ? 1 : 0.65 }} />
              <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 11 }}>
                {it.status === 'done' ? '✅' : it.status === 'processing' ? '⏳' : it.status === 'error' ? '⚠️' : ''}
              </span>
              {it.status === 'processing' && (
                <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 9, color: '#fff', textShadow: '0 0 3px #000' }}>{it.progress}%</span>
              )}
              <button onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                style={{ position: 'absolute', top: 0, right: 0, width: 18, height: 18, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer', fontSize: 11, lineHeight: '18px', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Панель редактирования выбранного */}
      {sel?.status === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary,#161616)', padding: 3, borderRadius: 9 }}>
            <ToolBtn active={tool === 'erase'} onClick={() => setTool('erase')}>🩹 Стереть</ToolBtn>
            <ToolBtn active={tool === 'restore'} onClick={() => setTool('restore')}>↩ Вернуть</ToolBtn>
          </div>
          <label style={lbl}>Кисть<input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(+e.target.value)} /><span style={num}>{brush}</span></label>
          <label style={lbl}>Зум<input type="range" min={0.1} max={6} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} /><span style={num}>{Math.round(zoom * 100)}%</span></label>
          <label style={lbl}>Растуш.<input type="range" min={0} max={12} value={feather} onChange={(e) => setFeather(+e.target.value)} /><span style={num}>{feather}</span></label>
          <button onClick={applyFeather} style={btn(false, false)}>Растушевать</button>
          <label style={lbl}>Обводка<input type="range" min={0} max={40} value={outlineW} onChange={(e) => setOutlineW(+e.target.value)} /><span style={num}>{outlineW}</span>
            <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} style={{ width: 26, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} /></label>
          <button onClick={applyOutline} style={btn(false, false)}>Обвести</button>
          <button onClick={() => sel && processItem(sel).then(() => showItem(sel.id))} style={btn(false, false)}>Заново ИИ</button>
          <button onClick={() => sel && downloadOne(sel)} style={btn(true, false)}>Скачать PNG</button>
        </div>
      )}

      {/* Холст */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, borderRadius: 12, border: '1px solid var(--border,#2a2a2a)', overflow: 'auto', background: CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {items.length === 0 && (
          <div style={{ color: 'var(--text-muted,#777)', fontSize: 14 }}>Добавьте изображения, чтобы начать</div>
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => { onUp(); setCursor(null); }}
          onPointerEnter={(e) => setCursor({ x: e.clientX, y: e.clientY })}
          style={{
            display: sel?.status === 'done' ? 'block' : 'none',
            width: canvasRef.current ? canvasRef.current.width * zoom : undefined,
            height: canvasRef.current ? canvasRef.current.height * zoom : undefined,
            cursor: 'none', imageRendering: zoom > 1.5 ? 'pixelated' : 'auto', touchAction: 'none', flexShrink: 0,
          }}
        />
        {sel && sel.status !== 'done' && items.length > 0 && (
          <div style={{ textAlign: 'center' }}>
            <img src={sel.srcUrl} alt="" style={{ maxWidth: '80%', maxHeight: '70%', objectFit: 'contain', opacity: 0.8 }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 10 }}>
              {sel.status === 'processing' ? sel.progressLabel || 'Обработка…' : sel.status === 'error' ? (sel.error || 'Ошибка') : 'Нажмите «Удалить фон у всех» или обработайте'}
            </div>
          </div>
        )}
      </div>

      {sel?.status === 'done' && cursor && (
        <div style={{
          position: 'fixed', left: cursor.x, top: cursor.y, width: cursorPx * 2, height: cursorPx * 2,
          marginLeft: -cursorPx, marginTop: -cursorPx, borderRadius: '50%',
          border: `1px solid ${tool === 'erase' ? '#ff5c5c' : '#c8ff00'}`,
          boxShadow: '0 0 0 1px rgba(0,0,0,.6)', pointerEvents: 'none', zIndex: 60,
        }} />
      )}
    </div>
  );
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer',
      background: active ? 'var(--accent, #c8ff00)' : 'transparent', color: active ? '#0a0a0a' : 'var(--text-secondary, #aaa)',
    }}>{children}</button>
  );
}

const lbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' };
const num: React.CSSProperties = { width: 40, textAlign: 'right' };

function btn(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '9px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: primary ? 'none' : '1px solid var(--border, #333)',
    background: primary ? 'var(--accent, #c8ff00)' : 'transparent',
    color: primary ? '#0a0a0a' : 'var(--text-primary, #eee)',
  };
}
