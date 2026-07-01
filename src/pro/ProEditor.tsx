import { useCallback, useEffect, useRef, useState } from 'react';
import { useProStore } from '../store/proStore';
import { showToast } from '../store/toastStore';
import Timeline, { zoomAtPlayhead } from './Timeline';
import Viewer from './Viewer';
import LeftPanel from './LeftPanel';
import { buildAutoCut } from './autoCut';
import type { Mood, ProTool } from './proTypes';

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
  const target = (videoTracks.find((t) => t.id === 'V1') ?? videoTracks[videoTracks.length - 1])?.id;
  if (!target) {
    showToast('Нет видео-дорожки');
    return;
  }
  showToast('Анализ ритма…');
  const res = await window.electronAPI.analyzeAudio(audioClip.sourceFile);
  if (!res || 'error' in res) {
    showToast('Не удалось проанализировать аудио');
    return;
  }
  const locked = doc.clips.filter((c) => c.trackId === target && c.locked).map((c) => ({ start: c.timelineStart, end: c.timelineStart + c.duration }));
  const gen = buildAutoCut({
    beatData: res,
    mood: st.autoCutMood,
    pool,
    trackId: target,
    audioStart: audioClip.timelineStart,
    audioInPoint: audioClip.inPoint,
    audioDuration: audioClip.duration,
    locked,
  });
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
      const key = e.key.toLowerCase();
      if (e.ctrlKey && key === 'k') {
        // Разрезать по плейхеду (§3.3 ТЗ).
        e.preventDefault();
        const ph = st.playhead;
        const targets = st.selectedClipIds.length ? st.doc.clips.filter((c) => st.selectedClipIds.includes(c.id)) : st.doc.clips.slice();
        for (const c of targets) if (ph > c.timelineStart && ph < c.timelineStart + c.duration) st.splitClipAt(c.id, ph);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomAtPlayhead(st.pxPerSec * 1.3);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomAtPlayhead(st.pxPerSec / 1.3);
      } else if (key === 'n') {
        st.toggleSnapping();
      } else if (key === 'c' || key === 'b') {
        st.setTool('blade');
      } else if (key === 'v') {
        st.setTool('select');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!st.selectedClipIds.length) return;
        // Ripple Delete: Shift+Delete или активный режим Ripple.
        if (e.shiftKey || st.activeTool === 'ripple') st.rippleDeleteClips(st.selectedClipIds);
        else st.removeClips(st.selectedClipIds); // обычное удаление (оставляет gap)
      } else if (e.key === 'Escape') {
        st.setTool('select');
        st.setSelection([]);
      } else if (e.code === 'Space') {
        e.preventDefault();
        st.setPlaying(!st.isPlaying);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-primary)', overflow: 'hidden' }}>
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
    </div>
  );
}

function ProToolbar() {
  const activeTool = useProStore((s) => s.activeTool);
  const setTool = useProStore((s) => s.setTool);
  const snapping = useProStore((s) => s.snapping);
  const toggleSnapping = useProStore((s) => s.toggleSnapping);
  const mood = useProStore((s) => s.autoCutMood);
  const setMood = useProStore((s) => s.setAutoCutMood);
  const addAdjustmentTrack = useProStore((s) => s.addAdjustmentTrack);
  const [running, setRunning] = useState(false);

  const tools: { id: ProTool; label: string }[] = [
    { id: 'select', label: 'Selection' },
    { id: 'blade', label: 'Blade' },
    { id: 'ripple', label: 'Ripple' },
  ];

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
      {tools.map((t) => (
        <ToolBtn key={t.id} active={activeTool === t.id} onClick={() => setTool(t.id)}>
          {t.label}
        </ToolBtn>
      ))}
      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 6px' }} />
      <ToolBtn onClick={onAutoCut} title="Разложить видео по битам аудио">
        {running ? 'Анализ…' : 'Auto-Cut'}
      </ToolBtn>
      <ToolBtn onClick={cycleMood} title="Плотность нарезки">
        Mood: {MOODS.find((m) => m.id === mood)?.label}
      </ToolBtn>
      <ToolBtn onClick={() => { addAdjustmentTrack(); showToast('Дорожка корр. слоёв добавлена (кнопка ＋ на ней)'); }} title="Дорожка корректирующих слоёв (фильтры)">
        ＋Adjustment
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
