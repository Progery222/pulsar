import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { shuffleMontage } from '../utils/regenerate';
import { mediaUrl } from '../utils/media';
import { EFFECTS } from '../data/effects';
import { FILTERS } from '../data/filters';
import VideoPreview from '../components/VideoPreview';
import Timeline from '../components/Timeline';
import ToolsPanel from '../components/ToolsPanel';
import EditPanel from '../components/EditPanel';
import FiltersPanel from '../components/FiltersPanel';
import ExportModal from '../components/ExportModal';

// Масштабирование CSS-фильтра по интенсивности k (0..1): значения тянутся к нейтрали.
const CSS_BASELINE: Record<string, number> = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  'hue-rotate': 0,
  blur: 0,
  opacity: 1,
};

function scaleCssFilter(css: string, k: number): string {
  if (css === 'none') return 'none';
  if (k >= 1) return css;
  return css.replace(/([a-z-]+)\(([-\d.]+)(deg|px|%)?\)/g, (_m, fn: string, val: string, unit?: string) => {
    const base = CSS_BASELINE[fn] ?? 0;
    const scaled = base + (parseFloat(val) - base) * k;
    return `${fn}(${Number(scaled.toFixed(3))}${unit ?? ''})`;
  });
}

export default function EditorScreen() {
  const format = useProjectStore((s) => s.format);
  const clips = useProjectStore((s) => s.generatedClips);
  const activeFilter = useProjectStore((s) => s.activeFilter);
  const filterIntensity = useProjectStore((s) => s.filterIntensity);
  const selectedTrack = useProjectStore((s) => s.selectedTrack);
  const segmentStart = useProjectStore((s) => s.segmentStart);
  const setScreen = useProjectStore((s) => s.setCurrentScreen);
  const isExporting = useProjectStore((s) => s.isExporting);
  const exportProgress = useProjectStore((s) => s.exportProgress);
  const setIsExporting = useProjectStore((s) => s.setIsExporting);

  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const showExport = useUIStore((s) => s.showExport);
  const setShowExport = useUIStore((s) => s.setShowExport);
  const setPlayToggle = useUIStore((s) => s.setPlayToggle);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentSrcRef = useRef<string>('');

  // Синхронизация трека-аудио с позицией монтажа (segmentStart — смещение по треку).
  const syncAudio = useCallback(
    (gt: number, force: boolean) => {
      const a = audioRef.current;
      if (!a) return;
      const want = segmentStart + gt;
      if (force || Math.abs(a.currentTime - want) > 0.3) {
        try {
          a.currentTime = want;
        } catch {
          /* noop */
        }
      }
    },
    [segmentStart]
  );

  const [clipIndex, setClipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [globalTime, setGlobalTime] = useState(0);

  // Накопительные старты клипов и общая длительность монтажа.
  const starts = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const c of clips) {
      arr.push(acc);
      acc += c.duration;
    }
    return arr;
  }, [clips]);
  const totalDuration = useMemo(
    () => clips.reduce((s, c) => s + c.duration, 0) || 1,
    [clips]
  );

  // Маркеры битов с эффектами (Блок 1.3 — позиции из beatData.beat_times).
  const markers = useMemo(() => {
    const times: number[] = [];
    for (const c of clips) for (const slot of c.effectSlots) times.push(slot.time);
    return times.map((t) => Math.max(0, Math.min(1, t / totalDuration)));
  }, [clips, totalDuration]);

  // Живой CSS-фильтр превью (Блок 2 — FILTERS виден на плеере, с учётом интенсивности).
  const filterCss = useMemo(() => {
    if (!activeFilter || filterIntensity <= 0) return 'none';
    const css = FILTERS.find((f) => f.key === activeFilter)?.css ?? 'none';
    return scaleCssFilter(css, filterIntensity / 100);
  }, [activeFilter, filterIntensity]);

  // Текстовый оверлей эффекта (Блок 2.3 — превью EDIT в моменты битов).
  const overlayLabel = useMemo(() => {
    for (const c of clips) {
      for (const slot of c.effectSlots) {
        if (Math.abs(globalTime - slot.time) < 0.25) {
          return EFFECTS.find((e) => e.key === slot.effect)?.label ?? null;
        }
      }
    }
    return null;
  }, [clips, globalTime]);

  // Позиционирование <video> на нужный клип/время.
  const positionToClip = useCallback(
    (i: number, shouldPlay: boolean, offset: number) => {
      const v = videoRef.current;
      const clip = clips[i];
      if (!v || !clip) return;
      const want = mediaUrl(clip.sourceFile);
      const target = clip.startTime + offset;
      if (currentSrcRef.current !== want) {
        currentSrcRef.current = want;
        v.src = want;
        const onLoaded = () => {
          try {
            v.currentTime = target;
          } catch {
            /* noop */
          }
          if (shouldPlay) v.play().catch(() => {});
          v.removeEventListener('loadeddata', onLoaded);
        };
        v.addEventListener('loadeddata', onLoaded);
        v.load();
      } else {
        try {
          v.currentTime = target;
        } catch {
          /* noop */
        }
        if (shouldPlay) v.play().catch(() => {});
      }
    },
    [clips]
  );

  // При смене НАРЕЗКИ монтажа — сброс к первому клипу. Если изменились только
  // эффекты (effectSlots) — плеер не сбрасываем (Блок 2: не прерывать просмотр).
  const cutSigRef = useRef<string>('');
  useEffect(() => {
    const sig = clips.map((c) => `${c.sourceFile}|${c.startTime}|${c.duration}`).join(';');
    if (sig === cutSigRef.current) return;
    cutSigRef.current = sig;
    setClipIndex(0);
    setPlaying(false);
    setGlobalTime(0);
    currentSrcRef.current = '';
    positionToClip(0, false, 0);
    audioRef.current?.pause();
    syncAudio(0, true);
  }, [clips, positionToClip, syncAudio]);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || clips.length === 0) return;
    const idx = clipIndex;
    const clip = clips[idx];
    if (!clip) return;
    // Переход к следующему фрагменту по достижении его конца.
    if (v.currentTime >= clip.startTime + clip.duration - 0.05) {
      const next = idx + 1;
      if (next >= clips.length) {
        v.pause();
        audioRef.current?.pause();
        setPlaying(false);
        setClipIndex(0);
        setGlobalTime(0);
        positionToClip(0, false, 0);
        syncAudio(0, true);
        return;
      }
      setClipIndex(next);
      positionToClip(next, true, 0);
      setGlobalTime(starts[next]);
      syncAudio(starts[next], false);
      return;
    }
    const gt = starts[idx] + (v.currentTime - clip.startTime);
    setGlobalTime(gt);
    syncAudio(gt, false);
  }

  function handleEnded() {
    // Конец исходного файла раньше расчётного — переходим дальше.
    handleTimeUpdate();
  }

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || clips.length === 0) return;
    const a = audioRef.current;
    if (playing) {
      v.pause();
      a?.pause();
      setPlaying(false);
    } else {
      syncAudio(globalTime, true);
      a?.play().catch(() => {});
      v.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [playing, clips.length, globalTime, syncAudio]);

  // Регистрируем Play/Pause для горячей клавиши Space.
  useEffect(() => {
    setPlayToggle(togglePlay);
    return () => setPlayToggle(null);
  }, [togglePlay, setPlayToggle]);

  // Перемотка по таймлайну (Блок 1.2).
  function onScrub(value: number) {
    const t = value * totalDuration;
    let idx = clips.length - 1;
    for (let i = 0; i < clips.length; i++) {
      if (t >= starts[i] && t < starts[i] + clips[i].duration) {
        idx = i;
        break;
      }
    }
    const offset = Math.max(0, t - starts[idx]);
    setClipIndex(idx);
    setGlobalTime(t);
    positionToClip(idx, playing, offset);
    syncAudio(t, true);
  }

  function goHome() {
    if (window.confirm('Вернуться на главную? Прогресс будет потерян.')) {
      setScreen('home');
    }
  }

  function cancelExport() {
    window.electronAPI.cancelRender();
    setIsExporting(false);
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary">
      {/* Зона A — Верхняя панель */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-4"
        style={{ height: 52 }}
      >
        <button
          className="flex h-9 w-9 items-center justify-center rounded-el text-text-primary hover:bg-bg-tertiary"
          title="На главную"
          onClick={goHome}
        >
          ⌂
        </button>
        <span className="font-semibold text-accent-green" style={{ fontSize: 20 }}>
          Beatleap
        </span>
        <button
          className="btn-primary"
          style={{ width: 120, height: 36, borderRadius: 18, fontSize: 14 }}
          onClick={() => setShowExport(true)}
        >
          Сохранить
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Зона B — Preview + Timeline */}
        <div className="flex min-h-0 flex-col" style={{ width: '60%' }}>
          <div className="min-h-0 flex-1 p-4">
            <VideoPreview
              videoRef={videoRef}
              format={format}
              filterCss={filterCss}
              overlayLabel={overlayLabel}
              hasClips={clips.length > 0}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
            />
          </div>

          <div className="flex shrink-0 items-center justify-center gap-6 py-3">
            <button
              className="flex items-center justify-center rounded-full bg-bg-tertiary text-text-primary"
              style={{ width: 40, height: 40 }}
              onClick={togglePlay}
              title="Play / Pause"
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button
              className="flex items-center justify-center rounded-full text-text-primary hover:bg-bg-tertiary"
              style={{ width: 36, height: 36 }}
              onClick={() => setScreen('music')}
              title="Сменить трек"
            >
              ♪
            </button>
            <button
              className="flex items-center justify-center rounded-full text-text-primary hover:bg-bg-tertiary"
              style={{ width: 36, height: 36 }}
              onClick={shuffleMontage}
              title="Перемешать монтаж"
            >
              ⤮
            </button>
          </div>

          <div className="shrink-0 px-4 pb-4">
            <Timeline value={globalTime / totalDuration} markers={markers} onChange={onScrub} />
          </div>

          {/* Нижняя панель прогресса экспорта (§11) */}
          {isExporting && (
            <div className="flex shrink-0 items-center gap-3 border-t border-border bg-bg-secondary px-4 py-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${exportProgress}%`, backgroundColor: 'var(--accent-green)' }}
                />
              </div>
              <span className="text-text-primary" style={{ fontSize: 13 }}>
                Рендеринг... {Math.round(exportProgress)}%
              </span>
              <button className="btn-secondary px-3 py-1" style={{ fontSize: 13 }} onClick={cancelExport}>
                Отмена
              </button>
            </div>
          )}
        </div>

        {/* Зона C — Правая панель */}
        <div className="flex min-h-0 flex-col bg-bg-secondary" style={{ width: '40%' }}>
          <div className="flex shrink-0 border-b border-border" style={{ height: 44 }}>
            {(['tools', 'edit', 'filters'] as const).map((tab) => {
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  className="flex-1 font-semibold uppercase"
                  style={{
                    fontSize: 13,
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderBottom: active ? '2px solid var(--accent-green)' : '2px solid transparent',
                  }}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'tools' && <ToolsPanel />}
            {activeTab === 'edit' && <EditPanel />}
            {activeTab === 'filters' && <FiltersPanel />}
          </div>
        </div>
      </div>

      {/* Аудио выбранного трека — синхронно с превью монтажа */}
      {selectedTrack && <audio ref={audioRef} src={mediaUrl(selectedTrack.file)} preload="auto" />}

      {showExport && <ExportModal />}
    </div>
  );
}
