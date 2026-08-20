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
function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

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
  const [topMuted, setTopMuted] = useState(true);
  const [botMuted, setBotMuted] = useState(true);
  const [fxTab, setFxTab] = useState<'top' | 'bottom'>('top');
  const [duration, setDuration] = useState(10);
  const [durMode, setDurMode] = useState<'auto' | 'fixed'>('auto');
  const [hookCut, setHookCut] = useState(0);
  const [format, setFormat] = useState('9:16');
  const [count, setCount] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState(0);
  const [botDur, setBotDur] = useState(0);
  const [topSeq, setTopSeq] = useState<string[]>([]);

  const setCell = (which: 'top' | 'bottom', c: Cell) => (which === 'top' ? setTop(c) : setBottom(c));
  const randomCurrent = (files: string[]) => (files.length ? files[Math.floor(Math.random() * files.length)] : null);

  useEffect(() => {
    if (!bottom.current) { setBotDur(0); return; }
    let alive = true;
    window.electronAPI.splitProbeDur(bottom.current).then((d) => { if (alive) setBotDur(d || 0); });
    return () => { alive = false; };
  }, [bottom.current]);

  // Лента хуков для превью (как в итоговом ролике: N штук под длину эмоции / нарезку).
  useEffect(() => {
    let alive = true;
    (async () => {
      const pool = top.mode === 'file' ? (top.current ? [top.current] : []) : top.files;
      if (!pool.length) { if (alive) setTopSeq([]); return; }
      const D = durMode === 'fixed' ? duration : (botDur || duration || 10);
      const seq: string[] = [];
      if (hookCut > 0) {
        const n = Math.max(1, Math.min(20, Math.ceil(D / hookCut)));
        const sh = shuffle(pool);
        for (let i = 0; i < n; i++) seq.push(sh[i % sh.length]);
      } else {
        const sh = shuffle(pool);
        let sum = 0, i = 0, guard = 0;
        while (sum < D && guard < 40 && seq.length < 20) {
          const f = sh[i % sh.length]; i++; guard++;
          const d = (await window.electronAPI.splitProbeDur(f).catch(() => 0)) || 3;
          seq.push(f); sum += d;
        }
      }
      if (alive) setTopSeq(seq.length ? seq : (top.current ? [top.current] : []));
    })();
    return () => { alive = false; };
  }, [top.files, top.mode, top.current, hookCut, durMode, duration, botDur]);

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
  const fx = fxTab === 'top' ? topFx : botFx;
  const setFx = fxTab === 'top' ? setTopFx : setBotFx;
  const hasAny = !!(top.current || bottom.current);

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-primary)' }}>
      {/* Превью + звук-микс прямо под видео */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12, minWidth: 0 }}>
        <div style={{ height: '100%', maxHeight: 620, aspectRatio: String(aspect), display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
          <CellView cell={top} fx={topFx} muted={topMuted} which="top" label="Хук" sequence={topSeq} segDur={hookCut} onReshuffle={() => reshuffle('top')} onPickFolder={() => pickFolder('top')} onPickFile={() => pickFile('top')} />
          <CellView cell={bottom} fx={botFx} muted={botMuted} which="bottom" label="Эмоция" onReshuffle={() => reshuffle('bottom')} onPickFolder={() => pickFolder('bottom')} onPickFile={() => pickFile('bottom')} />
        </div>

        {hasAny && (
          <div style={{ width: '100%', maxWidth: 460, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Звук — микс (нажми 🔊 чтобы слышать)</div>
            <MixRow label="Хук" muted={topMuted} onMute={() => setTopMuted((m) => !m)} volume={topFx.volume} onVol={(v) => setTopFx({ ...topFx, volume: v })} />
            <MixRow label="Эмоция" muted={botMuted} onMute={() => setBotMuted((m) => !m)} volume={botFx.volume} onVol={(v) => setBotFx({ ...botFx, volume: v })} />
            <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.3 }}>Громкость влияет и на превью, и на экспорт. Если у эмоции нет звука — на экспорте автоматически берётся звук хука.</div>
          </div>
        )}
      </div>

      {/* Настройки — компактно */}
      <div style={{ width: 320, borderLeft: '1px solid var(--border)', padding: 18, overflowY: 'auto', background: 'var(--bg-secondary)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>Сплит-монтаж</h2>

        <Sec title="Общее">
          <Row label="Длительность ролика">
            <select value={durMode} onChange={(e) => setDurMode(e.target.value as 'auto' | 'fixed')} style={sel}>
              <option value="auto">По видео эмоции (авто)</option>
              <option value="fixed">Фиксированная</option>
            </select>
          </Row>
          {durMode === 'fixed' && <Row label={`Длительность ${duration}с`}><input type="range" min={4} max={60} step={1} value={duration} onChange={(e) => setDuration(+e.target.value)} style={{ width: '100%' }} /></Row>}
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

        <Sec title="Эффекты">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button onClick={() => setFxTab('top')} style={{ ...seg, ...(fxTab === 'top' ? segActive : null) }}>Хук (верх)</button>
            <button onClick={() => setFxTab('bottom')} style={{ ...seg, ...(fxTab === 'bottom' ? segActive : null) }}>Эмоция (низ)</button>
          </div>
          <FxRows fx={fx} set={setFx} />
        </Sec>

        <Sec title="Экспорт">
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>Количество уникальных роликов</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {COUNT_PRESETS.map((n) => (
              <button key={n} onClick={() => setCount(n)} style={{ ...chip, ...(count === n ? chipActive : null) }}>{n}</button>
            ))}
          </div>
          <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, +e.target.value || 1)))} style={sel} />
        </Sec>

        <button onClick={exportVariations} disabled={exporting || !top.current || !bottom.current} style={{ ...btnPrimary, width: '100%' }}>
          {exporting ? `${stage || 'Рендер'}… ${pct}%` : `Экспорт · ${count} шт`}
        </button>
        {exporting && <button onClick={() => window.electronAPI.splitCancel()} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>Отмена</button>}
        <button onClick={() => setAppMode('select')} disabled={exporting} style={{ ...btnSecondary, width: '100%', marginTop: 8 }}>На главную</button>
      </div>
    </div>
  );
}

function MixRow({ label, muted, onMute, volume, onVol }: { label: string; muted: boolean; onMute: () => void; volume: number; onVol: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <button onClick={onMute} title={muted ? 'Включить звук' : 'Выключить'} style={{ ...miniBtn, background: muted ? 'var(--bg-tertiary)' : 'var(--accent-green)', color: muted ? 'var(--text-primary)' : 'var(--accent-fg)', minWidth: 30 }}>{muted ? '🔇' : '🔊'}</button>
      <span style={{ width: 58, fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <input type="range" min={0} max={2} step={0.05} value={volume} onChange={(e) => onVol(+e.target.value)} style={{ flex: 1 }} />
      <span style={{ width: 42, textAlign: 'right', fontSize: 11.5, color: 'var(--text-secondary)' }}>{Math.round(volume * 100)}%</span>
    </div>
  );
}

// Ячейка превью: live-video; HEVC-кодек не тянет Chromium → ffmpeg делает H.264-превью (со звуком).
// sequence — лента хуков (верхняя ячейка): проигрывается по очереди, как в итоговом ролике.
function CellView({ cell, fx, muted, which, label, sequence, segDur, onReshuffle, onPickFolder, onPickFile }: {
  cell: Cell; fx: Fx; muted: boolean; which: 'top' | 'bottom'; label: string; sequence?: string[]; segDur?: number;
  onReshuffle: () => void; onPickFolder: () => void; onPickFile: () => void;
}) {
  const [nativeFailed, setNativeFailed] = useState(false);
  const [prev, setPrev] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [segIdx, setSegIdx] = useState(0);
  const vidRef = useRef<HTMLVideoElement>(null);

  const seq = sequence && sequence.length > 1 ? sequence : null;
  const seqKey = seq ? seq.join('|') : '';
  const active = seq ? seq[segIdx % seq.length] : cell.current;

  useEffect(() => { setSegIdx(0); }, [seqKey, cell.current]);

  useEffect(() => {
    setNativeFailed(false);
    setPrev(null);
    setPoster(null);
    if (!active) return;
    let alive = true;
    window.electronAPI.thumb(active, 0.5).then((p) => { if (alive) setPoster(p); });
    const t = setTimeout(() => {
      const el = vidRef.current;
      if (alive && el && (el.readyState < 2 || el.videoWidth === 0)) setNativeFailed(true);
    }, 1600);
    return () => { alive = false; clearTimeout(t); };
  }, [active]);

  useEffect(() => {
    if (!nativeFailed || !active || prev) return;
    let alive = true;
    window.electronAPI.splitPreviewClip(active).then((p) => { if (alive && p) setPrev(p); });
    return () => { alive = false; };
  }, [nativeFailed, active, prev]);

  const transcoding = nativeFailed && !prev;

  // Громкость превью = слайдеру ячейки (mute управляется извне).
  useEffect(() => {
    const el = vidRef.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, fx.volume));
  }, [fx.volume, active, prev, muted]);

  // Продвижение ленты хуков.
  useEffect(() => {
    if (!seq) return;
    const base = segDur && segDur > 0 ? segDur * 1000 : 3500;
    const wait = transcoding ? Math.max(base, 2600) : base;
    const t = setTimeout(() => setSegIdx((i) => (i + 1) % seq.length), wait);
    return () => clearTimeout(t);
  }, [seq, seqKey, segIdx, segDur, transcoding, prev]);

  const fxStyle: React.CSSProperties = { width: '100%', height: '100%', display: 'block', filter: cssFor(fx), ...frameStyle(fx) };
  const src = prev ? mediaUrl(prev) : mediaUrl(active || '');
  const loop = seq ? (segDur ?? 0) > 0 : true;
  const onEnded = () => { if (seq && !((segDur ?? 0) > 0)) setSegIdx((i) => (i + 1) % seq.length); };
  const title = cell.current
    ? (cell.mode === 'file' ? '🎬 ' + fileName(cell.current) : fileName(cell.folder || '') + ' · ' + cell.files.length + (seq ? ` · лента ${seq.length}` : ''))
    : '';

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
              autoPlay playsInline
              muted={muted}
              loop={loop}
              onEnded={onEnded}
              onCanPlay={(e) => { const el = e.currentTarget; el.volume = Math.min(1, Math.max(0, fx.volume)); if (el.paused) el.play().catch(() => {}); }}
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
          <div style={{ width: 44, height: 44, borderRadius: '50%', border: '2px solid var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, lineHeight: 1 }}>+</div>
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

function FxRows({ fx, set }: { fx: Fx; set: (f: Fx) => void }) {
  const u = (patch: Partial<Fx>) => set({ ...fx, ...patch });
  return (
    <>
      <Row label={`Кадр — зум ${fx.zoom.toFixed(2)}×`}><input type="range" min={1} max={2.5} step={0.05} value={fx.zoom} onChange={(e) => u({ zoom: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Кадр — сдвиг ↔ ${fx.offX.toFixed(2)}`}><input type="range" min={-1} max={1} step={0.05} value={fx.offX} onChange={(e) => u({ offX: +e.target.value })} style={{ width: '100%' }} /></Row>
      <Row label={`Кадр — сдвиг ↕ ${fx.offY.toFixed(2)}`}><input type="range" min={-1} max={1} step={0.05} value={fx.offY} onChange={(e) => u({ offY: +e.target.value })} style={{ width: '100%' }} /></Row>
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
    </>
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
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

const sel: React.CSSProperties = { width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5 };
const miniBtn: React.CSSProperties = { fontSize: 12, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' };
const miniActive: React.CSSProperties = { background: 'var(--accent-green)', color: 'var(--accent-fg)' };
const pickBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const chip: React.CSSProperties = { padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const chipActive: React.CSSProperties = { background: 'var(--accent-green)', color: 'var(--accent-fg)', borderColor: 'var(--accent-green)', fontWeight: 600 };
const seg: React.CSSProperties = { flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const segActive: React.CSSProperties = { background: 'var(--accent-green)', color: 'var(--accent-fg)', borderColor: 'var(--accent-green)', fontWeight: 600 };
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent-green)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
