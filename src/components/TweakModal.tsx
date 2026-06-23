import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { GeneratedClip } from '../types';
import { formatTime, mediaUrl } from '../utils/media';

// TweakModal (§6.2): тонкая настройка фрагментов монтажа.
export default function TweakModal({ onClose }: { onClose: () => void }) {
  const clips = useProjectStore((s) => s.generatedClips);
  const setGeneratedClips = useProjectStore((s) => s.setGeneratedClips);
  const setTweakOverride = useProjectStore((s) => s.setTweakOverride);

  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'none' | 'highlight'>('none');
  const [srcDuration, setSrcDuration] = useState(0);
  const [startPct, setStartPct] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  // Накопительные тайм-метки фрагментов на таймлайне вывода.
  const starts = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const c of clips) {
      arr.push(acc);
      acc += c.duration;
    }
    return arr;
  }, [clips]);

  const clip = selected !== null ? clips[selected] : null;
  const windowPct = clip && srcDuration > 0 ? Math.min(1, clip.duration / srcDuration) : 0.2;

  function openClip(index: number) {
    setSelected(index);
    setMode('none');
  }

  function openHighlight() {
    if (clip) setStartPct(srcDuration > 0 ? clip.startTime / srcDuration : 0);
    setMode('highlight');
  }

  function applyHighlight() {
    if (selected === null || !clip) return;
    const newStart = Number((startPct * srcDuration).toFixed(3));
    const updated: GeneratedClip[] = clips.map((c, i) =>
      i === selected ? { ...c, startTime: newStart } : c
    );
    setGeneratedClips(updated);
    setTweakOverride(String(selected), {
      sourceFile: clip.sourceFile,
      startTime: newStart,
      duration: clip.duration,
    });
    setMode('none');
  }

  async function replaceClip() {
    if (selected === null || !clip) return;
    const paths = await window.electronAPI.selectVideos();
    if (paths.length === 0) return;
    const updated: GeneratedClip[] = clips.map((c, i) =>
      i === selected ? { ...c, sourceFile: paths[0], startTime: 0 } : c
    );
    setGeneratedClips(updated);
    setTweakOverride(String(selected), {
      sourceFile: paths[0],
      startTime: 0,
      duration: clip.duration,
    });
  }

  function onTrackDown(e: PointerEvent) {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    moveWindow(e);
  }
  function onTrackMove(e: PointerEvent) {
    if (dragging.current) moveWindow(e);
  }
  function onTrackUp() {
    dragging.current = false;
  }
  function moveWindow(e: PointerEvent) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = (e.clientX - rect.left) / rect.width;
    const left = Math.max(0, Math.min(1 - windowPct, center - windowPct / 2));
    setStartPct(left);
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
            Tweak — тонкая настройка
          </h2>
          <button className="text-text-secondary hover:text-text-primary" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Лента миниатюр фрагментов */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {clips.map((c, i) => (
            <button
              key={i}
              className="shrink-0"
              onClick={() => openClip(i)}
              style={{ outline: selected === i ? '2px solid var(--accent-green)' : 'none' }}
            >
              <div className="overflow-hidden rounded-el bg-bg-tertiary" style={{ width: 80, height: 60 }}>
                <video
                  src={mediaUrl(c.sourceFile)}
                  muted
                  preload="metadata"
                  className="h-full w-full object-cover"
                  onLoadedMetadata={(e) => {
                    if (c.startTime) e.currentTarget.currentTime = c.startTime;
                  }}
                />
              </div>
              <div className="mt-0.5 text-center text-text-secondary" style={{ fontSize: 11 }}>
                {formatTime(starts[i])}
              </div>
            </button>
          ))}
          {clips.length === 0 && (
            <span className="text-text-secondary" style={{ fontSize: 13 }}>
              Нет фрагментов
            </span>
          )}
        </div>

        {/* Нижняя часть: кнопки и режимы */}
        {clip && (
          <div className="mt-3 border-t border-border pt-3">
            {mode === 'none' && (
              <div className="flex gap-3">
                <button className="btn-primary px-5 py-2" onClick={openHighlight}>
                  Highlight
                </button>
                <button className="btn-secondary px-5 py-2" onClick={replaceClip}>
                  Replace
                </button>
              </div>
            )}

            {mode === 'highlight' && (
              <div>
                <p className="mb-2 text-text-secondary" style={{ fontSize: 13 }}>
                  Выберите диапазон исходного видео (перетащите окно)
                </p>
                {/* Filmstrip-вид: исходное видео + окно выбора */}
                <div
                  ref={trackRef}
                  className="relative w-full overflow-hidden rounded-el bg-bg-tertiary"
                  style={{ height: 64 }}
                  onPointerDown={onTrackDown}
                  onPointerMove={onTrackMove}
                  onPointerUp={onTrackUp}
                >
                  <video
                    src={mediaUrl(clip.sourceFile)}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover opacity-50"
                    onLoadedMetadata={(e) => setSrcDuration(e.currentTarget.duration || 0)}
                  />
                  {/* Окно выбора */}
                  <div
                    className="absolute top-0 h-full border-2"
                    style={{
                      left: `${startPct * 100}%`,
                      width: `${windowPct * 100}%`,
                      borderColor: 'var(--accent-green)',
                      backgroundColor: 'rgba(204,255,0,0.15)',
                    }}
                  />
                </div>
                <div className="mt-3 flex gap-3">
                  <button className="btn-primary px-5 py-2" onClick={applyHighlight}>
                    Применить
                  </button>
                  <button className="btn-secondary px-5 py-2" onClick={() => setMode('none')}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
