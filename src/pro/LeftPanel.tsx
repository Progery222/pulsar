import { useEffect, useRef, useState } from 'react';
import { useProStore } from '../store/proStore';
import { showToast } from '../store/toastStore';
import { ADJUST_FILTERS, ADJUST_LABEL, BLEND_LABEL, BLEND_MODES, DEFAULT_AUDIO, DEFAULT_COLOR, DEFAULT_CROP, DEFAULT_TEXT, DEFAULT_TRANSFORM, findPrevAdjacent, KF_EASE_LABEL, KF_EASES, KF_PARAM_LABEL, KF_PARAMS, LOOK_PRESETS, TEXT_FONTS, TEXT_PRESETS, TRANSITION_ALIGN_LABEL, TRANSITION_ALIGNS, TRANSITION_KINDS, TRANSITION_LABEL, type AdjustFilter, type BlendMode, type KfEase, type KfParam, type ProClip, type TransitionAlign, type TransitionKind } from './proTypes';
import { fileName, isAudioFile, isVideoFile, mediaUrl } from '../utils/media';

// Метаданные медиа (длительность + размеры) через скрытый элемент.
function probeMeta(path: string, kind: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video') as HTMLVideoElement;
    el.preload = 'metadata';
    let done = false;
    const finish = (r: { duration: number; width: number; height: number }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      resolve(r);
    };
    el.onloadedmetadata = () => finish({ duration: el.duration || 0, width: el.videoWidth || 0, height: el.videoHeight || 0 });
    el.onerror = () => finish({ duration: 0, width: 0, height: 0 });
    const timer = setTimeout(() => finish({ duration: 0, width: 0, height: 0 }), 8000); // не зависаем на битом файле
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
  const meta = await probeMeta(path, kind);
  const dur = meta.duration || 3;
  const end = st.doc.clips.filter((c) => c.trackId === track.id).reduce((m, c) => Math.max(m, c.timelineStart + c.duration), 0);
  st.pushHistory();
  const linkId = kind === 'video' ? 'lk' + Math.random().toString(36).slice(2, 8) : undefined;
  st.addClip({ trackId: track.id, sourceFile: path, timelineStart: end, duration: dur, inPoint: 0, sourceDuration: dur, sourceW: meta.width || undefined, sourceH: meta.height || undefined, linkId });
  // Видео — связанное аудио на свободную аудио-дорожку (двигается вместе).
  if (kind === 'video') st.addLinkedAudio(path, end, dur, dur, linkId);
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
  const [sub, setSub] = useState<'browser' | 'sources'>('browser');
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
      {/* Подвкладки: проводник и источники проекта — каждая на всю высоту. */}
      <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid var(--border)' }}>
        <SubTab active={sub === 'browser'} onClick={() => setSub('browser')}>Проводник</SubTab>
        <SubTab active={sub === 'sources'} onClick={() => setSub('sources')}>Источники{sources.length ? ` (${sources.length})` : ''}</SubTab>
      </div>

      {sub === 'sources' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}>
          {sources.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {sources.map((src) => (
                <MediaTile key={src} path={src} name={fileName(src)} />
              ))}
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>Нет источников. Добавь медиа во вкладке «Проводник».</div>
          )}
        </div>
      ) : (
        <>
          {/* Файловый браузер. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => setDir(parent)} disabled={!parent && dir === null} title="Вверх" style={{ ...addBtn, opacity: !parent && dir === null ? 0.4 : 1 }}>↑</button>
            <button onClick={() => setDir(home)} title="Домой" style={addBtn}>⌂</button>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{dir ?? 'Диски'}</span>
            <button onClick={pickDialog} title="Выбрать через диалог" style={addBtn}>📂</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
            {/* Папки/диски — компактным списком. */}
            {shown.filter((e) => e.isDir).map((e) => (
              <div key={e.path} onDoubleClick={() => setDir(e.path)} onClick={() => setDir(e.path)} title="Открыть" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 5, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
                <span>📁</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
              </div>
            ))}
            {/* Файлы — превью-плитками с наведением (скраббинг кадра). */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 4 }}>
              {shown.filter((e) => !e.isDir).map((e) => (
                <MediaTile key={e.path} path={e.path} name={e.name} />
              ))}
            </div>
            {!shown.length && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>Пусто</div>}
          </div>
        </>
      )}
    </div>
  );
}

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ flex: 1, padding: '5px 8px', fontSize: 12, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)', color: active ? 'var(--bg-primary)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400 }}
    >
      {children}
    </button>
  );
}

// Плитка медиафайла: миниатюра + hover-скраббинг кадра, двойной клик — добавить.
function MediaTile({ path, name }: { path: string; name: string }) {
  const isVid = isVideoFile(path);
  const [thumb, setThumb] = useState<string | null>(null);
  const durRef = useRef(0);
  const lastBucket = useRef(-1);
  useEffect(() => {
    let alive = true;
    if (isVid) {
      window.electronAPI.thumb(path, 1).then((p) => alive && setThumb(p));
      probeMeta(path, 'video').then((m) => { durRef.current = m.duration; });
    }
    return () => { alive = false; };
  }, [path, isVid]);
  const onMove = (e: React.MouseEvent) => {
    if (!isVid || !durRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(durRef.current, ((e.clientX - r.left) / r.width) * durRef.current));
    const b = Math.round(t * 2);
    if (b !== lastBucket.current) {
      lastBucket.current = b;
      window.electronAPI.thumb(path, t).then((p) => p && setThumb(p));
    }
  };
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-pulsar-path', path); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => addFileToProject(path)}
      onMouseMove={onMove}
      title="Двойной клик или перетащи на таймлайн; наведи — превью кадра"
      style={{ cursor: 'grab', borderRadius: 6, overflow: 'hidden', background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
    >
      <div style={{ aspectRatio: '16 / 10', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
        {thumb ? <img src={mediaUrl(thumb)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : isVid ? '🎬' : '🎵'}
      </div>
      <div style={{ fontSize: 10.5, padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{name}</div>
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
  const updateAudio = useProStore((s) => s.updateClipAudio);
  const updateColor = useProStore((s) => s.updateClipColor);
  const updateText = useProStore((s) => s.updateClipText);
  const setBlend = useProStore((s) => s.setClipBlend);
  const setTransitionKind = useProStore((s) => s.setTransitionKind);
  const setTransAlign = useProStore((s) => s.setTransitionAlign);
  const setSpeed = useProStore((s) => s.setClipSpeed);
  const addKeyframe = useProStore((s) => s.addKeyframe);
  const removeKeyframe = useProStore((s) => s.removeKeyframe);
  const setKeyframeEase = useProStore((s) => s.setKeyframeEase);
  const clearKeyframes = useProStore((s) => s.clearKeyframes);
  const tracks = useProStore((s) => s.doc.tracks);
  const playhead = useProStore((s) => s.playhead);
  const setPlayhead = useProStore((s) => s.setPlayhead);
  const push = useProStore((s) => s.pushHistory);
  const sysFonts = useSystemFonts();

  if (!clip) return <Empty text="Выделите клип на таймлайне, чтобы редактировать его параметры." />;

  // Каждое изменение — отдельная точка истории (§6 ТЗ).
  const id = clip.id;
  const tx = (p: Parameters<typeof updateTransform>[1]) => { push(); updateTransform(id, p); };
  const cx = (p: Parameters<typeof updateCrop>[1]) => { push(); updateCrop(id, p); };
  const adj = (p: Parameters<typeof updateAdjust>[1]) => { push(); updateAdjust(id, p); };
  const au = (p: Parameters<typeof updateAudio>[1]) => { push(); updateAudio(id, p); };
  const col = (p: Parameters<typeof updateColor>[1]) => { push(); updateColor(id, p); };
  const txt = (p: Parameters<typeof updateText>[1]) => { push(); updateText(id, p); };
  const setTr = (v: number | null) => { push(); setTransition(id, v); };
  const spd = (v: number) => { push(); setSpeed(id, v); };
  const lock = () => { push(); toggleLock(id); };
  const track = tracks.find((t) => t.id === clip.trackId);

  // Аудио-клип — свой набор параметров.
  if (track?.kind === 'audio' && !clip.adjust) {
    const a = { ...DEFAULT_AUDIO, ...clip.audio };
    return (
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button onClick={lock} title="Закрепить клип" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', color: clip.locked ? 'var(--bg-primary)' : 'var(--text-primary)', background: clip.locked ? 'var(--accent-green)' : 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
          {clip.locked ? '🔒 Закреплён' : '🔓 Закрепить'}
        </button>
        <Section title="Аудио">
          <Row><NumField label="Громкость дБ" value={a.volumeDb} step={0.5} onChange={(v) => au({ volumeDb: v })} /></Row>
          <Row><NumField label="Питч (полутона)" value={a.pitch} step={0.5} onChange={(v) => au({ pitch: v })} /></Row>
          <Row><NumField label="Fade in, с" value={a.fadeIn} step={0.1} onChange={(v) => au({ fadeIn: Math.max(0, v) })} /></Row>
          <Row><NumField label="Fade out, с" value={a.fadeOut} step={0.1} onChange={(v) => au({ fadeOut: Math.max(0, v) })} /></Row>
          <Row><NumField label="Скорость ×" value={clip.speed ?? 1} step={0.1} onChange={(v) => spd(v)} /></Row>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={() => au({ pitch: 0.4, volumeDb: a.volumeDb - 0.3 })} title="Небольшой сдвиг тона/громкости для обхода аудио-фингерпринта" style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>Anti-Shazam</button>
            <button onClick={() => au(DEFAULT_AUDIO)} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Сбросить</button>
          </div>
        </Section>
        <Section title="Переход">
          {findPrevAdjacent(clips, clip) ? (
            <>
              <Row><NumField label="Длина, с" value={clip.transition?.duration ?? 0} step={0.1} onChange={(v) => setTr(v > 0 ? v : null)} /></Row>
              {clip.transition && <TransKindSelect id={id} value={clip.transition.kind ?? 'dissolve'} onPick={(k) => { push(); setTransitionKind(id, k); }} />}
              {clip.transition && <TransAlignSelect value={clip.transition.align ?? 'center'} onPick={(a) => { push(); setTransAlign(id, a); }} />}
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Нужен смежный клип слева.</div>
          )}
        </Section>
      </div>
    );
  }

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

  // Текстовый клип — редактор титра.
  if (clip.text) {
    const tt = { ...DEFAULT_TEXT, ...clip.text };
    const seg = (label: string, active: boolean, onClick: () => void) => (
      <button onClick={onClick} style={{ flex: 1, padding: '5px 4px', fontSize: 12, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)', color: active ? 'var(--bg-primary)' : 'var(--text-primary)' }}>{label}</button>
    );
    return (
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Section title="Текст / титр">
          <textarea
            value={tt.content}
            onChange={(e) => txt({ content: e.target.value })}
            rows={2}
            style={{ width: '100%', padding: '6px 8px', fontSize: 13, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', resize: 'vertical' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
            {TEXT_PRESETS.map((p) => (
              <button key={p.name} onClick={() => txt(p.text)} style={{ padding: '5px 4px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{p.name}</button>
            ))}
          </div>
        </Section>

        <Section title="Шрифт">
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Гарнитура</span>
            <select value={tt.font} onChange={(e) => txt({ font: e.target.value })} style={{ flex: 1, maxWidth: 160, padding: '4px 6px', fontSize: 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}>
              <optgroup label="Встроенные">
                {TEXT_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </optgroup>
              {sysFonts.length > 0 && (
                <optgroup label="Системные">
                  {sysFonts.map((f) => <option key={f} value={f}>{f}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 5 }}>
            {seg('Ж', !!tt.bold, () => txt({ bold: !tt.bold }))}
            {seg('К', !!tt.italic, () => txt({ italic: !tt.italic }))}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {seg('◧ Слева', tt.align === 'left', () => txt({ align: 'left' }))}
            {seg('▣ Центр', tt.align === 'center', () => txt({ align: 'center' }))}
            {seg('◨ Справа', tt.align === 'right', () => txt({ align: 'right' }))}
          </div>
          <Row><NumField label="Размер %" value={tt.size} step={0.5} onChange={(v) => txt({ size: Math.max(1, v) })} /></Row>
          <Row><NumField label="Трекинг" value={tt.letterSpacing ?? 0} step={0.1} onChange={(v) => txt({ letterSpacing: v })} /></Row>
          <Row><NumField label="Межстрочный ×" value={tt.lineHeight ?? 1.15} step={0.05} onChange={(v) => txt({ lineHeight: Math.max(0.5, v) })} /></Row>
        </Section>

        <Section title="Цвет и стиль">
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Цвет текста</span>
            <input type="color" value={tt.color} onChange={(e) => txt({ color: e.target.value })} style={{ width: 44, height: 24, background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }} />
          </label>
          <Row><NumField label="Прозрачность %" value={Math.round((tt.opacity ?? 1) * 100)} step={5} onChange={(v) => txt({ opacity: Math.max(0, Math.min(1, v / 100)) })} /></Row>
          <Row><NumField label="Обводка" value={tt.outline ?? 0} step={0.2} onChange={(v) => txt({ outline: Math.max(0, v) })} /></Row>
          {(tt.outline ?? 0) > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <span>Цвет обводки</span>
              <input type="color" value={tt.outlineColor} onChange={(e) => txt({ outlineColor: e.target.value })} style={{ width: 44, height: 24, background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }} />
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={!!tt.shadow} onChange={(e) => txt({ shadow: e.target.checked })} /> Тень
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={tt.bg} onChange={(e) => txt({ bg: e.target.checked })} /> Плашка-подложка
          </label>
          {tt.bg && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <span>Цвет плашки</span>
              <input type="color" value={tt.bgColor} onChange={(e) => txt({ bgColor: e.target.value })} style={{ width: 44, height: 24, background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }} />
            </label>
          )}
        </Section>

        <Section title="Позиция и анимация">
          <Row><NumField label="X %" value={Math.round(tt.x * 100)} step={1} onChange={(v) => txt({ x: v / 100 })} /></Row>
          <Row><NumField label="Y %" value={Math.round(tt.y * 100)} step={1} onChange={(v) => txt({ y: v / 100 })} /></Row>
          <Row><NumField label="Появление, с" value={tt.fadeIn ?? 0} step={0.1} onChange={(v) => txt({ fadeIn: Math.max(0, v) })} /></Row>
          <Row><NumField label="Исчезновение, с" value={tt.fadeOut ?? 0} step={0.1} onChange={(v) => txt({ fadeOut: Math.max(0, v) })} /></Row>
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
        <Row><NumField label="Position X" value={t.x} step={1} onChange={(v) => tx({ x: v })} /><KfBtn id={id} clip={clip} param="x" localSec={playhead - clip.timelineStart} add={addKeyframe} push={push} /></Row>
        <Row><NumField label="Position Y" value={t.y} step={1} onChange={(v) => tx({ y: v })} /><KfBtn id={id} clip={clip} param="y" localSec={playhead - clip.timelineStart} add={addKeyframe} push={push} /></Row>
        <Row><NumField label="Scale %" value={Math.round(t.scale * 100)} step={1} onChange={(v) => tx({ scale: Math.max(0.05, v / 100) })} /><KfBtn id={id} clip={clip} param="scale" localSec={playhead - clip.timelineStart} add={addKeyframe} push={push} /></Row>
        <Row><NumField label="Rotation°" value={Math.round(t.rotation)} step={1} onChange={(v) => tx({ rotation: v })} /><KfBtn id={id} clip={clip} param="rotation" localSec={playhead - clip.timelineStart} add={addKeyframe} push={push} /></Row>
        <ResetBtn onClick={() => tx(DEFAULT_TRANSFORM)} />
      </Section>
      <KeyframeEditor
        clip={clip}
        playhead={playhead}
        onSeek={(t2) => setPlayhead(clip.timelineStart + t2)}
        onRemove={(p, t2) => { push(); removeKeyframe(id, p, t2); }}
        onEase={(p, t2, e) => { push(); setKeyframeEase(id, p, t2, e); }}
        onClear={() => { push(); clearKeyframes(id); }}
      />
      <Section title="Скорость">
        <Row><NumField label="× (1 = норма)" value={clip.speed ?? 1} step={0.1} onChange={(v) => spd(v)} /></Row>
      </Section>
      <Section title="Crop">
        <Row><NumField label="Top %" value={Math.round(cr.top * 100)} step={1} onChange={(v) => cx({ top: v / 100 })} /></Row>
        <Row><NumField label="Bottom %" value={Math.round(cr.bottom * 100)} step={1} onChange={(v) => cx({ bottom: v / 100 })} /></Row>
        <Row><NumField label="Left %" value={Math.round(cr.left * 100)} step={1} onChange={(v) => cx({ left: v / 100 })} /></Row>
        <Row><NumField label="Right %" value={Math.round(cr.right * 100)} step={1} onChange={(v) => cx({ right: v / 100 })} /></Row>
        <ResetBtn onClick={() => cx(DEFAULT_CROP)} />
      </Section>
      <Section title="Луки (пресеты)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {LOOK_PRESETS.map((p) => (
            <button key={p.name} onClick={() => col(p.color)} style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, cursor: 'pointer', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Цвет">
        {(() => { const cc = { ...DEFAULT_COLOR, ...clip.color }; return (
          <>
            <Row><NumField label="Яркость" value={cc.brightness} step={1} onChange={(v) => col({ brightness: v })} /></Row>
            <Row><NumField label="Контраст" value={cc.contrast} step={1} onChange={(v) => col({ contrast: v })} /></Row>
            <Row><NumField label="Насыщенность" value={cc.saturation} step={1} onChange={(v) => col({ saturation: v })} /></Row>
            <Row><NumField label="Температура" value={cc.temperature} step={1} onChange={(v) => col({ temperature: v })} /></Row>
            <Row><NumField label="Оттенок°" value={cc.hue} step={1} onChange={(v) => col({ hue: v })} /></Row>
            <ResetBtn onClick={() => col(DEFAULT_COLOR)} />
          </>
        ); })()}
      </Section>
      <Section title="Наложение (в экспорте)">
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <span>Режим</span>
          <select value={clip.blend ?? 'normal'} onChange={(e) => { push(); setBlend(id, e.target.value as BlendMode); }} style={{ width: 130, padding: '4px 6px', fontSize: 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}>
            {BLEND_MODES.map((m) => <option key={m} value={m}>{BLEND_LABEL[m]}</option>)}
          </select>
        </label>
      </Section>
      <Section title="Переход">
        {findPrevAdjacent(clips, clip) && clip.transition && <TransKindSelect id={id} value={clip.transition.kind ?? 'dissolve'} onPick={(k) => { push(); setTransitionKind(id, k); }} />}
        {findPrevAdjacent(clips, clip) && clip.transition && <TransAlignSelect value={clip.transition.align ?? 'center'} onPick={(a) => { push(); setTransAlign(id, a); }} />}
        {findPrevAdjacent(clips, clip) ? (
          <Row>
            <NumField label="Длина, с" value={clip.transition?.duration ?? 0} step={0.1} onChange={(v) => setTr(v > 0 ? v : null)} />
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
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>;
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
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)', flex: 1 }}>
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

function TransKindSelect({ value, onPick }: { id: string; value: TransitionKind; onPick: (k: TransitionKind) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
      <span>Тип</span>
      <select value={value} onChange={(e) => onPick(e.target.value as TransitionKind)} style={{ width: 130, padding: '4px 6px', fontSize: 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}>
        {TRANSITION_KINDS.map((k) => <option key={k} value={k}>{TRANSITION_LABEL[k]}</option>)}
      </select>
    </label>
  );
}

function TransAlignSelect({ value, onPick }: { value: TransitionAlign; onPick: (a: TransitionAlign) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {TRANSITION_ALIGNS.map((a) => (
        <button key={a} onClick={() => onPick(a)} title="С какой стороны реза лежит переход" style={{ flex: 1, padding: '4px 3px', fontSize: 11, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: value === a ? 'var(--accent-green)' : 'var(--bg-tertiary)', color: value === a ? 'var(--bg-primary)' : 'var(--text-primary)' }}>
          {TRANSITION_ALIGN_LABEL[a]}
        </button>
      ))}
    </div>
  );
}

// Системные шрифты (грузим один раз).
let fontsCache: string[] | null = null;
function useSystemFonts(): string[] {
  const [fonts, setFonts] = useState<string[]>(fontsCache ?? []);
  useEffect(() => {
    if (fontsCache) return;
    let alive = true;
    window.electronAPI.listFonts?.().then((f) => { fontsCache = f; if (alive) setFonts(f); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return fonts;
}

// Кнопка «поставить ключ» на конкретный параметр (рядом с полем).
function KfBtn({ id, clip, param, localSec, add, push }: { id: string; clip: ProClip; param: KfParam; localSec: number; add: (id: string, p: KfParam) => void; push: () => void }) {
  const track = clip.keyframes?.[param];
  const has = !!track?.length;
  const onKey = has && track!.some((k) => Math.abs(k.t - localSec) < 0.06);
  return (
    <button
      onClick={() => { push(); add(id, param); }}
      title="Ключ анимации на этом параметре в плейхеде"
      style={{ flex: 'none', width: 24, height: 24, borderRadius: 6, cursor: 'pointer', lineHeight: 1, fontSize: 12, background: onKey ? 'var(--accent-green)' : has ? 'var(--bg-tertiary)' : 'var(--bg-tertiary)', color: onKey ? 'var(--bg-primary)' : has ? 'var(--accent-green)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      ◆
    </button>
  );
}

// Редактор ключей: дорожки по параметрам, ромбы по времени — клик = перейти, ЛКМ-меню плавности, × — удалить.
function KeyframeEditor({ clip, playhead, onSeek, onRemove, onEase, onClear }: {
  clip: ProClip;
  playhead: number;
  onSeek: (t: number) => void;
  onRemove: (p: KfParam, t: number) => void;
  onEase: (p: KfParam, t: number, e: KfEase) => void;
  onClear: () => void;
}) {
  const [sel, setSel] = useState<{ p: KfParam; t: number } | null>(null);
  const dur = Math.max(0.001, clip.duration);
  const kf = clip.keyframes;
  const rows = KF_PARAMS.filter((p) => kf?.[p]?.length);
  const phLocal = playhead - clip.timelineStart;
  const total = rows.reduce((n, p) => n + (kf![p]!.length), 0);
  if (!rows.length) return (
    <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '2px 2px 0' }}>Ключей нет. Нажми ◆ у параметра, чтобы анимировать.</div>
  );
  const selKf = sel ? kf?.[sel.p]?.find((k) => Math.abs(k.t - sel.t) < 0.03) : null;
  return (
    <Section title="Ключи анимации">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((p) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 62, flex: 'none', fontSize: 10.5, color: 'var(--text-secondary)' }}>{KF_PARAM_LABEL[p]}</span>
            <div style={{ position: 'relative', flex: 1, height: 18, background: 'var(--bg-tertiary)', borderRadius: 4, border: '1px solid var(--border)' }}>
              {/* плейхед */}
              {phLocal >= 0 && phLocal <= dur && (
                <div style={{ position: 'absolute', left: `${(phLocal / dur) * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--accent-green)', opacity: 0.7 }} />
              )}
              {kf![p]!.map((k) => {
                const active = sel?.p === p && Math.abs(sel.t - k.t) < 0.03;
                return (
                  <button
                    key={k.t}
                    onClick={() => { setSel({ p, t: k.t }); onSeek(k.t); }}
                    title={`t=${k.t.toFixed(2)}с · ${KF_EASE_LABEL[k.ease ?? 'linear']}`}
                    style={{ position: 'absolute', left: `${(k.t / dur) * 100}%`, top: '50%', width: 12, height: 12, transform: 'translate(-50%,-50%) rotate(45deg)', background: active ? 'var(--accent-green)' : '#cbd2dd', border: active ? '1px solid #fff' : '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', padding: 0 }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {sel && selKf && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{KF_PARAM_LABEL[sel.p]} @ {sel.t.toFixed(2)}с</span>
          <select
            value={selKf.ease ?? 'linear'}
            onChange={(e) => onEase(sel.p, sel.t, e.target.value as KfEase)}
            title="Плавность (бизье) на выходе из ключа"
            style={{ padding: '3px 6px', fontSize: 11.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}
          >
            {KF_EASES.map((e) => <option key={e} value={e}>{KF_EASE_LABEL[e]}</option>)}
          </select>
          <button onClick={() => { onRemove(sel.p, sel.t); setSel(null); }} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-tertiary)', color: '#ff8080', border: '1px solid var(--border)' }}>✕ Удалить</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{total} ключ.</span>
        <button onClick={onClear} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Очистить все</button>
      </div>
    </Section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      {text}
    </div>
  );
}
