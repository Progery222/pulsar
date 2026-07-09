import { useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { regenerateMontage } from '../utils/regenerate';
import { formatTime } from '../utils/media';

// Псевдо-waveform (детерминированные столбцы) — как в SegmentTool.
const BARS = Array.from({ length: 160 }, (_, i) =>
  0.2 + 0.8 * Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.13))
);

// Таймлайн музыки под клипами: показывает выбранный сегмент трека и
// позволяет двигать музыку — перетаскивание окна меняет segmentStart,
// на отпускании перегенерируем нарезку под новые биты.
export default function MusicTimeline() {
  const selectedTrack = useProjectStore((s) => s.selectedTrack);
  const beatData = useProjectStore((s) => s.beatData);
  const duration = useProjectStore((s) => s.duration);
  const segmentStart = useProjectStore((s) => s.segmentStart);
  const setSegmentStart = useProjectStore((s) => s.setSegmentStart);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ grabPct: number } | null>(null);

  if (!selectedTrack) return null;

  const trackDur = selectedTrack.duration || beatData?.duration || duration || 1;
  const windowPct = Math.min(1, duration / trackDur);
  const leftPct = Math.max(0, Math.min(1 - windowPct, segmentStart / trackDur));

  function apply(clientX: number, grabPct: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = (clientX - rect.left) / rect.width; // курсор в долях трека
    const left = Math.max(0, Math.min(1 - windowPct, pos - grabPct));
    setSegmentStart(Number((left * trackDur).toFixed(3)));
  }

  function onDown(e: React.PointerEvent) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = (e.clientX - rect.left) / rect.width;
    // Клик по окну — тянем относительно точки захвата; вне окна — центрируем окно на курсоре.
    const grabPct = pos >= leftPct && pos <= leftPct + windowPct ? pos - leftPct : windowPct / 2;
    drag.current = { grabPct };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    apply(e.clientX, grabPct);
  }
  function onMove(e: React.PointerEvent) {
    if (drag.current) apply(e.clientX, drag.current.grabPct);
  }
  function onUp() {
    if (!drag.current) return;
    drag.current = null;
    regenerateMontage();
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          🎵 {selectedTrack.title}{selectedTrack.artist ? ` — ${selectedTrack.artist}` : ''}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>
          тяни — сдвинуть трек · {formatTime(segmentStart)} / {formatTime(trackDur)}
        </span>
      </div>
      <div
        ref={trackRef}
        className="relative flex items-center gap-px overflow-hidden rounded-el"
        style={{ height: 44, background: 'var(--bg-tertiary)', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {BARS.map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h * 100}%`, backgroundColor: 'var(--text-secondary)', opacity: 0.4 }} />
        ))}
        <div
          className="absolute top-0 h-full"
          style={{
            left: `${leftPct * 100}%`,
            width: `${windowPct * 100}%`,
            border: '2px solid var(--accent-green)',
            borderRadius: 6,
            backgroundColor: 'rgba(204,255,0,0.14)',
          }}
        />
      </div>
    </div>
  );
}
