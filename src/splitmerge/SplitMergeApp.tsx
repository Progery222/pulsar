import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { mediaUrl, fileName } from '../utils/media';
import { FILTERS } from '../data/filters';

type Fx = { sharpen: number; noise: number; brightness: number; contrast: number; saturation: number; filter: string | null };
const DEF_FX: Fx = { sharpen: 0, noise: 0, brightness: 0, contrast: 0, saturation: 0, filter: null };

type Cell = { folder: string | null; files: string[]; preview: string | null; current: string | null };
const EMPTY: Cell = { folder: null, files: [], preview: null, current: null };

export default function SplitMergeApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [top, setTop] = useState<Cell>(EMPTY);
  const [bottom, setBottom] = useState<Cell>(EMPTY);
  const [topFx, setTopFx] = useState<Fx>(DEF_FX);
  const [botFx, setBotFx] = useState<Fx>(DEF_FX);
  const [duration, setDuration] = useState(10);
  const [format, setFormat] = useState('9:16');
  const [variations, setVariations] = useState(3);
  const [audio, setAudio] = useState<'bottom' | 'none'>('bottom');
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState(0);

  async function pickPreview(files: string[]): Promise<{ current: string | null; preview: string | null }> {
    if (!files.length) return { current: null, preview: null };
    const current = files[Math.floor(Math.random() * files.length)];
    const thumb = await window.electronAPI.thumb(current, 0.5);
    return { current, preview: thumb };
  }

  async function pickFolder(which: 'top' | 'bottom') {
    const folder = await window.electronAPI.selectDirectory();
    if (!folder) return;
    const files = await window.electronAPI.splitScanFolder(folder);
    if (!files.length) { showToast('В папке нет видео (mp4/mov/…)'); return; }
    const { current, preview } = await pickPreview(files);
    const cell: Cell = { folder, files, preview, current };
    if (which === 'top') setTop(cell); else setBottom(cell);
  }

  async function reshuffle(which: 'top' | 'bottom') {
    const cell = which === 'top' ? top : bottom;
    if (!cell.files.length) return;
    const { current, preview } = await pickPreview(cell.files);
    if (which === 'top') setTop({ ...cell, current, preview }); else setBottom({ ...cell, current, preview });
  }

  async function exportVariations() {
    if (!top.folder || !bottom.folder) { showToast('Выберите обе папки (хуки сверху, эмоции снизу)'); return; }
    const outputDir = await window.electronAPI.selectDirectory();
    if (!outputDir) return;
    setExporting(true);
    setPct(0);
    const off = window.electronAPI.onSplitProgress((ev) => { setStage(ev.stage); setPct(ev.percent); });
    try {
      const res = await window.electronAPI.splitGenerate({
        topFolder: top.folder, bottomFolder: bottom.folder, duration, format, variations, audio, topFx, bottomFx: botFx, outputDir,
      });
      if ('error' in res) { showToast('Ошибка: ' + res.error); return; }
      showToast(`Готово: ${res.count} вариаций`);
      window.electronAPI.openFolder(res.dir);
    } catch (e) {
      showToast('Ошибка: ' + (e as Error).message);
    } finally {
      off();
      setExporting(false);
    }
  }

  const aspect = format === '9:16' ? 9 / 16 : format === '1:1' ? 1 : 16 / 9;

  function CellView({ cell, which, label }: { cell: Cell; which: 'top' | 'bottom'; label: string }) {
    return (
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', overflow: 'hidden', borderBottom: which === 'top' ? '1px solid rgba(255,255,255,0.25)' : 'none' }}>
        {cell.preview ? (
          <>
            <img src={mediaUrl(cell.preview)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', top: 6, left: 6, right: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10.5, color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '2px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}: {fileName(cell.folder || '')} · {cell.files.length}
              </span>
              <button onClick={() => reshuffle(which)} title="Другой рандомный клип" style={{ fontSize: 12, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: 6, padding: '2px 7px', cursor: 'pointer' }}>🔀</button>
            </div>
            <button onClick={() => pickFolder(which)} style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', fontSize: 11, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>Сменить папку</button>
          </>
        ) : (
          <button onClick={() => pickFolder(which)} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, lineHeight: 1 }}>+</div>
            <div style={{ fontSize: 12.5 }}>{label} — выбрать папку</div>
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-primary)' }}>
      {/* Превью вертикали, поделённой на 2 ячейки */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, minWidth: 0 }}>
        <div style={{ height: '100%', maxHeight: 640, aspectRatio: String(aspect), display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
          <CellView cell={top} which="top" label="Хук" />
          <CellView cell={bottom} which="bottom" label="Эмоция" />
        </div>
      </div>

      {/* Настройки */}
      <div style={{ width: 320, borderLeft: '1px solid var(--border)', padding: 18, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Сплит-монтаж</h2>
        <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.4 }}>Верх — папка с хуками (2–4с, склеятся на всю длину). Низ — папка с эмоциями (по {duration}с).</p>

        <Sec title="Общее">
          <Row label={`Длительность ${duration}с`}><input type="range" min={4} max={60} step={1} value={duration} onChange={(e) => setDuration(+e.target.value)} style={{ width: '100%' }} /></Row>
          <Row label="Формат">
            <select value={format} onChange={(e) => setFormat(e.target.value)} style={sel}>
              <option value="9:16">9:16 (Reels/Shorts)</option>
              <option value="1:1">1:1</option>
              <option value="16:9">16:9</option>
            </select>
          </Row>
          <Row label="Звук">
            <select value={audio} onChange={(e) => setAudio(e.target.value as 'bottom' | 'none')} style={sel}>
              <option value="bottom">Из эмоции (низ)</option>
              <option value="none">Без звука</option>
            </select>
          </Row>
          <Row label={`Вариаций: ${variations}`}><input type="range" min={1} max={50} step={1} value={variations} onChange={(e) => setVariations(+e.target.value)} style={{ width: '100%' }} /></Row>
        </Sec>

        <FxPanel title="Эффекты — Хук (верх)" fx={topFx} set={setTopFx} />
        <FxPanel title="Эффекты — Эмоция (низ)" fx={botFx} set={setBotFx} />

        <div style={{ height: 14 }} />
        <button onClick={exportVariations} disabled={exporting || !top.folder || !bottom.folder} style={{ ...btnPrimary, width: '100%' }}>
          {exporting ? `${stage || 'Рендер'}… ${pct}%` : `Сделать ${variations} вариаций`}
        </button>
        {exporting && <button onClick={() => window.electronAPI.splitCancel()} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>Отмена</button>}
        <button onClick={() => setAppMode('select')} disabled={exporting} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>На главную</button>
      </div>
    </div>
  );
}

function FxPanel({ title, fx, set }: { title: string; fx: Fx; set: (f: Fx) => void }) {
  const u = (patch: Partial<Fx>) => set({ ...fx, ...patch });
  return (
    <Sec title={title}>
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
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
