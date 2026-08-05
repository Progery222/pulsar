import { useState, useEffect, useRef } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { mediaUrl, fileName } from '../utils/media';
import { FILTERS } from '../data/filters';

type Fx = {
  sharpen: number; noise: number; brightness: number; contrast: number; saturation: number;
  filter: string | null; zoom: number; offX: number; offY: number; volume: number;
};
const DEF_TOP: Fx = { sharpen: 0, noise: 0, brightness: 0, contrast: 0, saturation: 0, filter: null, zoom: 1, offX: 0, offY: 0, volume: 0 };
const DEF_BOT: Fx = { ...DEF_TOP, volume: 1 };

// mode: 'folder' — рандом из всей папки; 'file' — фиксированный конкретный файл.
type Cell = { folder: string | null; files: string[]; current: string | null; mode: 'folder' | 'file' };
const EMPTY: Cell = { folder: null, files: [], current: null, mode: 'folder' };

const COUNT_PRESETS = [5, 10, 15, 20, 25, 30, 50];
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

function cssFor(fx: Fx): string {
  const p = [
    `brightness(${(1 + fx.brightness).toFixed(3)})`,
    `contrast(${(1 + fx.contrast).toFixed(3)})`,
    `saturate(${(1 + fx.saturation).toFixed(3)})`,
  ];
  if (fx.filter) {
    const m = FILTERS.find((f) => f.key === fx.filter);
    if (m && m.css !== 'none') p.push(m.css);
  }
  return p.join(' ');
}
function frameStyle(fx: Fx): React.CSSProperties {
  const px = ((fx.offX + 1) / 2 * 100).toFixed(1) + '%';
  const py = ((fx.offY + 1) / 2 * 100).toFixed(1) + '%';
  return { objectFit: 'cover', objectPosition: `${px} ${py}`, transform: `scale(${fx.zoom})`, transformOrigin: `${px} ${py}` };
}

export default function SplitMergeApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [top, setTop] = useState<Cell>(EMPTY);
  const [bottom, setBottom] = useState<Cell>(EMPTY);
  const [topFx, setTopFx] = useState<Fx>(DEF_TOP);
  const [botFx, setBotFx] = useState<Fx>(DEF_BOT);
  const [duration, setDuration] = useState(10);
  const [durMode, setDurMode] = useState<'auto' | 'fixed'>('auto');
  const [hookCut, setHookCut] = useState(0); // 0 = целиком
  const [format, setFormat] = useState('9:16');
  const [count, setCount] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState(0);

  const setCell = (which: 'top' | 'bottom', c: Cell) => (which === 'top' ? setTop(c) : setBottom(c));
  const randomCurrent = (files: string[]) => (files.length ? files[Math.floor(Math.random() * files.length)] : null);

  async function pickFolder(which: 'top' | 'bottom') {
    const folder = await window.electronAPI.selectDirectory();
    if (!folder) return;
    const files = await window.electronAPI.splitScanFolder(folder);
    if (!files.length) { showToast('В папке нет видео (mp4/mov/…)'); return; }
    setCell(which, { folder, files, current: randomCurrent(files), mode: 'folder' });
  }

  async function pickFile(which: 'top' | 'bottom') {
    const paths = await window.electronAPI.selectVideos();
    if (!paths?.length) return;
    const file = paths[0];
    setCell(which, { folder: dirOf(file), files: [file], current: file, mode: 'file' });
  }

  function reshuffle(which: 'top' | 'bottom') {
    const cell = which === 'top' ? top : bottom;
    if (cell.mode !== 'folder' || cell.files.length < 2) return;
    setCell(which, { ...cell, current: randomCurrent(cell.files) });
  }

  async function exportVariations() {
    if (!top.current || !bottom.current) { showToast('Выберите источник для обеих ячеек (хук сверху, эмоция снизу)'); return; }
    const outputDir = await window.electronAPI.selectDirectory();
    if (!outputDir) return;
    setExporting(true);
    setPct(0);
    const off = window.electronAPI.onSplitProgress((ev) => { setStage(ev.stage); setPct(ev.percent); });
    try {
      const res = await window.electronAPI.splitGenerate({
        topFolder: top.folder || '', bottomFolder: bottom.folder || '',
        topFile: top.mode === 'file' ? top.current : null,
        bottomFile: bottom.mode === 'file' ? bottom.current : null,
        hookCut, duration, durationMode: durMode, format,
        variations: count, topFx, bottomFx: botFx, outputDir,
      });
      if ('error' in res) { showToast('Ошибка: ' + res.error); return; }
      showToast(`Готово: ${res.count} роликов`);
      window.electronAPI.openFolder(res.dir);
    } catch (e) {
      showToast('Ошибка: ' + (e as Error).message);
    } finally {
      off();
      setExporting(false);
    }
  }

  const aspect = format === '9:16' ? 9 / 16 : format === '1:1' ? 1 : 16 / 9;

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-primary)' }}>
      {/* Живое превью вертикали (2 ячейки) — WYSIWYG: эффекты + кадр применяются сразу */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, minWidth: 0 }}>
        <div style={{ height: '100%', maxHeight: 680, aspectRatio: String(aspect), display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
          <CellView cell={top} fx={topFx} which="top" label="Хук" onReshuffle={() => reshuffle('top')} onPickFolder={() => pickFolder('top')} onPickFile={() => pickFile('top')} />
          <CellView cell={bottom} fx={botFx} which="bottom" label="Эмоция" onReshuffle={() => reshuffle('bottom')} onPickFolder={() => pickFolder('bottom')} onPickFile={() => pickFile('bottom')} />
        </div>
      </div>

      {/* Настройки */}
      <div style={{ width: 330, borderLeft: '1px solid var(--border)', padding: 18, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Сплит-монтаж</h2>
        <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.4 }}>У каждой ячейки — 📁 вся папка (рандом) или 🎬 конкретный файл. Превью WYSIWYG.</p>

        <Sec title="Общее">
          <Row label="Длительность ролика">
            <select value={durMode} onChange={(e) => setDurMode(e.target.value as 'auto' | 'fixed')} style={sel}>
              <option value="auto">По видео эмоции (авто)</option>
              <option value="fixed">Фиксированная</option>
            </select>
          </Row>
          {durMode === 'fixed'
            ? <Row label={`Длительность ${duration}с`}><input type="range" min={4} max={60} step={1} value={duration} onChange={(e) => setDuration(+e.target.value)} style={{ width: '100%' }} /></Row>
            : <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '-4px 0 9px', lineHeight: 1.35 }}>Длина ролика = длине клипа эмоции; хуки заполняют её.</div>}
          <Row label="Длина хука сверху">
            <select value={hookCut} onChange={(e) => setHookCut(+e.target.value)} style={sel}>
              <option value={0}>Целиком (как в файле)</option>
              <option value={2}>Резать по 2с (больше хуков)</option>
              <option value={3}>Резать по 3с</option>
              <option value={4}>Резать по 4с</option>
              <option value={5}>Резать по 5с</option>
            </select>
          </Row>
          <Row label="Формат">
            <select value={format} onChange={(e) => setFormat(e.target.value)} style={sel}>
              <option value="9:16">9:16 (Reels/Shorts)</option>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
            </select>
          </Row>
        </Sec>

        <FxPanel title="Эффекты — Хук (верх)" fx={topFx} set={setTopFx} />
        <FxPanel title="Эффекты — Эмоция (низ)" fx={botFx} set={setBotFx} />

        <Sec title="Экспорт">
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>Количество уникальных роликов</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {COUNT_PRESETS.map((n) => (
              <button key={n} onClick={() => setCount(n)} style={{ ...chip, ...(count === n ? chipActive : null) }}>{n}</button>
            ))}
          </div>
          <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, +e.target.value || 1)))} style={sel} />
        </Sec>

        <div style={{ height: 6 }} />
        <button onClick={exportVariations} disabled={exporting || !top.current || !bottom.current} style={{ ...btnPrimary, width: '100%' }}>
          {exporting ? `${stage || 'Рендер'}… ${pct}%` : `Экспорт · ${count} шт`}
        </button>
        {exporting && <button onClick={() => window.electronAPI.splitCancel()} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>Отмена</button>}
        <button onClick={() => setAppMode('select')} disabled={exporting} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>На главную</button>
      </div>
    </div>
  );
}

// Ячейка превью: live-video; если кодек не проигрывается в Chromium (HEVC) — ffmpeg делает
// лёгкое H.264-превью (кэш в temp) и оно играет. До готовности — стоп-кадр из ffmpeg.
function CellView({ cell, fx, which, label, onReshuffle, onPickFolder, onPickFile }: {
  cell: Cell; fx: Fx; which: 'top' | 'bottom'; label: string;
  onReshuffle: () => void; onPickFolder: () => void; onPickFile: () => void;
}) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const [prev, setPrev] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const vidRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setNativeFailed(false);
    setPrev(null);
    setPoster(null);
    if (!cell.current) return;
    let alive = true;
    window.electronAPI.thumb(cell.current, 0.5).then((p) => { if (alive) setPoster(p); });
    const t = setTimeout(() => {
      const el = vidRef.current;
      if (alive && el && (el.readyState < 2 || el.videoWidth === 0)) setNativeFailed(true);
    }, 1600);
    return () => { alive = false; clearTimeout(t); };
  }, [cell.current]);

  useEffect(() => {
    if (!nativeFailed || !cell.current || prev) return;
    let alive = true;
    window.electronAPI.splitPreviewClip(cell.current).then((p) => { if (alive && p) setPrev(p); });
    return () => { alive = false; };
  }, [nativeFailed, cell.current, prev]);

  const fxStyle: React.CSSProperties = { width: '100%', height: '100%', display: 'block', filter: cssFor(fx), ...frameStyle(fx) };
  const transcoding = nativeFailed && !prev;
  const src = prev ? mediaUrl(prev) : mediaUrl(cell.current || '');
  const title = cell.current ? (cell.mode === 'file' ? '🎬 ' + fileName(cell.current) : fileName(cell.folder || '') + ' · ' + cell.files.length) : '';

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', overflow: 'hidden', borderBottom: which === 'top' ? '1px solid rgba(255,255,255,0.25)' : 'none' }}>
      {cell.current ? (
        <>
          {transcoding ? (
            <>
              {poster && <img src={mediaUrl(poster)} alt="" style={fxStyle} />}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11.5, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '4px 10px' }}>готовим превью…</span>
              </div>
            </>
          ) : (
            <video
              key={src}
              ref={vidRef}
              src={src}
              poster={poster ? mediaUrl(poster) : undefined}
              autoPlay muted loop playsInline
              onError={() => setNativeFailed(true)}
              style={fxStyle}
            />
          )}
          <div style={{ position: 'absolute', top: 6, left: 6, right: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10.5, color: '#fff', background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '2px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}: {title}{prev ? ' · превью' : ''}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {cell.mode === 'folder' && cell.files.length > 1 && <button onClick={onReshuffle} title="Другой рандомный клип" style={miniBtn}>🔀</button>}
              <button onClick={onPickFolder} title="Вся папка (рандом)" style={{ ...miniBtn, ...(cell.mode === 'folder' ? miniActive : null) }}>📁</button>
              <button onClick={onPickFile} title="Конкретный файл" style={{ ...miniBtn, ...(cell.mode === 'file' ? miniActive : null) }}>🎬</button>
            </div>
          </div>
        </>
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-secondary)' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, lineHeight: 1 }}>+</div>
          <div style={{ fontSize: 12.5 }}>{label}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onPickFolder} style={pickBtn}>📁 Папка</button>
            <button onClick={onPickFile} style={pickBtn}>🎬 Файл</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FxPanel({ title, fx, set }: { title: string; fx: Fx; set: (f: Fx) => void }) {
  const u = (patch: Partial<Fx>) => set({ ...fx, ...patch });
  return (
    <Sec title={title}>
      <Row label={`Кадр — зум ${fx.zoom.toFixed(2)}×`}><input type="range" min={1} max={2.5} step={0.05} value={fx.zoom} onChange={(e) => u({ zoom: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Кадр — сдвиг ↔ ${fx.offX.toFixed(2)}`}><input type="range" min={-1} max={1} step={0.05} value={fx.offX} onChange={(e) => u({ offX: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Кадр — сдвиг ↕ ${fx.offY.toFixed(2)}`}><input type="range" min={-1} max={1} step={0.05} value={fx.offY} onChange={(e) => u({ offY: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Громкость ${Math.round(fx.volume * 100)}%`}><input type="range" min={0} max={2} step={0.05} value={fx.volume} onChange={(e) => u({ volume: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Резкость ${fx.sharpen.toFixed(1)}`}><input type="range" min={0} max={2} step={0.1} value={fx.sharpen} onChange={(e) => u({ sharpen: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Шум ${fx.noise}`}><input type="range" min={0} max={40} step={1} value={fx.noise} onChange={(e) => u({ noise: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Яркость ${fx.brightness.toFixed(2)}`}><input type="range" min={-0.3} max={0.3} step={0.02} value={fx.brightness} onChange={(e) => u({ brightness: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Контраст ${fx.contrast.toFixed(2)}`}><input type="range" min={-0.5} max={0.5} step={0.02} value={fx.contrast} onChange={(e) => u({ contrast: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Насыщенность ${fx.saturation.toFixed(2)}`}><input type="range" min={-1} max={1} step={0.05} value={fx.saturation} onChange={(e) => u({ saturation: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label="Фильтр">
        <select value={fx.filter ?? ''} onChange={(e) => u({ filter: e.target.value || null })} style={sel}>
          <option value="">Нет</option>
          {FILTERS.filter((f) => f.key !== 'none').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </Row>
    </Sec>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

const sel: React.CSSProperties = { width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5 };
const miniBtn: React.CSSProperties = { fontSize: 12, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: 6, padding: '2px 7px', cursor: 'pointer' };
const miniActive: React.CSSProperties = { background: 'var(--accent-green)', color: '#04120c' };
const pickBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const chip: React.CSSProperties = { padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const chipActive: React.CSSProperties = { background: 'var(--accent-green)', color: '#04120c', borderColor: 'var(--accent-green)', fontWeight: 600 };
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
