import { useEffect, useState } from 'react';
import { useProStore } from '../store/proStore';
import { showToast } from '../store/toastStore';
import { ADJUST_FILTERS, ADJUST_LABEL, DEFAULT_CROP, DEFAULT_TRANSFORM, findPrevAdjacent, type AdjustFilter } from './proTypes';
import { fileName, isAudioFile, isVideoFile, mediaUrl } from '../utils/media';

// Длительность медиа через скрытый элемент.
function probeDuration(path: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(el.duration || 0);
    el.onerror = () => resolve(0);
    el.src = mediaUrl(path);
  });
}

// Добавить файл в проект: видео → конец первой V-дорожки, аудио → конец первой A.
async function addFileToProject(path: string) {
  const st = useProStore.getState();
  const kind = isVideoFile(path) ? 'video' : isAudioFile(path) ? 'audio' : null;
  if (!kind) {
    showToast('Формат не поддерживается');
    return;
  }
  const track = st.doc.tracks.find((t) => t.kind === kind && !t.isAdjustment);
  if (!track) {
    showToast(`Нет ${kind === 'video' ? 'видео' : 'аудио'}-дорожки`);
    return;
  }
  const dur = (await probeDuration(path, kind)) || 3;
  const end = st.doc.clips.filter((c) => c.trackId === track.id).reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);
  st.pushHistory();
  st.addClip({ trackId: track.id, sourceFile: path, timelineStart: end, duration: dur, inPoint: 0, sourceDuration: dur });
  showToast(`Добавлено на ${track.name}`);
}

// Левая панель (§2 ТЗ): Media (бин источников) / Inspector (параметры клипа).

export default function LeftPanel() {
  const [tab, setTab] = useState<'media' | 'inspector'>('inspector');
  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
        <TabBtn active={tab === 'media'} onClick={() => setTab('media')}>Media</TabBtn>
        <TabBtn active={tab === 'inspector'} onClick={() => setTab('inspector')}>Inspector</TabBtn>
      </div>
      <div className="flex flex-1 flex-col" style={{ minHeight: 0, overflow: 'auto' }}>
        {tab === 'media' ? <MediaTab /> : <InspectorTab />}
      </div>
    </div>
  );
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

function MediaTab() {
  const clips = useProStore((s) => s.doc.clips);
  const sources = Array.from(new Set(clips.map((c) => c.sourceFile).filter(Boolean)));
  const [dir, setDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.electronAPI.listDir(dir).then((r) => {
      if (!alive) return;
      setEntries(r.entries);
      setParent(r.parent);
      if (r.home) setHome(r.home);
    });
    return () => {
      alive = false;
    };
  }, [dir]);

  // Показываем папки и только медиа-файлы.
  const shown = entries.filter((e) => e.isDir || isVideoFile(e.path) || isAudioFile(e.path));

  const pickDialog = async () => {
    const paths = await window.electronAPI.selectVideos();
    for (const p of paths) await addFileToProject(p);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Источники проекта. */}
      {sources.length > 0 && (
        <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 6 }}>Источники проекта</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflow: 'auto' }}>
            {sources.map((src) => (
              <div key={src} title={src} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isVideoFile(src) ? '🎬' : '🎵'} {fileName(src)}</span>
                <button onClick={() => addFileToProject(src)} title="Добавить ещё раз" style={addBtn}>＋</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Файловый браузер. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setDir(parent)} disabled={!parent && dir === null} title="Вверх" style={{ ...addBtn, opacity: !parent && dir === null ? 0.4 : 1 }}>↑</button>
        <button onClick={() => setDir(home)} title="Домой" style={addBtn}>⌂</button>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{dir ?? 'Диски'}</span>
        <button onClick={pickDialog} title="Выбрать через диалог" style={addBtn}>📂</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
        {shown.map((e) => (
          <div
            key={e.path}
            onDoubleClick={() => (e.isDir ? setDir(e.path) : addFileToProject(e.path))}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 6, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer' }}
            title={e.isDir ? 'Двойной клик — открыть' : 'Двойной клик — добавить в проект'}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.isDir ? '📁' : isVideoFile(e.path) ? '🎬' : '🎵'} {e.name}
            </span>
            {!e.isDir && <button onClick={(ev) => { ev.stopPropagation(); addFileToProject(e.path); }} title="Добавить" style={addBtn}>＋</button>}
          </div>
        ))}
        {!shown.length && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>Пусто</div>}
      </div>
    </div>
  );
}

const addBtn: React.CSSProperties = {
  width: 24,
  height: 22,
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
  flex: '0 0 auto',
};

function InspectorTab() {
  const selected = useProStore((s) => s.selectedClipIds);
  const clips = useProStore((s) => s.doc.clips);
  const clip = clips.find((c) => selected.includes(c.id)) ?? null;
  const updateTransform = useProStore((s) => s.updateClipTransform);
  const updateCrop = useProStore((s) => s.updateClipCrop);
  const toggleLock = useProStore((s) => s.toggleClipLock);
  const setTransition = useProStore((s) => s.setClipTransition);
  const updateAdjust = useProStore((s) => s.updateClipAdjust);
  const push = useProStore((s) => s.pushHistory);

  if (!clip) return <Empty text="Выделите клип на таймлайне, чтобы редактировать его параметры." />;

  // Каждое изменение — отдельная точка истории (§6 ТЗ).
  const id = clip.id;
  const tx = (p: Parameters<typeof updateTransform>[1]) => { push(); updateTransform(id, p); };
  const cx = (p: Parameters<typeof updateCrop>[1]) => { push(); updateCrop(id, p); };
  const adj = (p: Parameters<typeof updateAdjust>[1]) => { push(); updateAdjust(id, p); };
  const setTr = (v: number | null) => { push(); setTransition(id, v); };
  const lock = () => { push(); toggleLock(id); };

  // Клип корректирующего слоя — свой набор параметров.
  if (clip.adjust) {
    const a = clip.adjust;
    return (
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Section title="Adjustment (корр. слой)">
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Фильтр</span>
            <select
              value={a.filter}
              onChange={(e) => adj({ filter: e.target.value as AdjustFilter })}
              style={{ width: 130, padding: '4px 6px', fontSize: 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}
            >
              {ADJUST_FILTERS.map((f) => (
                <option key={f} value={f}>{ADJUST_LABEL[f]}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Интенсивность</span>
            <input type="range" min={0} max={100} value={Math.round(a.intensity * 100)} onChange={(e) => adj({ intensity: Number(e.target.value) / 100 })} style={{ width: 130 }} />
          </label>
        </Section>
      </div>
    );
  }

  const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const cr = { ...DEFAULT_CROP, ...clip.crop };

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button
        onClick={lock}
        title="Закрепить клип — Auto-Cut не перезапишет его"
        style={{
          alignSelf: 'flex-start',
          fontSize: 12,
          padding: '4px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          color: clip.locked ? 'var(--bg-primary)' : 'var(--text-primary)',
          background: clip.locked ? 'var(--accent-green)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
        }}
      >
        {clip.locked ? '🔒 Закреплён' : '🔓 Закрепить'}
      </button>
      <Section title="Transform">
        <Row><NumField label="Position X" value={t.x} step={1} onChange={(v) => tx({ x: v })} /></Row>
        <Row><NumField label="Position Y" value={t.y} step={1} onChange={(v) => tx({ y: v })} /></Row>
        <Row><NumField label="Scale %" value={Math.round(t.scale * 100)} step={1} onChange={(v) => tx({ scale: Math.max(0.05, v / 100) })} /></Row>
        <Row><NumField label="Rotation°" value={Math.round(t.rotation)} step={1} onChange={(v) => tx({ rotation: v })} /></Row>
        <ResetBtn onClick={() => tx(DEFAULT_TRANSFORM)} />
      </Section>
      <Section title="Crop">
        <Row><NumField label="Top %" value={Math.round(cr.top * 100)} step={1} onChange={(v) => cx({ top: v / 100 })} /></Row>
        <Row><NumField label="Bottom %" value={Math.round(cr.bottom * 100)} step={1} onChange={(v) => cx({ bottom: v / 100 })} /></Row>
        <Row><NumField label="Left %" value={Math.round(cr.left * 100)} step={1} onChange={(v) => cx({ left: v / 100 })} /></Row>
        <Row><NumField label="Right %" value={Math.round(cr.right * 100)} step={1} onChange={(v) => cx({ right: v / 100 })} /></Row>
        <ResetBtn onClick={() => cx(DEFAULT_CROP)} />
      </Section>
      <Section title="Transition (crossfade)">
        {findPrevAdjacent(clips, clip) ? (
          <Row>
            <NumField label="Crossfade с" value={clip.transition?.duration ?? 0} step={0.1} onChange={(v) => setTr(v > 0 ? v : null)} />
          </Row>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Нужен смежный клип слева на той же дорожке.</div>
        )}
      </Section>
    </div>
  );
}

// ─── UI ──────────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 14px',
        fontSize: 13,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: active ? '2px solid var(--accent-green)' : '2px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function NumField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  // Скраб: тянуть за подпись мышью. Колёсико над полем — ±шаг.
  const onScrubDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startVal = value;
    const move = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / 3) * step;
      onChange(Number((startVal + delta).toFixed(4)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
      <span onPointerDown={onScrubDown} style={{ cursor: 'ew-resize', userSelect: 'none', flex: 1 }} title="Тянуть — менять значение">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        onWheel={(e) => { e.preventDefault(); onChange(Number((value + (e.deltaY < 0 ? step : -step)).toFixed(4))); }}
        style={{ width: 88, padding: '4px 6px', fontSize: 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}
      />
    </label>
  );
}

function ResetBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ marginTop: 4, alignSelf: 'flex-start', fontSize: 11.5, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
      Сбросить
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      {text}
    </div>
  );
}
