import { useCallback, useEffect, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';

type Status = 'idle' | 'processing' | 'done' | 'error';
type Tool = 'erase' | 'restore';

interface Params {
  feather: number;
  outlineW: number;
  outlineColor: string;
}
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
const DEF_PARAMS: Params = { feather: 0, outlineW: 0, outlineColor: '#ffffff' };

let idc = 0;
const uid = () => `it-${++idc}`;

// Отрисовать вырез (base) в target с растушёвкой краёв и обводкой (недеструктивно).
function renderInto(target: HTMLCanvasElement, base: HTMLCanvasElement, p: Params) {
  const w = base.width;
  const h = base.height;
  target.width = w;
  target.height = h;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  // Обводка: цветной силуэт по альфе, «раздутый» смещениями по кругу, позади.
  if (p.outlineW > 0) {
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d')!;
    sctx.drawImage(base, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = p.outlineColor;
    sctx.fillRect(0, 0, w, h);
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(a) * p.outlineW, Math.sin(a) * p.outlineW);
    }
  }

  // Вырез с растушёвкой края (лёгкое размытие бледит цвет субъекта в кромку — без чёрного ореола).
  if (p.feather > 0) {
    ctx.filter = `blur(${p.feather}px)`;
    ctx.drawImage(base, 0, 0);
    ctx.filter = 'none';
  } else {
    ctx.drawImage(base, 0, 0);
  }
}

export default function CutoutScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('erase');
  const [brush, setBrush] = useState(40);
  const [zoom, setZoom] = useState(1);
  const [ui, setUi] = useState<Params>(DEF_PARAMS); // параметры выбранного (для слайдеров)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropModeRef = useRef(false);
  const cropRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  cropModeRef.current = cropMode;
  cropRectRef.current = cropRect;
  const cropDragRef = useRef<{ x: number; y: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const baseMap = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const origMap = useRef<Map<string, CanvasImageSource>>(new Map());
  const paramMap = useRef<Map<string, Params>>(new Map());

  const sel = items.find((i) => i.id === selId) || null;
  const patch = (id: string, p: Partial<Item>) =>
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const fitZoom = useCallback((iw: number, ih: number) => {
    const wrap = wrapRef.current;
    if (!wrap || !iw || !ih) return 1;
    const z = Math.min((wrap.clientWidth - 24) / iw, (wrap.clientHeight - 24) / ih, 1);
    return isFinite(z) && z > 0 ? z : 1;
  }, []);

  // Собрать видимый холст из base выбранного + его параметры.
  const composite = useCallback((id: string | null, override?: Partial<Params>) => {
    const c = canvasRef.current;
    if (!c || !id) return;
    const base = baseMap.current.get(id);
    if (!base) return;
    const p = { ...(paramMap.current.get(id) || DEF_PARAMS), ...override };
    renderInto(c, base, p);
    // Оверлей кадрирования (не деструктивно).
    if (cropModeRef.current && cropRectRef.current) {
      const r = cropRectRef.current;
      const ctx = c.getContext('2d')!;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      // затемнение вне рамки
      ctx.fillRect(0, 0, c.width, r.y);
      ctx.fillRect(0, r.y + r.h, c.width, c.height - r.y - r.h);
      ctx.fillRect(0, r.y, r.x, r.h);
      ctx.fillRect(r.x + r.w, r.y, c.width - r.x - r.w, r.h);
      ctx.strokeStyle = '#c8ff00';
      ctx.lineWidth = Math.max(1, 2 / zoom);
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }, [zoom]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const next: Item[] = imgs.map((file) => {
      const id = uid();
      const srcUrl = URL.createObjectURL(file);
      const oimg = new Image();
      oimg.onload = () => origMap.current.set(id, oimg);
      oimg.src = srcUrl;
      paramMap.current.set(id, { ...DEF_PARAMS });
      return { id, name: file.name, file, srcUrl, status: 'idle', progress: 0, progressLabel: '' };
    });
    setItems((arr) => [...arr, ...next]);
    setSelId((cur) => cur ?? next[0].id);
  }, []);

  const processItem = useCallback(async (item: Item) => {
    patch(item.id, { status: 'processing', progress: 0, error: undefined });
    try {
      const blob = await removeBackground(item.file, {
        progress: (key, cur, total) => {
          const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
          patch(item.id, { progress: pct, progressLabel: key.startsWith('fetch') ? `Модель… ${pct}%` : `Обработка… ${pct}%` });
        },
        output: { format: 'image/png' },
      });
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const base = document.createElement('canvas');
          base.width = img.naturalWidth;
          base.height = img.naturalHeight;
          base.getContext('2d')!.drawImage(img, 0, 0);
          baseMap.current.set(item.id, base);
          patch(item.id, { status: 'done', progress: 100 });
          resolve();
        };
        img.src = URL.createObjectURL(blob);
      });
    } catch (e) {
      patch(item.id, { status: 'error', error: e instanceof Error ? e.message : 'Ошибка' });
    }
  }, []);

  const processAll = useCallback(async () => {
    setBatchRunning(true);
    const todo = items.filter((i) => i.status === 'idle' || i.status === 'error');
    for (const it of todo) {
      // eslint-disable-next-line no-await-in-loop
      await processItem(it);
    }
    setBatchRunning(false);
  }, [items, processItem]);

  // При выборе / завершении обработки — показать вырез и подгрузить его параметры.
  useEffect(() => {
    if (sel && sel.status === 'done' && baseMap.current.has(sel.id)) {
      const p = paramMap.current.get(sel.id) || DEF_PARAMS;
      setUi(p);
      composite(sel.id);
      const base = baseMap.current.get(sel.id)!;
      setZoom(fitZoom(base.width, base.height));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, sel?.status]);

  // Слайдеры растушёвки/обводки — живое обновление.
  const setParam = (patchP: Partial<Params>) => {
    if (!selId) return;
    const cur = paramMap.current.get(selId) || DEF_PARAMS;
    const np = { ...cur, ...patchP };
    paramMap.current.set(selId, np);
    setUi(np);
    composite(selId, patchP);
  };

  // ── Кисти ──
  const stamp = useCallback((x: number, y: number) => {
    const c = canvasRef.current;
    const base = selId ? baseMap.current.get(selId) : null;
    if (!c || !base) return;
    // Рисуем и в base (истина), и в видимый холст (мгновенная отдача).
    for (const ctx of [base.getContext('2d')!, c.getContext('2d')!]) {
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
        if (o) ctx.drawImage(o, 0, 0, base.width, base.height);
      }
      ctx.restore();
    }
  }, [brush, tool, selId]);

  const toImg = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const clampRect = (r: { x: number; y: number; w: number; h: number }) => {
    const c = canvasRef.current!;
    const x = Math.max(0, Math.min(r.x, c.width));
    const y = Math.max(0, Math.min(r.y, c.height));
    return { x, y, w: Math.min(r.w, c.width - x), h: Math.min(r.h, c.height - y) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (sel?.status !== 'done') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (cropMode) {
      const p = toImg(e);
      cropDragRef.current = { x: p.x, y: p.y };
      cropRectRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
      composite(selId);
      return;
    }
    paintingRef.current = true;
    const p = toImg(e);
    lastRef.current = p;
    stamp(p.x, p.y);
  };
  const onMove = (e: React.PointerEvent) => {
    setCursor({ x: e.clientX, y: e.clientY });
    if (cropMode) {
      if (!cropDragRef.current) return;
      const p = toImg(e);
      const s = cropDragRef.current;
      cropRectRef.current = clampRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
      composite(selId);
      return;
    }
    if (!paintingRef.current) return;
    const p = toImg(e);
    const last = lastRef.current;
    if (last) {
      const dx = p.x - last.x, dy = p.y - last.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, brush / 3);
      for (let d = step; d < dist; d += step) stamp(last.x + (dx * d) / dist, last.y + (dy * d) / dist);
    }
    stamp(p.x, p.y);
    lastRef.current = p;
  };
  const onUp = () => {
    if (cropMode) {
      cropDragRef.current = null;
      if (cropRectRef.current) setCropRect(cropRectRef.current);
      return;
    }
    if (paintingRef.current) composite(selId);
    paintingRef.current = false;
    lastRef.current = null;
  };

  const applyCrop = () => {
    const r = cropRectRef.current;
    if (!selId || !r || r.w < 4 || r.h < 4) return;
    const rx = Math.round(r.x), ry = Math.round(r.y), rw = Math.round(r.w), rh = Math.round(r.h);
    const base = baseMap.current.get(selId);
    if (!base) return;
    // Обрезать вырез.
    const nb = document.createElement('canvas');
    nb.width = rw;
    nb.height = rh;
    nb.getContext('2d')!.drawImage(base, rx, ry, rw, rh, 0, 0, rw, rh);
    baseMap.current.set(selId, nb);
    // Обрезать оригинал (для кисти «Вернуть»).
    const o = origMap.current.get(selId);
    if (o) {
      const no = document.createElement('canvas');
      no.width = rw;
      no.height = rh;
      no.getContext('2d')!.drawImage(o, rx, ry, rw, rh, 0, 0, rw, rh);
      origMap.current.set(selId, no);
    }
    setCropMode(false);
    setCropRect(null);
    cropRectRef.current = null;
    composite(selId);
    setZoom(fitZoom(rw, rh));
  };

  const downloadOne = useCallback((item: Item) => {
    const base = baseMap.current.get(item.id);
    if (!base) return;
    const out = document.createElement('canvas');
    renderInto(out, base, paramMap.current.get(item.id) || DEF_PARAMS);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${item.name.replace(/\.[^.]+$/, '') || 'cutout'}-no-bg.png`;
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
    baseMap.current.delete(id);
    origMap.current.delete(id);
    paramMap.current.delete(id);
    if (selId === id) setSelId(items.filter((i) => i.id !== id)[0]?.id ?? null);
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
          Пакетно: добавьте изображения, удалите фон у всех, правьте каждое отдельно. Растушёвка и обводка — вживую.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={() => inputRef.current?.click()} style={btn(true, false)}>+ Добавить изображения</button>
        <button onClick={processAll} disabled={batchRunning || pendingCount === 0} style={btn(false, batchRunning || pendingCount === 0)}>
          {batchRunning ? 'Обработка…' : `Удалить фон у всех (${pendingCount})`}
        </button>
        <button onClick={downloadAll} disabled={doneCount === 0} style={btn(false, doneCount === 0)}>Скачать все ({doneCount})</button>
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {sel?.status === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary,#161616)', padding: 3, borderRadius: 9 }}>
            <ToolBtn active={tool === 'erase'} onClick={() => setTool('erase')}>🩹 Стереть</ToolBtn>
            <ToolBtn active={tool === 'restore'} onClick={() => setTool('restore')}>↩ Вернуть</ToolBtn>
          </div>
          <label style={lbl}>Кисть<input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(+e.target.value)} /><span style={num}>{brush}</span></label>
          <label style={lbl}>Зум<input type="range" min={0.1} max={6} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} /><span style={num}>{Math.round(zoom * 100)}%</span></label>
          <label style={lbl}>Растушёвка<input type="range" min={0} max={12} step={0.5} value={ui.feather} onChange={(e) => setParam({ feather: +e.target.value })} /><span style={num}>{ui.feather}</span></label>
          <label style={lbl}>Обводка<input type="range" min={0} max={40} value={ui.outlineW} onChange={(e) => setParam({ outlineW: +e.target.value })} /><span style={num}>{ui.outlineW}</span>
            <input type="color" value={ui.outlineColor} onChange={(e) => setParam({ outlineColor: e.target.value })} style={{ width: 26, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} /></label>
          {!cropMode ? (
            <button onClick={() => {
              const base = selId ? baseMap.current.get(selId) : null;
              if (base) { const r = { x: 0, y: 0, w: base.width, h: base.height }; cropRectRef.current = r; setCropRect(r); }
              setCropMode(true);
              composite(selId);
            }} style={btn(false, false)}>✂ Кадрировать</button>
          ) : (
            <>
              <button onClick={applyCrop} style={btn(true, false)}>Применить кроп</button>
              <button onClick={() => { setCropMode(false); setCropRect(null); cropRectRef.current = null; composite(selId); }} style={btn(false, false)}>Отмена</button>
            </>
          )}
          <button onClick={() => sel && processItem(sel)} style={btn(false, false)}>Заново ИИ</button>
          <button onClick={() => sel && downloadOne(sel)} style={btn(true, false)}>Скачать PNG</button>
        </div>
      )}

      {/* Основная область: холст слева + лента миниатюр справа */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 10 }}>
        <div ref={wrapRef} style={{ flex: 1, minWidth: 0, borderRadius: 12, border: '1px solid var(--border,#2a2a2a)', overflow: 'auto', background: CHECKER, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {items.length === 0 && <div style={{ color: 'var(--text-muted,#777)', fontSize: 14 }}>Добавьте изображения, чтобы начать</div>}
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
              cursor: cropMode ? 'crosshair' : 'none', imageRendering: zoom > 1.5 ? 'pixelated' : 'auto', touchAction: 'none', flexShrink: 0,
            }}
          />
          {sel && sel.status !== 'done' && items.length > 0 && (
            <div style={{ textAlign: 'center' }}>
              <img src={sel.srcUrl} alt="" style={{ maxWidth: '80%', maxHeight: '70%', objectFit: 'contain', opacity: 0.8 }} />
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 10 }}>
                {sel.status === 'processing' ? sel.progressLabel || 'Обработка…' : sel.status === 'error' ? (sel.error || 'Ошибка') : 'Нажмите «Удалить фон у всех»'}
              </div>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ width: 100, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => (
              <div key={it.id} onClick={() => setSelId(it.id)}
                style={{
                  position: 'relative', width: 92, height: 92, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
                  border: `2px solid ${selId === it.id ? 'var(--accent, #c8ff00)' : 'transparent'}`, background: CHECKER, overflow: 'hidden',
                }}>
                <img src={it.srcUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: it.status === 'done' ? 1 : 0.6 }} />
                <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 12 }}>
                  {it.status === 'done' ? '✅' : it.status === 'processing' ? '⏳' : it.status === 'error' ? '⚠️' : ''}
                </span>
                {it.status === 'processing' && <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 10, color: '#fff', textShadow: '0 0 3px #000' }}>{it.progress}%</span>}
                <button onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                  style={{ position: 'absolute', top: 0, right: 0, width: 18, height: 18, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer', fontSize: 11, lineHeight: '18px', padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {sel?.status === 'done' && cursor && !cropMode && (
        <div style={{
          position: 'fixed', left: cursor.x, top: cursor.y, width: cursorPx * 2, height: cursorPx * 2,
          marginLeft: -cursorPx, marginTop: -cursorPx, borderRadius: '50%',
          border: `1px solid ${tool === 'erase' ? '#ff5c5c' : '#c8ff00'}`, boxShadow: '0 0 0 1px rgba(0,0,0,.6)', pointerEvents: 'none', zIndex: 60,
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
const num: React.CSSProperties = { width: 36, textAlign: 'right' };

function btn(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '9px 16px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: primary ? 'none' : '1px solid var(--border, #333)',
    background: primary ? 'var(--accent, #c8ff00)' : 'transparent',
    color: primary ? '#0a0a0a' : 'var(--text-primary, #eee)',
  };
}
