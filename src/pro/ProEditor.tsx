import { useCallback, useEffect, useRef, useState } from 'react';
import { useProStore } from '../store/proStore';
import { showToast } from '../store/toastStore';
import Timeline, { zoomAtPlayhead } from './Timeline';
import Viewer from './Viewer';
import LeftPanel from './LeftPanel';
import { buildAutoCut } from './autoCut';
import { deleteProject, getCurrentId, listProjects, loadProject, migrateLegacy, newProjectId, saveProject, setCurrentId } from './persistence';
import { createEmptyProDocument, type Mood } from './proTypes';

const MOODS: { id: Mood; label: string }[] = [
  { id: 'mellow', label: 'Спокойный' },
  { id: 'natural', label: 'Обычный' },
  { id: 'energetic', label: 'Энергичный' },
];

// Auto-Cut: анализ ритма аудио с дорожки A и раскладка видео из пула по битам.
async function runAutoCut(): Promise<void> {
  const st = useProStore.getState();
  const doc = st.doc;
  const audioTracks = new Set(doc.tracks.filter((t) => t.kind === 'audio').map((t) => t.id));
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video');
  const audioClip = doc.clips.find((c) => audioTracks.has(c.trackId));
  if (!audioClip) {
    showToast('Добавьте аудио на дорожку A (кнопка ＋)');
    return;
  }
  const seen = new Set<string>();
  const pool: { path: string; duration: number }[] = [];
  const videoTrackIds = new Set(videoTracks.map((t) => t.id));
  for (const c of doc.clips) {
    if (videoTrackIds.has(c.trackId) && !seen.has(c.sourceFile)) {
      seen.add(c.sourceFile);
      pool.push({ path: c.sourceFile, duration: c.sourceDuration ?? 0 });
    }
  }
  if (!pool.length) {
    showToast('Импортируйте видео на дорожку V (кнопка ＋)');
    return;
  }
  // Целевая дорожка — где уже лежит видео (перекладываем её), иначе V1.
  const counts = videoTracks.map((t) => ({ id: t.id, n: doc.clips.filter((c) => c.trackId === t.id && !c.text).length }));
  counts.sort((a, b) => b.n - a.n);
  const target = counts[0] && counts[0].n > 0 ? counts[0].id : (videoTracks.find((t) => t.id === 'V1') ?? videoTracks[videoTracks.length - 1])?.id;
  if (!target) {
    showToast('Нет видео-дорожки');
    return;
  }
  showToast('Анализ ритма…');
  const res = await window.electronAPI.analyzeAudio(audioClip.sourceFile);
  let beatData;
  if (!res || 'error' in res) {
    // Фолбэк без librosa — равномерная сетка 0.5с.
    const beats: number[] = [];
    for (let t = 0; t <= audioClip.duration; t += 0.5) beats.push(audioClip.inPoint + t);
    beatData = { tempo: 120, beat_times: beats, onset_times: [], duration: audioClip.duration };
    showToast('Ритм не определён — равномерная сетка 0.5с');
  } else {
    beatData = res;
  }
  const locked = doc.clips.filter((c) => c.trackId === target && c.locked).map((c) => ({ start: c.timelineStart, end: c.timelineStart + c.duration }));
  const gen = buildAutoCut({
    beatData,
    mood: st.autoCutMood,
    pool,
    trackId: target,
    audioStart: audioClip.timelineStart,
    audioInPoint: audioClip.inPoint,
    audioDuration: audioClip.duration,
    locked,
  });
  useProStore.getState().pushHistory();
  useProStore.getState().autoCutReplace(target, gen);
  showToast(`Auto-Cut: ${gen.length} клипов на ${target}`);
}

// Pulsar Pro — рабочее пространство мульти-трек монтажа (§2 ТЗ).
// Фаза 1: каркас 4 зон + resizable-разделители. Наполнение зон — след. фазы.

export default function ProEditor() {
  const leftWidth = useProStore((s) => s.leftWidth);
  const timelineHeight = useProStore((s) => s.timelineHeight);
  const setLeftWidth = useProStore((s) => s.setLeftWidth);
  const setTimelineHeight = useProStore((s) => s.setTimelineHeight);
  const [showHelp, setShowHelp] = useState(false);

  // Вертикальный разделитель левой панели.
  const onDragLeft = useDrag((dx) => setLeftWidth(useProStore.getState().leftWidth + dx));
  // Горизонтальный разделитель таймлайна (тянем вверх — таймлайн выше).
  const onDragTimeline = useDrag((_dx, dy) => setTimelineHeight(useProStore.getState().timelineHeight - dy));

  // Хоткеи Pro-режима (§3.2 ТЗ): zoom +/-, snapping N, play Space.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useProStore.getState();
      const code = e.code; // независимо от раскладки клавиатуры (кириллица и т.п.)
      // Комбинации с Ctrl/Cmd.
      if (e.ctrlKey || e.metaKey) {
        if (code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
        if (code === 'KeyY') { e.preventDefault(); st.redo(); return; }
        if (code === 'KeyC') { e.preventDefault(); st.copyClips(st.selectedClipIds); return; }
        if (code === 'KeyX') {
          e.preventDefault();
          if (st.selectedClipIds.length) { st.copyClips(st.selectedClipIds); st.pushHistory(); st.removeClips(st.selectedClipIds); }
          return;
        }
        if (code === 'KeyV') { e.preventDefault(); st.pushHistory(); st.pasteClips(st.playhead); return; }
        if (code === 'KeyD') { e.preventDefault(); if (st.selectedClipIds.length) { st.pushHistory(); st.duplicateClips(st.selectedClipIds); } return; }
        if (code === 'KeyA') { e.preventDefault(); st.selectAll(); return; }
        if (code === 'KeyK') {
          e.preventDefault();
          const ph = st.playhead;
          const targets = st.selectedClipIds.length ? st.doc.clips.filter((c) => st.selectedClipIds.includes(c.id)) : st.doc.clips.slice();
          st.pushHistory();
          for (const c of targets) if (ph > c.timelineStart && ph < c.timelineStart + c.duration) st.splitClipAt(c.id, ph);
          return;
        }
        return;
      }
      // Без модификаторов.
      if (code === 'Equal' || code === 'NumpadAdd') { e.preventDefault(); zoomAtPlayhead(st.pxPerSec * 1.3); }
      else if (code === 'Minus' || code === 'NumpadSubtract') { e.preventDefault(); zoomAtPlayhead(st.pxPerSec / 1.3); }
      else if (code === 'KeyN') st.toggleSnapping();
      else if (e.shiftKey && code === 'Slash') setShowHelp((v) => !v);
      else if (code === 'KeyC' || code === 'KeyB') st.setTool('blade');
      else if (code === 'KeyV') st.setTool('select');
      else if (code === 'KeyI') st.setExportIn(st.playhead);
      else if (code === 'KeyO') st.setExportOut(st.playhead);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!st.selectedClipIds.length) return;
        st.pushHistory();
        if (e.shiftKey || st.activeTool === 'ripple') st.rippleDeleteClips(st.selectedClipIds);
        else st.removeClips(st.selectedClipIds);
      } else if (e.key === 'Escape') {
        st.setTool('select');
        st.setSelection([]);
      } else if (code === 'Space') {
        e.preventDefault();
        st.setPlaying(!st.isPlaying);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Загрузка текущего проекта + автосейв в IndexedDB (§6 ТЗ).
  useEffect(() => {
    let alive = true;
    (async () => {
      await migrateLegacy();
      let id = await getCurrentId();
      const list = await listProjects();
      if (!id || !list.some((p) => p.id === id)) id = list[0]?.id ?? null;
      if (!alive) return;
      if (id) {
        const p = await loadProject(id);
        if (!alive) return;
        if (p) {
          useProStore.getState().loadDocument(p.doc);
          useProStore.getState().setProject(id, p.name);
          await setCurrentId(id);
          return;
        }
      }
      // Первый запуск — создаём проект.
      const nid = newProjectId();
      useProStore.getState().setProject(nid, 'Проект 1');
      await saveProject(nid, 'Проект 1', useProStore.getState().doc);
      await setCurrentId(nid);
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useProStore.subscribe((state, prev) => {
      if (state.doc !== prev.doc || state.projectName !== prev.projectName) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const st = useProStore.getState();
          if (st.projectId) saveProject(st.projectId, st.projectName, st.doc).catch(() => {});
        }, 500);
      }
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsub();
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-primary)', overflow: 'hidden', paddingTop: 54, boxSizing: 'border-box' }}>
      {/* Верхняя область: Media/Inspector (слева) + Viewer (центр). */}
      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ width: leftWidth, minWidth: 0, borderRight: '1px solid var(--border)' }}>
          <LeftPanel />
        </div>
        <div
          onMouseDown={onDragLeft}
          style={{ width: 5, cursor: 'col-resize', background: 'var(--bg-primary)', flex: '0 0 auto' }}
          title="Ширина панели"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Viewer />
        </div>
      </div>

      {/* Toolbar между Viewer и Timeline (§2 ТЗ). */}
      <ProToolbar />

      {/* Горизонтальный разделитель. */}
      <div
        onMouseDown={onDragTimeline}
        style={{ height: 5, cursor: 'row-resize', background: 'var(--bg-primary)' }}
        title="Высота таймлайна"
      />

      {/* Timeline (нижняя панель). */}
      <div style={{ height: timelineHeight, borderTop: '1px solid var(--border)' }}>
        <Timeline />
      </div>

      <ProjectsMenu />
      <button onClick={() => setShowHelp(true)} title="Горячие клавиши (?)" style={{ position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', zIndex: 1001 }}>?</button>
      {showHelp && <HotkeysOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function ProjectsMenu() {
  const projectName = useProStore((s) => s.projectName);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  const refresh = () => listProjects().then(setList);
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const saveCurrent = async () => {
    const st = useProStore.getState();
    if (st.projectId) await saveProject(st.projectId, st.projectName, st.doc);
  };
  const switchTo = async (id: string) => {
    await saveCurrent();
    const p = await loadProject(id);
    if (p) {
      useProStore.getState().loadDocument(p.doc);
      useProStore.getState().setProject(id, p.name);
      await setCurrentId(id);
    }
    setOpen(false);
  };
  const create = async () => {
    await saveCurrent();
    const name = window.prompt('Название проекта', 'Новый проект') || 'Новый проект';
    const id = newProjectId();
    useProStore.getState().loadDocument(createEmptyProDocument());
    useProStore.getState().setProject(id, name);
    await saveProject(id, name, useProStore.getState().doc);
    await setCurrentId(id);
    setOpen(false);
  };
  const rename = async () => {
    const st = useProStore.getState();
    if (!st.projectId) return;
    const name = window.prompt('Новое название', st.projectName);
    if (!name) return;
    useProStore.getState().setProject(st.projectId, name);
    await saveProject(st.projectId, name, st.doc);
    refresh();
  };
  const del = async (id: string) => {
    if (!window.confirm('Удалить проект?')) return;
    await deleteProject(id);
    if (id === useProStore.getState().projectId) {
      const rest = await listProjects();
      if (rest[0]) await switchTo(rest[0].id);
      else await create();
    } else refresh();
  };

  return (
    <div style={{ position: 'absolute', top: 12, right: 52, zIndex: 1001 }}>
      <button onClick={() => setOpen((o) => !o)} title="Проекты" style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        🗂 {projectName} ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1001 }} />
          <div style={{ position: 'absolute', top: 34, right: 0, width: 260, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, zIndex: 1002, maxHeight: '60vh', overflow: 'auto' }}>
            {list.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 6, fontSize: 12.5, color: 'var(--text-primary)' }}>
                <button onClick={() => switchTo(p.id)} style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', color: p.id === useProStore.getState().projectId ? 'var(--accent-green)' : 'var(--text-primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</button>
                <button onClick={() => del(p.id)} title="Удалить" style={{ width: 22, height: 20, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <button onClick={create} style={{ flex: 1, padding: '5px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>＋ Новый</button>
              <button onClick={rename} style={{ flex: 1, padding: '5px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12 }}>Переименовать</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HotkeysOverlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Пробел', 'Плей / пауза'],
    ['V', 'Курсор (выделение/перемещение)'],
    ['C / B', 'Лезвие (разрез)'],
    ['Ctrl+K', 'Разрезать по плейхеду'],
    ['Delete', 'Удалить (оставить пропуск)'],
    ['Shift+Delete', 'Удалить со сдвигом (Ripple)'],
    ['Ctrl+C / X / V', 'Копировать / вырезать / вставить'],
    ['Ctrl+D', 'Дублировать'],
    ['Ctrl+A', 'Выделить всё'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Отменить / повторить'],
    ['N', 'Прилипание вкл/выкл'],
    ['I / O', 'Начало / конец области экспорта'],
    ['+ / −', 'Масштаб таймлайна'],
    ['Alt+колесо', 'Масштаб у плейхеда'],
    ['Средняя кнопка', 'Панорамирование'],
  ];
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1002 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, width: 'min(460px, 92vw)', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Горячие клавиши</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
              <span style={{ color: 'var(--accent-green)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{k}</span>
              <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProToolbar() {
  const snapping = useProStore((s) => s.snapping);
  const toggleSnapping = useProStore((s) => s.toggleSnapping);
  const mood = useProStore((s) => s.autoCutMood);
  const setMood = useProStore((s) => s.setAutoCutMood);
  const addAdjustmentTrack = useProStore((s) => s.addAdjustmentTrack);
  const [running, setRunning] = useState(false);

  const onAutoCut = async () => {
    if (running) return;
    setRunning(true);
    try {
      await runAutoCut();
    } finally {
      setRunning(false);
    }
  };
  const cycleMood = () => {
    const i = MOODS.findIndex((m) => m.id === mood);
    setMood(MOODS[(i + 1) % MOODS.length].id);
  };

  return (
    <div
      className="flex items-center"
      style={{ gap: 8, padding: '6px 12px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}
    >
      <ToolBtn onClick={onAutoCut} title="Разложить видео по битам аудио">
        {running ? 'Анализ…' : 'Auto-Cut'}
      </ToolBtn>
      <ToolBtn onClick={cycleMood} title="Плотность нарезки">
        Mood: {MOODS.find((m) => m.id === mood)?.label}
      </ToolBtn>
      <ToolBtn onClick={() => { useProStore.getState().pushHistory(); addAdjustmentTrack(); showToast('Дорожка корр. слоёв добавлена (кнопка ＋ на ней)'); }} title="Дорожка корректирующих слоёв (фильтры)">
        ＋Adjustment
      </ToolBtn>
      <ToolBtn onClick={() => {
        const st = useProStore.getState();
        const vt = st.doc.tracks.find((t) => t.kind === 'video' && !t.isAdjustment);
        if (!vt) { showToast('Нет видео-дорожки'); return; }
        st.pushHistory();
        st.addTextClip(vt.id, st.playhead, 3);
        showToast('Текст добавлен — отредактируйте в Inspector');
      }} title="Добавить текст/титр">
        ＋Текст
      </ToolBtn>
      <div style={{ marginLeft: 'auto' }}>
        <ToolBtn active={snapping} onClick={toggleSnapping} title="Прилипание (N)">
          Snap
        </ToolBtn>
      </div>
    </div>
  );
}

// ─── Вспомогательные примитивы ────────────────────────────────────────────

function ToolBtn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 12px',
        fontSize: 12.5,
        borderRadius: 7,
        cursor: 'pointer',
        color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
        background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  );
}

// Хук перетаскивания разделителя: колбэк получает дельту (dx, dy) с прошлого события.
function useDrag(onMove: (dx: number, dy: number) => void) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      last.current = { x: e.clientX, y: e.clientY };
      const move = (ev: MouseEvent) => {
        if (!last.current) return;
        onMove(ev.clientX - last.current.x, ev.clientY - last.current.y);
        last.current = { x: ev.clientX, y: ev.clientY };
      };
      const up = () => {
        last.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [onMove]
  );
}
