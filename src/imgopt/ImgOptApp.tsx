import { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { DEFAULT_SETTINGS, encode, extForFormat, renderCanvas, type CropPreset, type ImgFormat, type ImgSettings, type Rotate, type WmPos } from './process';

interface Item {
  id: string;
  name: string;
  file: File;
  bitmap: ImageBitmap;
  sw: number;
  sh: number;
  origSize: number;
  url: string;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
}

export default function ImgOptApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [items, setItems] = useState<Item[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [s, setS] = useState<ImgSettings>(DEFAULT_SETTINGS);
  const [lockAspect, setLockAspect] = useState(true);
  const [compare, setCompare] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [procUrl, setProcUrl] = useState<string | null>(null);
  const [procSize, setProcSize] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sel = useMemo(() => items.find((i) => i.id === selId) ?? null, [items, selId]);

  const set = (patch: Partial<ImgSettings>) => setS((p) => ({ ...p, ...patch }));

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!arr.length) return;
    const added: Item[] = [];
    for (const f of arr) {
      try {
        const bitmap = await createImageBitmap(f);
        added.push({ id: `${f.name}-${f.size}-${Math.round(bitmap.width)}-${added.length}-${Date.now()}`, name: f.name, file: f, bitmap, sw: bitmap.width, sh: bitmap.height, origSize: f.size, url: URL.createObjectURL(f) });
      } catch {
        /* пропускаем битый файл */
      }
    }
    if (!added.length) return;
    setItems((prev) => [...prev, ...added]);
    setSelId((cur) => cur ?? added[0].id);
    // Инициализируем поля размера от первого добавленного.
    setS((p) => (p.resizeW === 0 ? { ...p, resizeW: added[0].sw, resizeH: added[0].sh } : p));
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it) { URL.revokeObjectURL(it.url); it.bitmap.close(); }
      return prev.filter((x) => x.id !== id);
    });
    setSelId((cur) => (cur === id ? null : cur));
  }

  // Живое превью выбранного (debounce на кодирование).
  useEffect(() => {
    if (!sel) { setProcUrl(null); setProcSize(null); return; }
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(async () => {
      try {
        const canvas = renderCanvas(sel.bitmap, sel.sw, sel.sh, s);
        const blob = await encode(canvas, s);
        setProcUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        setProcSize(blob.size);
      } catch (e) {
        showToast('Ошибка обработки: ' + (e as Error).message);
      }
    }, 180);
    return () => { if (debTimer.current) clearTimeout(debTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, s]);

  async function saveOne(it: Item, dir: string) {
    const canvas = renderCanvas(it.bitmap, it.sw, it.sh, s);
    const blob = await encode(canvas, s);
    const base = it.name.replace(/\.[^.]+$/, '');
    const name = `${base}.${extForFormat(s.format)}`;
    const buf = await blob.arrayBuffer();
    return window.electronAPI.imgWriteFile(dir, name, buf);
  }

  async function saveSelected() {
    if (!sel) return;
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    setSaving('one');
    const res = await saveOne(sel, dir);
    setSaving(null);
    if ('error' in res) showToast('Ошибка: ' + res.error);
    else { showToast('Сохранено: ' + res.path); window.electronAPI.showItemInFolder(res.path); }
  }

  async function saveAll() {
    if (!items.length) return;
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      setSaving(`${i + 1}/${items.length}`);
      const res = await saveOne(items[i], dir);
      if (!('error' in res)) ok++;
    }
    setSaving(null);
    showToast(`Сохранено ${ok} из ${items.length} → ${dir}`);
    window.electronAPI.openFolder(dir);
  }

  // Синхронизация размеров при блокировке пропорций.
  function onResizeW(v: number) {
    if (lockAspect && sel) set({ resizeW: v, resizeH: Math.round(v * (sel.sh / sel.sw)) });
    else set({ resizeW: v });
  }
  function onResizeH(v: number) {
    if (lockAspect && sel) set({ resizeH: v, resizeW: Math.round(v * (sel.sw / sel.sh)) });
    else set({ resizeH: v });
  }

  const saved = sel && procSize != null ? sel.origSize - procSize : 0;

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-primary)' }}>
      {/* Список файлов */}
      <div style={{ width: 190, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ ...btnPrimary, textAlign: 'center', cursor: 'pointer' }}>
            + Добавить
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </label>
          {items.length > 0 && <button onClick={() => { items.forEach((it) => { URL.revokeObjectURL(it.url); it.bitmap.close(); }); setItems([]); setSelId(null); }} style={btnGhost}>Очистить</button>}
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}
        >
          {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: 20 }}>Перетащите изображения сюда</div>}
          {items.map((it) => (
            <div
              key={it.id}
              onClick={() => setSelId(it.id)}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, borderRadius: 8, cursor: 'pointer', marginBottom: 4, background: selId === it.id ? 'var(--bg-tertiary)' : 'transparent', border: `1px solid ${selId === it.id ? 'var(--accent-green)' : 'transparent'}` }}
            >
              <img src={it.url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, background: '#000' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{it.sw}×{it.sh} · {fmtSize(it.origSize)}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); removeItem(it.id); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Превью */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Изображения</h1>
          <div style={{ flex: 1 }} />
          {sel && (
            <label style={{ ...rowLabel, fontSize: 12.5 }}>
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Сравнить до/после
            </label>
          )}
          <button onClick={() => setAppMode('select')} style={btnGhost}>На главную</button>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'hidden', minHeight: 0 }}>
          {!sel && <div style={{ color: 'var(--text-secondary)' }}>Добавьте изображения слева</div>}
          {sel && !compare && procUrl && (
            <img src={procUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, background: '#0a0a0a' }} />
          )}
          {sel && compare && procUrl && (
            <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', display: 'inline-block' }}>
              <img src={sel.url} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
              <img src={procUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', clipPath: `inset(0 ${100 - splitPct}% 0 0)` }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${splitPct}%`, width: 2, background: 'var(--accent-green)' }} />
              <input type="range" min={0} max={100} value={splitPct} onChange={(e) => setSplitPct(+e.target.value)} style={{ position: 'absolute', bottom: 8, left: '10%', width: '80%' }} />
            </div>
          )}
        </div>

        {sel && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 16, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Ориг: {fmtSize(sel.origSize)}</span>
            <span>Итог: {procSize != null ? fmtSize(procSize) : '…'}</span>
            {procSize != null && <span style={{ color: saved >= 0 ? 'var(--accent-green)' : '#ff6b6b' }}>{saved >= 0 ? '−' : '+'}{fmtSize(Math.abs(saved))} ({sel.origSize ? Math.round((saved / sel.origSize) * 100) : 0}%)</span>}
          </div>
        )}
      </div>

      {/* Настройки */}
      <div style={{ width: 280, borderLeft: '1px solid var(--border)', overflowY: 'auto', padding: 16, background: 'var(--bg-secondary)' }}>
        <Sec title="Формат и качество">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['image/webp', 'image/jpeg', 'image/png'] as ImgFormat[]).map((f) => (
              <button key={f} onClick={() => set({ format: f })} style={{ ...chip, ...(s.format === f ? chipOn : {}) }}>{f.split('/')[1].toUpperCase()}</button>
            ))}
          </div>
          {s.format !== 'image/png' && <Slider label={`Качество ${Math.round(s.quality * 100)}%`} min={0.1} max={1} step={0.01} value={s.quality} onChange={(v) => set({ quality: v })} disabled={!!s.targetKB} />}
          <label style={{ ...rowLabel, marginTop: 4 }}>
            <input type="checkbox" checked={!!s.targetKB} onChange={(e) => set({ targetKB: e.target.checked ? 200 : null })} /> Цель по размеру
          </label>
          {s.targetKB != null && s.format !== 'image/png' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <input type="number" min={5} value={s.targetKB} onChange={(e) => set({ targetKB: Math.max(5, +e.target.value || 5) })} style={numInput} /> КБ
            </div>
          )}
        </Sec>

        <Sec title="Размер">
          <label style={{ ...rowLabel, marginBottom: 6 }}>
            <input type="checkbox" checked={s.resizeEnabled} onChange={(e) => set({ resizeEnabled: e.target.checked })} /> Изменить размер
          </label>
          {s.resizeEnabled && (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <input type="number" value={s.resizeW} onChange={(e) => onResizeW(+e.target.value || 0)} style={numInput} />
                <span style={{ color: 'var(--text-secondary)' }}>×</span>
                <input type="number" value={s.resizeH} onChange={(e) => onResizeH(+e.target.value || 0)} style={numInput} />
              </div>
              <label style={rowLabel}>
                <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} /> Сохранять пропорции
              </label>
            </>
          )}
        </Sec>

        <Sec title="Апскейл">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[2, 3, 4].map((f) => (
              <button
                key={f}
                onClick={() => sel && set({ resizeEnabled: true, resizeW: Math.round(sel.sw * f), resizeH: Math.round(sel.sh * f), sharpen: s.sharpen || 0.6 })}
                disabled={!sel}
                style={chip}
                title={`Увеличить в ${f} раза с резкостью`}
              >
                ×{f}
              </button>
            ))}
          </div>
          <Slider label={`Резкость ${s.sharpen.toFixed(2)}`} min={0} max={2} step={0.05} value={s.sharpen} onChange={(v) => set({ sharpen: v })} />
          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Интерполяция + шарпен (без AI-дорисовки деталей)</div>
        </Sec>

        <Sec title="Трансформ">
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={() => set({ rotate: ((s.rotate + 270) % 360) as Rotate })} style={chip}>⟲</button>
            <button onClick={() => set({ rotate: ((s.rotate + 90) % 360) as Rotate })} style={chip}>⟳</button>
            <button onClick={() => set({ flipH: !s.flipH })} style={{ ...chip, ...(s.flipH ? chipOn : {}) }}>⇋</button>
            <button onClick={() => set({ flipV: !s.flipV })} style={{ ...chip, ...(s.flipV ? chipOn : {}) }}>⇅</button>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['free', '1:1', '4:3', '16:9', '3:2', '9:16'] as CropPreset[]).map((c) => (
              <button key={c} onClick={() => set({ crop: c })} style={{ ...chip, fontSize: 10.5, padding: '5px 7px', ...(s.crop === c ? chipOn : {}) }}>{c === 'free' ? 'Свободно' : c}</button>
            ))}
          </div>
        </Sec>

        <Sec title="Фильтры">
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => set({ grayscale: !s.grayscale })} style={{ ...chip, ...(s.grayscale ? chipOn : {}) }}>Ч/Б</button>
            <button onClick={() => set({ sepia: !s.sepia })} style={{ ...chip, ...(s.sepia ? chipOn : {}) }}>Сепия</button>
            <button onClick={() => set({ invert: !s.invert })} style={{ ...chip, ...(s.invert ? chipOn : {}) }}>Инверт</button>
          </div>
          <Slider label={`Яркость ${s.brightness}%`} min={0} max={200} step={1} value={s.brightness} onChange={(v) => set({ brightness: v })} />
          <Slider label={`Контраст ${s.contrast}%`} min={0} max={200} step={1} value={s.contrast} onChange={(v) => set({ contrast: v })} />
          <Slider label={`Насыщенность ${s.saturate}%`} min={0} max={200} step={1} value={s.saturate} onChange={(v) => set({ saturate: v })} />
          <Slider label={`Размытие ${s.blur}px`} min={0} max={20} step={0.5} value={s.blur} onChange={(v) => set({ blur: v })} />
        </Sec>

        <Sec title="Водяной знак">
          <input value={s.wmText} onChange={(e) => set({ wmText: e.target.value })} placeholder="Текст (пусто = выкл)" style={{ ...numInput, width: '100%', marginBottom: 6 }} />
          {s.wmText.trim() && (
            <>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                {(['tl', 'tr', 'center', 'bl', 'br'] as WmPos[]).map((p) => (
                  <button key={p} onClick={() => set({ wmPos: p })} style={{ ...chip, fontSize: 10, ...(s.wmPos === p ? chipOn : {}) }}>{p}</button>
                ))}
              </div>
              <Slider label={`Размер ${s.wmSize}%`} min={2} max={15} step={0.5} value={s.wmSize} onChange={(v) => set({ wmSize: v })} />
            </>
          )}
        </Sec>

        <div style={{ height: 8 }} />
        <button onClick={saveSelected} disabled={!sel || !!saving} style={{ ...btnPrimary, width: '100%' }}>
          {saving === 'one' ? 'Сохранение…' : 'Сохранить выбранное'}
        </button>
        <button onClick={saveAll} disabled={!items.length || !!saving} style={{ ...btnGhost, width: '100%', marginTop: 8 }}>
          {saving && saving !== 'one' ? `Сохранение ${saving}` : `Сохранить все (${items.length})`}
        </button>
      </div>
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Slider({ label, min, max, step, value, onChange, disabled }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div style={{ marginBottom: 8, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%' }} />
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: '9px 14px', borderRadius: 9, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const rowLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer' };
const chip: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer' };
const chipOn: React.CSSProperties = { borderColor: 'var(--accent-green)', color: 'var(--accent-green)' };
const numInput: React.CSSProperties = { width: 70, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12 };
