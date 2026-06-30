import { useRef, useState, type PointerEvent } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { MediaFile } from '../types';
import { fileName, formatTime, isVideoFile, mediaUrl } from '../utils/media';
import { regenerateMontage } from '../utils/regenerate';
import TweakModal from './TweakModal';

type ToolKey = 'videos' | 'tweak' | 'duration' | 'segment' | 'mood' | 'transition' | 'text' | 'fade' | 'format';

const TOOLS: { key: ToolKey; icon: string; label: string }[] = [
  { key: 'videos', icon: '▦', label: 'Videos' },
  { key: 'tweak', icon: '🎚', label: 'Tweak' },
  { key: 'duration', icon: '⏱', label: 'Duration' },
  { key: 'segment', icon: '〜', label: 'Segment' },
  { key: 'mood', icon: '☺', label: 'Mood' },
  { key: 'transition', icon: '⇄', label: 'Переходы' },
  { key: 'text', icon: 'T', label: 'Текст' },
  { key: 'fade', icon: '▣', label: 'Fade' },
  { key: 'format', icon: '▭', label: 'Format' },
];

const TEXT_COLORS = ['#FFFFFF', '#FFE000', '#00E0FF', '#FF3B6B', '#0D0D0D', '#CCFF00'];
const TEXT_POSITIONS: { key: 'top' | 'center' | 'bottom'; label: string }[] = [
  { key: 'top', label: 'Сверху' },
  { key: 'center', label: 'Центр' },
  { key: 'bottom', label: 'Снизу' },
];

const TRANSITIONS: { key: 'none' | 'dissolve' | 'slide' | 'zoom' | 'mix'; title: string; desc: string }[] = [
  { key: 'none', title: 'Без переходов', desc: 'Жёсткие резы по битам (как раньше).' },
  { key: 'dissolve', title: 'Растворение', desc: 'Мягкий кроссфейд между клипами. Плавно и универсально.' },
  { key: 'slide', title: 'Слайды', desc: 'Клипы сдвигают друг друга (влево/вправо/вверх/вниз).' },
  { key: 'zoom', title: 'Зум / круг', desc: 'Раскрытие кругом и радиальные переходы. Динамично.' },
  { key: 'mix', title: 'Микс (рандом)', desc: 'Случайный переход на каждой склейке — максимум разнообразия.' },
];

const DURATION_PRESETS: { label: string; time: string; seconds: number }[] = [
  { label: 'Snap', time: '0:10', seconds: 10 },
  { label: 'Story', time: '0:15', seconds: 15 },
  { label: 'Reels', time: '0:30', seconds: 30 },
  { label: 'TikTok', time: '1:00', seconds: 60 },
  { label: 'Facebook', time: '1:30', seconds: 90 },
  { label: 'Popular', time: '3:00', seconds: 180 },
  { label: 'Полный трек', time: '—', seconds: -1 },
];

const MOODS: { key: 'mellow' | 'natural' | 'energetic'; title: string; desc: string }[] = [
  { key: 'mellow', title: 'Mellow', desc: 'Склейки редко (каждый 4-й бит). Спокойные, атмосферные видео.' },
  { key: 'natural', title: 'Natural', desc: 'Склейки на каждый 2-й бит. Сбалансированный ритм.' },
  { key: 'energetic', title: 'Energetic', desc: 'Склейки на каждый бит и onset. Динамичные видео.' },
];

const FADES: { key: 'none' | 'in' | 'out' | 'all'; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'in', label: 'In' },
  { key: 'out', label: 'Out' },
  { key: 'all', label: 'All' },
];

const FORMATS: { key: '9:16' | '1:1' | '16:9'; title: string; sub: string }[] = [
  { key: '9:16', title: 'Portrait', sub: '9:16' },
  { key: '1:1', title: 'Square', sub: '1:1' },
  { key: '16:9', title: 'Landscape', sub: '16:9' },
];

// §6.1: модальное окно Videos (функционал MediaPicker, кнопки Отмена/Применить).
function VideosModal({ onClose }: { onClose: () => void }) {
  const storeFiles = useProjectStore((s) => s.mediaFiles);
  const setMediaFiles = useProjectStore((s) => s.setMediaFiles);
  const setScreen = useProjectStore((s) => s.setCurrentScreen);
  const [files, setFiles] = useState<MediaFile[]>(storeFiles);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  async function add() {
    const paths = await window.electronAPI.selectVideos();
    const valid = paths.filter(isVideoFile);
    setFiles((prev) => {
      const ex = new Set(prev.map((f) => f.id));
      const added = valid
        .filter((p) => !ex.has(p))
        .map<MediaFile>((p) => ({ id: p, path: p, name: fileName(p), duration: 0 }));
      return [...prev, ...added];
    });
  }
  function remove(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }
  function reorder(from: number, to: number) {
    setFiles((prev) => {
      const arr = [...prev];
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      return arr;
    });
  }
  function apply() {
    if (files.length === 0) return;
    setMediaFiles(files);
    setScreen('processing'); // повторная генерация
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[90%] flex-col rounded-card bg-bg-secondary p-4"
        style={{ width: '80%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-text-primary" style={{ fontSize: 16 }}>
            Videos
          </h2>
          <button className="btn-primary px-3 py-1 text-sm" onClick={add}>
            + Добавить
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {files.map((f, i) => (
              <div
                key={f.id}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== i) reorder(dragIndex, i);
                  setDragIndex(null);
                }}
                className="relative aspect-square overflow-hidden rounded-el bg-bg-tertiary"
              >
                <video src={mediaUrl(f.path)} muted preload="metadata" className="h-full w-full object-cover" />
                <button
                  className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-black/70 text-white"
                  style={{ fontSize: 11 }}
                  onClick={() => remove(f.id)}
                >
                  ✕
                </button>
                <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-white" style={{ fontSize: 11 }}>
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
          {files.length === 0 && (
            <div className="py-8 text-center text-text-secondary">Нет клипов — добавьте видео</div>
          )}
        </div>
        <div className="mt-3 flex justify-end gap-3 border-t border-border pt-3">
          <button className="btn-secondary px-5 py-2" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary px-5 py-2" onClick={apply} disabled={files.length === 0}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

// §6.4: Segment — waveform + окно выделения.
function SegmentTool() {
  const selectedTrack = useProjectStore((s) => s.selectedTrack);
  const beatData = useProjectStore((s) => s.beatData);
  const duration = useProjectStore((s) => s.duration);
  const segmentStart = useProjectStore((s) => s.segmentStart);
  const setSegmentStart = useProjectStore((s) => s.setSegmentStart);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const trackDur = selectedTrack?.duration || beatData?.duration || duration || 1;
  const windowPct = Math.min(1, duration / trackDur);
  const leftPct = Math.max(0, Math.min(1 - windowPct, segmentStart / trackDur));

  // Псевдо-waveform (детерминированные столбцы).
  const bars = Array.from({ length: 120 }, (_, i) =>
    0.2 + 0.8 * Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.13))
  );

  function move(e: PointerEvent) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = (e.clientX - rect.left) / rect.width;
    const left = Math.max(0, Math.min(1 - windowPct, center - windowPct / 2));
    setSegmentStart(Number((left * trackDur).toFixed(3)));
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-text-secondary" style={{ fontSize: 13 }}>
        Начало сегмента: {formatTime(segmentStart)} / {formatTime(trackDur)}
      </p>
      <div
        ref={trackRef}
        className="relative flex h-24 w-full items-center gap-px overflow-hidden rounded-el bg-bg-tertiary"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => dragging.current && move(e)}
        onPointerUp={() => {
          dragging.current = false;
          regenerateMontage();
        }}
      >
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1"
            style={{ height: `${h * 100}%`, backgroundColor: 'var(--text-secondary)', opacity: 0.5 }}
          />
        ))}
        <div
          className="absolute top-0 h-full border-2"
          style={{
            left: `${leftPct * 100}%`,
            width: `${windowPct * 100}%`,
            borderColor: 'var(--accent-green)',
            backgroundColor: 'rgba(204,255,0,0.12)',
          }}
        />
      </div>
    </div>
  );
}

export default function ToolsPanel() {
  const duration = useProjectStore((s) => s.duration);
  const mood = useProjectStore((s) => s.mood);
  const fade = useProjectStore((s) => s.fade);
  const format = useProjectStore((s) => s.format);
  const transition = useProjectStore((s) => s.transition);
  const title = useProjectStore((s) => s.title);
  const setTitle = useProjectStore((s) => s.setTitle);
  const selectedTrack = useProjectStore((s) => s.selectedTrack);
  const beatData = useProjectStore((s) => s.beatData);
  const setDuration = useProjectStore((s) => s.setDuration);
  const setMood = useProjectStore((s) => s.setMood);
  const setFade = useProjectStore((s) => s.setFade);
  const setFormat = useProjectStore((s) => s.setFormat);
  const setTransition = useProjectStore((s) => s.setTransition);

  const [active, setActive] = useState<ToolKey>('duration');
  const [modal, setModal] = useState<'none' | 'videos' | 'tweak'>('none');

  function onToolClick(key: ToolKey) {
    if (key === 'videos') setModal('videos');
    else if (key === 'tweak') setModal('tweak');
    else setActive(key);
  }

  function pickDuration(seconds: number) {
    const value = seconds === -1 ? selectedTrack?.duration || beatData?.duration || duration : seconds;
    setDuration(value);
    regenerateMontage();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Лента иконок инструментов */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2">
        {TOOLS.map((t) => {
          const isActive = t.key === active && modal === 'none';
          return (
            <button
              key={t.key}
              onClick={() => onToolClick(t.key)}
              className="flex shrink-0 flex-col items-center rounded-el px-2 py-1 hover:bg-bg-tertiary"
              style={{ width: 64 }}
            >
              <span style={{ fontSize: 22, color: isActive ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                {t.icon}
              </span>
              <span style={{ fontSize: 11, color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Содержимое инструмента */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active === 'duration' && (
          <div className="p-2">
            {DURATION_PRESETS.map((p) => {
              const value = p.seconds === -1 ? selectedTrack?.duration || beatData?.duration || 0 : p.seconds;
              const sel = Math.round(duration) === Math.round(value);
              return (
                <button
                  key={p.label}
                  onClick={() => pickDuration(p.seconds)}
                  className="flex w-full items-center justify-between rounded-el px-3 py-3 hover:bg-bg-tertiary"
                  style={{ color: sel ? 'var(--accent-green)' : 'var(--text-primary)' }}
                >
                  <span className="font-semibold" style={{ fontSize: 14 }}>{p.label}</span>
                  <span style={{ fontSize: 13 }}>{p.time}</span>
                </button>
              );
            })}
          </div>
        )}

        {active === 'segment' && <SegmentTool />}

        {active === 'mood' && (
          <div className="flex flex-col gap-2 p-3">
            {MOODS.map((m) => {
              const sel = m.key === mood;
              return (
                <button
                  key={m.key}
                  onClick={() => {
                    setMood(m.key);
                    regenerateMontage();
                  }}
                  className="rounded-card p-3 text-left"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: sel ? '2px solid var(--accent-green)' : '2px solid transparent',
                  }}
                >
                  <div className="font-semibold text-text-primary" style={{ fontSize: 15 }}>{m.title}</div>
                  <div className="mt-1 text-text-secondary" style={{ fontSize: 12 }}>{m.desc}</div>
                </button>
              );
            })}
          </div>
        )}

        {active === 'transition' && (
          <div className="flex flex-col gap-3 p-4">
            {TRANSITIONS.map((t) => {
              const sel = t.key === transition;
              return (
                <button
                  key={t.key}
                  onClick={() => setTransition(t.key)}
                  className="rounded-card p-4 text-left"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: sel ? '2px solid var(--accent-green)' : '2px solid transparent',
                  }}
                >
                  <div className="font-semibold" style={{ fontSize: 15, color: sel ? 'var(--accent-green)' : 'var(--text-primary)' }}>{t.title}</div>
                  <div className="mt-1 text-text-secondary" style={{ fontSize: 12 }}>{t.desc}</div>
                </button>
              );
            })}
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '0 4px' }}>
              Переходы накладываются на склейках (~0.25с). Делают монтаж плавнее, как в проф-редакторах.
            </p>
          </div>
        )}

        {active === 'text' && (
          <div className="flex flex-col gap-3 p-4">
            <input
              type="text"
              value={title.text}
              onChange={(e) => setTitle({ text: e.target.value })}
              placeholder="Заголовок поверх видео…"
              style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}
            />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Позиция</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {TEXT_POSITIONS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setTitle({ position: p.key })}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: title.position === p.key ? 'var(--accent-green)' : 'var(--bg-tertiary)', color: title.position === p.key ? '#0D0D0D' : 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Цвет</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setTitle({ color: c })}
                    title={c}
                    style={{ width: 30, height: 30, borderRadius: 6, background: c, cursor: 'pointer', border: title.color === c ? '3px solid var(--accent-green)' : '1px solid var(--border)' }}
                  />
                ))}
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <span>Размер</span>
                <span>{title.size}</span>
              </div>
              <input type="range" min={32} max={140} value={title.size} onChange={(e) => setTitle({ size: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={title.box} onChange={(e) => setTitle({ box: e.target.checked })} />
              Подложка под текстом (читабельнее)
            </label>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Текст появляется поверх всего видео с плавным въездом/выездом. Видно в финальном экспорте.
            </p>
          </div>
        )}

        {active === 'fade' && (
          <div className="grid grid-cols-2 gap-3 p-4">
            {FADES.map((f) => {
              const sel = f.key === fade;
              return (
                <button
                  key={f.key}
                  onClick={() => setFade(f.key)}
                  className="flex h-20 items-center justify-center rounded-card font-semibold"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: sel ? 'var(--accent-green)' : 'var(--text-primary)',
                    border: sel ? '2px solid var(--accent-green)' : '2px solid transparent',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        {active === 'format' && (
          <div className="flex flex-col gap-3 p-4">
            {FORMATS.map((f) => {
              const sel = f.key === format;
              return (
                <button
                  key={f.key}
                  onClick={() => setFormat(f.key)}
                  className="flex items-center justify-between rounded-card p-4"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: sel ? '2px solid var(--accent-green)' : '2px solid transparent',
                  }}
                >
                  <span className="font-semibold text-text-primary" style={{ fontSize: 15 }}>{f.title}</span>
                  <span style={{ fontSize: 13, color: sel ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {f.sub}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {modal === 'videos' && <VideosModal onClose={() => setModal('none')} />}
      {modal === 'tweak' && <TweakModal onClose={() => setModal('none')} />}
    </div>
  );
}
