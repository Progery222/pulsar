import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { shuffleMontage } from '../utils/regenerate';
import { mediaUrl } from '../utils/media';
import { FILTERS } from '../data/filters';
import VideoPreview from '../components/VideoPreview';
import Timeline from '../components/Timeline';
import ToolsPanel from '../components/ToolsPanel';
import EditPanel from '../components/EditPanel';
import FiltersPanel from '../components/FiltersPanel';
import ExportModal from '../components/ExportModal';
import type { EffectName, GeneratedClip } from '../types';

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

const EFFECT_WIN = 0.35; // длительность визуального проявления эффекта (сек)

export default function EditorScreen() {
  const format = useProjectStore((s) => s.format);
  const clips = useProjectStore((s) => s.generatedClips);
  const activeFilter = useProjectStore((s) => s.activeFilter);
  const filterIntensity = useProjectStore((s) => s.filterIntensity);
  const selectedTrack = useProjectStore((s) => s.selectedTrack);
  const segmentStart = useProjectStore((s) => s.segmentStart);
  const volumeOriginal = useProjectStore((s) => s.volumeOriginal);
  const volumeMusic = useProjectStore((s) => s.volumeMusic);
  const setVolumeOriginal = useProjectStore((s) => s.setVolumeOriginal);
  const setVolumeMusic = useProjectStore((s) => s.setVolumeMusic);
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
  const flashRef = useRef<HTMLDivElement>(null);
  const currentSrcRef = useRef<string>('');

  // Рефы для rAF-цикла (актуальные значения без устаревших замыканий).
  const clipsRef = useRef<GeneratedClip[]>(clips);
  const startsRef = useRef<number[]>([]);
  const totalRef = useRef<number>(1);
  const clipIndexRef = useRef<number>(0);
  const playingRef = useRef<boolean>(false);
  const globalFilterRef = useRef<string>('none');
  const segStartRef = useRef<number>(segmentStart);
  const scrubRef = useRef<number>(0);
  const lastScrubRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState(0);

  const starts = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const c of clips) {
      arr.push(acc);
      acc += c.duration;
    }
    return arr;
  }, [clips]);
  const totalDuration = useMemo(() => clips.reduce((s, c) => s + c.duration, 0) || 1, [clips]);

  const markers = useMemo(() => {
    const times: number[] = [];
    for (const c of clips) for (const slot of c.effectSlots) times.push(slot.time);
    return times.map((t) => Math.max(0, Math.min(1, t / totalDuration)));
  }, [clips, totalDuration]);

  const filterCss = useMemo(() => {
    if (!activeFilter || filterIntensity <= 0) return 'none';
    const css = FILTERS.find((f) => f.key === activeFilter)?.css ?? 'none';
    return scaleCssFilter(css, filterIntensity / 100);
  }, [activeFilter, filterIntensity]);

  // Синхронизация рефов со стейтом.
  useEffect(() => {
    clipsRef.current = clips;
    startsRef.current = starts;
    totalRef.current = totalDuration;
  }, [clips, starts, totalDuration]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    segStartRef.current = segmentStart;
  }, [segmentStart]);
  useEffect(() => {
    globalFilterRef.current = filterCss;
    const v = videoRef.current;
    if (v && !playingRef.current) {
      v.style.filter = filterCss === 'none' ? 'none' : filterCss;
      v.style.transform = '';
    }
  }, [filterCss]);

  // Громкости.
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volumeOriginal;
      v.muted = volumeOriginal <= 0;
    }
  }, [volumeOriginal, clips]);
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = volumeMusic;
  }, [volumeMusic, selectedTrack]);

  const syncAudio = useCallback((gt: number, force: boolean) => {
    const a = audioRef.current;
    if (!a) return;
    const want = segStartRef.current + gt;
    if (force || Math.abs(a.currentTime - want) > 0.25) {
      try {
        a.currentTime = want;
      } catch {
        /* noop */
      }
    }
  }, []);

  const positionToClip = useCallback((i: number, shouldPlay: boolean, offset: number) => {
    const v = videoRef.current;
    const clip = clipsRef.current[i];
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
  }, []);

  // Применение визуала эффекта к видео (filter/transform) + вспышка.
  const applyVisuals = useCallback((gt: number) => {
    const v = videoRef.current;
    if (!v) return;
    let eff: EffectName | null = null;
    let prog = 0;
    for (const c of clipsRef.current) {
      for (const s of c.effectSlots) {
        const dt = gt - s.time;
        if (dt >= 0 && dt < EFFECT_WIN) {
          eff = s.effect;
          prog = dt / EFFECT_WIN;
        }
      }
    }
    const base = globalFilterRef.current;
    let filter = base === 'none' ? '' : base;
    let transform = '';
    let flash = 0;
    const e = 1 - prog; // затухание к концу окна
    if (eff) {
      switch (eff) {
        case 'flash':
          flash = e;
          break;
        case 'zoom':
          transform = `scale(${(1 + 0.18 * e).toFixed(3)})`;
          break;
        case 'hue':
          filter += ` hue-rotate(${Math.round(prog * 360)}deg)`;
          break;
        case 'prism':
        case 'rgb':
          filter += ` saturate(${(1 + 2 * e).toFixed(2)}) contrast(${(1 + 0.4 * e).toFixed(2)})`;
          transform = `translateX(${((Math.random() * 4 - 2) * e).toFixed(1)}px)`;
          break;
        case 'boomerang':
          filter += ` hue-rotate(${Math.round(prog * 180)}deg)`;
          transform = `scaleX(${e > 0.5 ? -1 : 1})`;
          break;
        case 'split':
          transform = `scale(${(1 - 0.12 * e).toFixed(3)})`;
          break;
        case 'fastCut':
          flash = Math.floor(prog * 10) % 2 ? 0.35 : 0;
          break;
        case 'speed':
          // playbackRate управляется в loop()
          break;
      }
    }
    v.style.filter = filter.trim() || 'none';
    v.style.transform = transform;
    v.playbackRate = eff === 'speed' ? 2 : 1;
    if (flashRef.current) flashRef.current.style.opacity = String(flash);
  }, []);

  const advance = useCallback(() => {
    const idx = clipIndexRef.current;
    const next = idx + 1;
    if (next >= clipsRef.current.length) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      playingRef.current = false;
      setPlaying(false);
      clipIndexRef.current = 0;
      positionToClip(0, false, 0);
      scrubRef.current = 0;
      lastScrubRef.current = 0;
      setScrub(0);
      syncAudio(0, true);
      return;
    }
    clipIndexRef.current = next;
    positionToClip(next, true, 0);
    syncAudio(startsRef.current[next] ?? 0, true);
  }, [positionToClip, syncAudio]);

  // Главный цикл рендера превью (rAF) — плавный скраббер + эффекты.
  const loop = useCallback(() => {
    const v = videoRef.current;
    const cl = clipsRef.current;
    if (v && cl.length) {
      const idx = clipIndexRef.current;
      const clip = cl[idx];
      if (clip) {
        if (playingRef.current && !v.paused && v.currentTime >= clip.startTime + clip.duration - 0.03) {
          advance();
        } else {
          const gt = (startsRef.current[idx] ?? 0) + Math.max(0, v.currentTime - clip.startTime);
          applyVisuals(gt);
          const sv = Math.min(1, gt / totalRef.current);
          scrubRef.current = sv;
          if (Math.abs(sv - lastScrubRef.current) > 0.0015) {
            lastScrubRef.current = sv;
            setScrub(sv);
          }
          if (playingRef.current) syncAudio(gt, false);
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [advance, applyVisuals, syncAudio]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  // Сброс плеера при смене НАРЕЗКИ (не при смене только эффектов).
  const cutSigRef = useRef<string>('');
  useEffect(() => {
    const sig = clips.map((c) => `${c.sourceFile}|${c.startTime}|${c.duration}`).join(';');
    if (sig === cutSigRef.current) return;
    cutSigRef.current = sig;
    playingRef.current = false;
    setPlaying(false);
    clipIndexRef.current = 0;
    scrubRef.current = 0;
    lastScrubRef.current = 0;
    setScrub(0);
    currentSrcRef.current = '';
    positionToClip(0, false, 0);
    audioRef.current?.pause();
    syncAudio(0, true);
  }, [clips, positionToClip, syncAudio]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || clipsRef.current.length === 0) return;
    const a = audioRef.current;
    if (playingRef.current) {
      v.pause();
      a?.pause();
      playingRef.current = false;
      setPlaying(false);
    } else {
      syncAudio(scrubRef.current * totalRef.current, true);
      a?.play().catch(() => {});
      v.play()
        .then(() => {
          playingRef.current = true;
          setPlaying(true);
        })
        .catch(() => {});
    }
  }, [syncAudio]);

  useEffect(() => {
    setPlayToggle(togglePlay);
    return () => setPlayToggle(null);
  }, [togglePlay, setPlayToggle]);

  function onScrub(value: number) {
    const t = value * totalRef.current;
    let idx = clipsRef.current.length - 1;
    for (let i = 0; i < clipsRef.current.length; i++) {
      if (t >= startsRef.current[i] && t < startsRef.current[i] + clipsRef.current[i].duration) {
        idx = i;
        break;
      }
    }
    const offset = Math.max(0, t - (startsRef.current[idx] ?? 0));
    clipIndexRef.current = idx;
    scrubRef.current = value;
    lastScrubRef.current = value;
    setScrub(value);
    positionToClip(idx, playingRef.current, offset);
    syncAudio(t, true);
    applyVisuals(t);
  }

  function goHome() {
    if (window.confirm('Вернуться на главную? Прогресс будет потерян.')) setScreen('home');
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
        {/* Зона B */}
        <div className="flex min-h-0 flex-col" style={{ width: '60%' }}>
          <div className="min-h-0 flex-1 p-4">
            <VideoPreview
              videoRef={videoRef}
              flashRef={flashRef}
              format={format}
              hasClips={clips.length > 0}
              onEnded={advance}
            />
          </div>

          <div className="flex shrink-0 items-center justify-center gap-6 py-2">
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

          {/* Микс громкости видео/музыки */}
          <div className="flex shrink-0 items-center justify-center gap-8 px-6 pb-2">
            <div className="flex items-center gap-2 text-text-secondary" style={{ fontSize: 11 }}>
              <span>🎬 Видео</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volumeOriginal * 100)}
                onChange={(e) => setVolumeOriginal(Number(e.target.value) / 100)}
                className="w-24 accent-[var(--accent-green)]"
              />
            </div>
            <div className="flex items-center gap-2 text-text-secondary" style={{ fontSize: 11 }}>
              <span>🎵 Музыка</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volumeMusic * 100)}
                disabled={!selectedTrack}
                onChange={(e) => setVolumeMusic(Number(e.target.value) / 100)}
                className="w-24 accent-[var(--accent-green)]"
              />
            </div>
          </div>

          <div className="shrink-0 px-4 pb-4">
            <Timeline value={scrub} markers={markers} onChange={onScrub} />
          </div>

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

        {/* Зона C */}
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

      {selectedTrack && <audio ref={audioRef} src={mediaUrl(selectedTrack.file)} preload="auto" />}
      {showExport && <ExportModal />}
    </div>
  );
}
