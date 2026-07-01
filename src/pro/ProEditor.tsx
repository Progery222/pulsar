import { useCallback, useRef } from 'react';
import { useUIStore } from '../store/uiStore';
import { useProStore } from '../store/proStore';
import type { ProTool } from './proTypes';

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

  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-primary)', overflow: 'hidden' }}>
      {/* Верхняя область: Media/Inspector (слева) + Viewer (центр). */}
      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ width: leftWidth, minWidth: 0, borderRight: '1px solid var(--border)' }}>
          <MediaInspectorPanel />
        </div>
        <div
          onMouseDown={onDragLeft}
          style={{ width: 5, cursor: 'col-resize', background: 'var(--bg-primary)', flex: '0 0 auto' }}
          title="Ширина панели"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <ViewerPanel />
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
        <TimelinePanel />
      </div>
    </div>
  );
}

// ─── Зоны (Фаза 1: плейсхолдеры) ──────────────────────────────────────────

function MediaInspectorPanel() {
  return (
    <Zone title="Media / Inspector">
      <TabsStub tabs={['Media', 'Inspector']} />
      <Placeholder text="Бин исходников проекта и параметры выделенного клипа (Transform, Crop, Effects, Audio)." />
    </Zone>
  );
}

function ViewerPanel() {
  const isPlaying = useProStore((s) => s.isPlaying);
  const setPlaying = useProStore((s) => s.setPlaying);
  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Окно предпросмотра (Фаза 4 — WebGL-компоновщик). */}
      <div className="flex flex-1 items-center justify-center" style={{ minHeight: 0, padding: 16 }}>
        <div
          className="flex items-center justify-center"
          style={{
            aspectRatio: '16 / 9',
            maxWidth: '100%',
            maxHeight: '100%',
            width: '100%',
            background: '#000',
            borderRadius: 8,
            color: 'var(--text-secondary)',
            fontSize: 13,
          }}
        >
          Viewer (WebGL)
        </div>
      </div>
      {/* Кнопки управления воспроизведением (§2 ТЗ). */}
      <div
        className="flex items-center justify-center"
        style={{ gap: 14, padding: '10px 0', borderTop: '1px solid var(--border)' }}
      >
        <TransportBtn label="⏮" title="В начало" />
        <TransportBtn label={isPlaying ? '⏸' : '▶'} title="Play / Pause" onClick={() => setPlaying(!isPlaying)} primary />
        <TransportBtn label="⏭" title="В конец" />
      </div>
    </div>
  );
}

function ProToolbar() {
  const activeTool = useProStore((s) => s.activeTool);
  const setTool = useProStore((s) => s.setTool);
  const snapping = useProStore((s) => s.snapping);
  const toggleSnapping = useProStore((s) => s.toggleSnapping);

  const tools: { id: ProTool; label: string }[] = [
    { id: 'select', label: 'Selection' },
    { id: 'blade', label: 'Blade' },
    { id: 'ripple', label: 'Ripple' },
  ];

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
      <ToolBtn onClick={() => {}}>Auto-Cut</ToolBtn>
      <ToolBtn onClick={() => {}}>Mood</ToolBtn>
      <ToolBtn onClick={() => {}}>Styles</ToolBtn>
      <div style={{ marginLeft: 'auto' }}>
        <ToolBtn active={snapping} onClick={toggleSnapping} title="Прилипание (N)">
          Snap
        </ToolBtn>
      </div>
    </div>
  );
}

function TimelinePanel() {
  return (
    <Zone title="Timeline">
      <Placeholder text="Многодорожечная зона: Track Header, Time Ruler (HH:MM:SS:FF), клипы, zoom. Фаза 2." />
    </Zone>
  );
}

// ─── Вспомогательные примитивы ────────────────────────────────────────────

function Zone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-secondary)' }}>
      <div
        style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}
      >
        {title}
      </div>
      <div className="flex flex-1 flex-col" style={{ minHeight: 0, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

function TabsStub({ tabs }: { tabs: string[] }) {
  return (
    <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
      {tabs.map((t, i) => (
        <div
          key={t}
          style={{
            padding: '8px 14px',
            fontSize: 13,
            color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
            borderBottom: i === 0 ? '2px solid var(--accent-green)' : '2px solid transparent',
            cursor: 'pointer',
          }}
        >
          {t}
        </div>
      ))}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}
    >
      {text}
    </div>
  );
}

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

function TransportBtn({
  label,
  title,
  onClick,
  primary,
}: {
  label: string;
  title: string;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: primary ? 44 : 36,
        height: 36,
        borderRadius: 8,
        fontSize: 16,
        cursor: 'pointer',
        color: primary ? 'var(--bg-primary)' : 'var(--text-primary)',
        background: primary ? 'var(--accent-green)' : 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
      }}
    >
      {label}
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
