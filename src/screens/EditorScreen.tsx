import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { shuffleMontage } from '../utils/regenerate';
import { mediaUrl } from '../utils/media';
import { FILTERS } from '../data/filters';
import VideoPreview from '../components/VideoPreview';
import Timeline from '../components/Timeline';
import ClipTimeline from '../components/ClipTimeline';
import ToolsPanel from '../components/ToolsPanel';
import EditPanel from '../components/EditPanel';
import FiltersPanel from '../components/FiltersPanel';
import ExportModal from '../components/ExportModal';
import type { EffectName } from '../types';

const CSS_BASELINE: Record<string, number> = {
  brightness: 1, contrast: 1, saturate: 1, grayscale: 0,
  sepia: 0, invert: 0, 'hue-rotate': 0, blur: 0, opacity: 1,
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

const EFFECT_WIN = 0.35;
const FADE_DUR = 0.5;

// Реальный split-эффект на canvas: 2×2 / зеркало / 2 полосы.
function drawSplit(canvas: HTMLCanvasElement, video: HTMLVideoElement, mode: string) {
  const W = video.clientWidth || canvas.clientWidth;
  const H = video.clientHeight || canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (mode === '2x2') {
    ctx.drawImage(video, 0, 0, W / 2, H / 2);
    ctx.drawImage(video, W / 2, 0, W / 2, H / 2);
    ctx.drawImage(video, 0, H / 2, W / 2, H / 2);
    ctx.drawImage(video, W / 2, H / 2, W / 2, H / 2);
  } else if (mode === 'vertical') {
    ctx.drawImage(video, 0, 0, W, H / 2);
    ctx.drawImage(video, 0, H / 2, W, H / 2);
  } else {
    // mirror: левая половина + зеркальная правая
    ctx.drawImage(video, 0, 0, W / 2, H);
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W / 2, H);
    ctx.restore();
  }
}

export default function EditorScreen() {
  const format = useProjectStore((s) => s.format);
  const clips = useProjectStore((s) => s.generatedClips);
  const activeFilter = useProjectStore((s) => s.activeFilter);
  const filterIntensity = useProjectStore((s) => s.filterIntensity);
  const fade = useProjectStore((s) => s.fade);
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

  const effectSettings = useProjectStore((s) => s.effectSettings);

  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioRef = useRef<HTMLAudioElement>(null);

  // Трек грузим в память как blob (как видео) — <audio src="media://"> в
  // Electron не проигрывается, а blob: работает надёжно.
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedTrack) {
      setAudioBlobUrl(null);
      return;
    }
    let alive = true;
    let created: string | null = null;
    fetch(mediaUrl(selectedTrack.file))
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        created = URL.createObjectURL(b);
        setAudioBlobUrl(created);
      })
      .catch((e) => console.error('[Editor] не загрузилась музыка', e));
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [selectedTrack]);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const fadeRef = useRef<HTMLDivElement | null>(null);
  const splitCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectSettingsRef = useRef(effectSettings);

  const startsRef = useRef<number[]>([]);
  const totalRef = useRef<number>(1);
  const clipIndexRef = useRef<number>(0);
  const playingRef = useRef<boolean>(false);
  const globalFilterRef = useRef<string>('none');
  const segStartRef = useRef<number>(segmentStart);
  const volOrigRef = useRef<number>(volumeOriginal);
  const fadeModeRef = useRef(fade);
  const scrubRef = useRef<number>(0);
  const lastScrubRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const activeSourceRef = useRef<string | null>(null);

  const clipsRef = useRef(clips);

  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState(0);
  const [activeSource, setActiveSource] = useState<string | null>(null);

  const distinctSources = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of clips) {
      if (!seen.has(c.sourceFile)) {
        seen.add(c.sourceFile);
        out.push(c.sourceFile);
      }
    }
    return out;
  }, [clips]);

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

  // Зеркалирование стейта в рефы.
  useEffect(() => {
    clipsRef.current = clips;
    startsRef.current = starts;
    totalRef.current = totalDuration;
  }, [clips, starts, totalDuration]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { segStartRef.current = segmentStart; }, [segmentStart]);
  useEffect(() => { volOrigRef.current = volumeOriginal; }, [volumeOriginal]);
  useEffect(() => { fadeModeRef.current = fade; }, [fade]);
  useEffect(() => { effectSettingsRef.current = effectSettings; }, [effectSettings]);
  useEffect(() => {
    globalFilterRef.current = filterCss;
    if (!playingRef.current && activeSourceRef.current) {
      const el = videosRef.current.get(activeSourceRef.current);
      if (el) {
        el.style.filter = filterCss === 'none' ? 'none' : filterCss;
        el.style.transform = '';
      }
    }
  }, [filterCss]);

  // Громкости: оригинал — на все видео, музыка — на аудио.
  useEffect(() => {
    videosRef.current.forEach((v) => {
      v.volume = volumeOriginal;
      v.muted = volumeOriginal <= 0;
    });
  }, [volumeOriginal, distinctSources, activeSource]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volumeMusic;
  }, [volumeMusic, selectedTrack]);

  const syncAudio = useCallback((gt: number, force: boolean) => {
    const a = audioRef.current;
    if (!a) return;
    const want = segStartRef.current + gt;
    if (force || Math.abs(a.currentTime - want) > 0.25) {
      try { a.currentTime = want; } catch { /* noop */ }
    }
  }, []);

  // Переключение на клип i: активируем нужный <video>, паузим остальные.
  const positionToClip = useCallback((i: number, shouldPlay: boolean, offset: number) => {
    const clip = clipsRef.current[i];
    if (!clip) return;
    const src = clip.sourceFile;
    videosRef.current.forEach((v, s) => {
      if (s !== src) {
        try { v.pause(); } catch { /* noop */ }
      }
    });
    activeSourceRef.current = src;
    setActiveSource(src);
    const el = videosRef.current.get(src);
    if (!el) return;
    el.volume = volOrigRef.current;
    el.muted = volOrigRef.current <= 0;
    el.style.transform = '';
    el.style.filter = globalFilterRef.current === 'none' ? 'none' : globalFilterRef.current;
    el.playbackRate = 1;
    try { el.currentTime = clip.startTime + offset; } catch { /* noop */ }
    if (shouldPlay) el.play().catch(() => {});
  }, []);

  const applyVisuals = useCallback((gt: number) => {
    const el = activeSourceRef.current ? videosRef.current.get(activeSourceRef.current) : null;
    if (!el) return;
    let eff: EffectName | null = null;
    let prog = 0;
    for (const c of clipsRef.current) {
      for (const s of c.effectSlots) {
        const dt = gt - s.time;
        if (dt >= 0 && dt < EFFECT_WIN) { eff = s.effect; prog = dt / EFFECT_WIN; }
      }
    }
    const base = globalFilterRef.current;
    let filter = base === 'none' ? '' : base;
    let transform = '';
    let flash = 0;
    let rate = 1;
    let splitMode: string | null = null;
    const e = 1 - prog;
    const set = eff ? effectSettingsRef.current[eff] : null;
    const k = set ? set.intensity / 100 : 0.5; // сила эффекта
    const variant = set?.variant ?? 'default';

    if (eff) {
      switch (eff) {
        case 'flash':
          if (variant === 'black') filter += ` brightness(${Math.max(0, 1 - e * k).toFixed(2)})`;
          else flash = e * k;
          break;
        case 'zoom': {
          const amount = 0.08 + 0.5 * k;
          if (variant === 'out') transform = `scale(${(1 + amount * e).toFixed(3)})`;
          else if (variant === 'punch') transform = `scale(${(1 + amount * Math.sin(prog * Math.PI)).toFixed(3)})`;
          else transform = `scale(${(1 + amount * prog).toFixed(3)})`; // in
          break;
        }
        case 'hue':
          filter += ` hue-rotate(${Math.round(prog * 360)}deg) saturate(${(1 + k).toFixed(2)})`;
          break;
        case 'prism':
        case 'rgb': {
          const j = (Math.random() * 8 - 4) * e * k;
          filter += ` saturate(${(1 + 2.5 * k * e).toFixed(2)}) contrast(${(1 + 0.5 * k * e).toFixed(2)})`;
          transform = `translateX(${j.toFixed(1)}px)`;
          break;
        }
        case 'boomerang':
          filter += ` hue-rotate(${Math.round(prog * 180)}deg)`;
          transform = `scaleX(${prog > 0.5 ? -1 : 1})`;
          break;
        case 'split':
          splitMode = variant;
          break;
        case 'fastCut': {
          const n = Math.round(4 + k * 10);
          const phase = Math.floor(prog * n);
          if (variant === 'strobe') {
            flash = phase % 2 ? 0.4 * k + 0.2 : 0;
          } else {
            // резкие кадры: рывками меняем масштаб/позицию
            const jx = ((phase * 53) % 13 - 6) * k;
            const jy = ((phase * 31) % 11 - 5) * k;
            transform = `scale(${(1 + 0.12 * k).toFixed(3)}) translate(${jx}px, ${jy}px)`;
            flash = phase % 2 ? 0.12 : 0;
          }
          break;
        }
        case 'speed': {
          const slow = 1 - 0.6 * k;
          const fast = 1 + 1.6 * k;
          if (variant === 'down') rate = fast + (slow - fast) * prog;
          else if (variant === 'constant') rate = 1 + 1.0 * k;
          else rate = slow + (fast - slow) * prog; // up (разгон)
          rate = Math.max(0.25, Math.min(4, rate));
          break;
        }
        case 'shake': {
          // Дрожание камеры: случайный сдвиг + лёгкий зум, затухает к концу окна.
          const amp = (6 + 10 * k) * e;
          const sx = (Math.random() - 0.5) * amp;
          const sy = (Math.random() - 0.5) * amp;
          transform = `scale(${(1 + 0.06 * e).toFixed(3)}) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          break;
        }
        case 'glitch': {
          // Глитч: подскок насыщенности/контраста + горизонтальный сдвиг.
          const j = (Math.random() - 0.5) * 14 * e * (0.5 + k);
          filter += ` saturate(${(1 + 1.5 * k * e).toFixed(2)}) contrast(${(1 + 0.6 * k * e).toFixed(2)})`;
          transform = `translateX(${j.toFixed(1)}px)`;
          flash = (Math.random() < 0.4 ? 0.15 : 0) * e;
          break;
        }
        case 'leak': {
          // Тёплая засветка: подъём яркости + тёплый сепия-оттенок.
          filter += ` brightness(${(1 + 0.25 * k * e).toFixed(2)}) sepia(${(0.35 * k * e).toFixed(2)}) saturate(${(1 + 0.3 * k * e).toFixed(2)})`;
          break;
        }
      }
    }

    // Split рисуем на canvas поверх видео.
    const canvas = splitCanvasRef.current;
    if (canvas) {
      if (splitMode && el.videoWidth) {
        drawSplit(canvas, el, splitMode);
        canvas.style.opacity = '1';
      } else {
        canvas.style.opacity = '0';
      }
    }

    el.style.filter = filter.trim() || 'none';
    el.style.transform = splitMode ? '' : transform;
    el.playbackRate = rate;
    if (flashRef.current) flashRef.current.style.opacity = String(Math.max(0, Math.min(1, flash)));

    // Live-превью fade in/out.
    let fadeOp = 0;
    const total = totalRef.current;
    const m = fadeModeRef.current;
    if ((m === 'in' || m === 'all') && gt < FADE_DUR) fadeOp = Math.max(fadeOp, 1 - gt / FADE_DUR);
    if ((m === 'out' || m === 'all') && gt > total - FADE_DUR) fadeOp = Math.max(fadeOp, (gt - (total - FADE_DUR)) / FADE_DUR);
    if (fadeRef.current) fadeRef.current.style.opacity = String(Math.max(0, Math.min(1, fadeOp)));
  }, []);

  const advance = useCallback(() => {
    const next = clipIndexRef.current + 1;
    if (next >= clipsRef.current.length) {
      videosRef.current.forEach((v) => { try { v.pause(); } catch { /* noop */ } });
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

  const loop = useCallback(() => {
    const cl = clipsRef.current;
    const el = activeSourceRef.current ? videosRef.current.get(activeSourceRef.current) : null;
    if (el && cl.length) {
      const idx = clipIndexRef.current;
      const clip = cl[idx];
      if (clip) {
        if (playingRef.current && !el.paused && el.currentTime >= clip.startTime + clip.duration - 0.03) {
          advance();
        } else {
          const gt = (startsRef.current[idx] ?? 0) + Math.max(0, el.currentTime - clip.startTime);
          applyVisuals(gt);
          const sv = Math.min(1, gt / totalRef.current);
          scrubRef.current = sv;
          if (Math.abs(sv - lastScrubRef.current) > 0.0015) { lastScrubRef.current = sv; setScrub(sv); }
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

  // Сброс при смене НАРЕЗКИ (не при смене только эффектов).
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
    // активируем первый клип после маунта видео-элементов.
    requestAnimationFrame(() => positionToClip(0, false, 0));
    audioRef.current?.pause();
    syncAudio(0, true);
  }, [clips, positionToClip, syncAudio]);

  const togglePlay = useCallback(() => {
    const el = activeSourceRef.current ? videosRef.current.get(activeSourceRef.current) : null;
    if (!el || clipsRef.current.length === 0) return;
    const a = audioRef.current;
    if (playingRef.current) {
      el.pause();
      a?.pause();
      playingRef.current = false;
      setPlaying(false);
    } else {
      syncAudio(scrubRef.current * totalRef.current, true);
      a?.play().catch(() => {});
      el.play().then(() => { playingRef.current = true; setPlaying(true); }).catch(() => {});
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
      if (t >= startsRef.current[i] && t < startsRef.current[i] + clipsRef.current[i].duration) { idx = i; break; }
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
        <span className="font-semibold text-accent-green" style={{ fontSize: 20 }}>Pulsar</span>
        <button
          className="btn-primary"
          style={{ width: 120, height: 36, borderRadius: 18, fontSize: 14 }}
          onClick={() => setShowExport(true)}
        >
          Сохранить
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-col" style={{ width: '60%' }}>
          <div className="min-h-0 flex-1 p-4">
            <VideoPreview
              videosRef={videosRef}
              sources={distinctSources}
              activeSource={activeSource}
              flashRef={flashRef}
              fadeRef={fadeRef}
              splitCanvasRef={splitCanvasRef}
              format={format}
              hasClips={clips.length > 0}
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

          <div className="flex shrink-0 items-center justify-center gap-8 px-6 pb-2">
            <div className="flex items-center gap-2 text-text-secondary" style={{ fontSize: 11 }}>
              <span>🎬 Видео</span>
              <input
                type="range" min={0} max={100}
                value={Math.round(volumeOriginal * 100)}
                onChange={(e) => setVolumeOriginal(Number(e.target.value) / 100)}
                className="w-24 accent-[var(--accent-green)]"
              />
            </div>
            <div className="flex items-center gap-2 text-text-secondary" style={{ fontSize: 11 }}>
              <span>🎵 Музыка</span>
              <input
                type="range" min={0} max={100}
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

          <div className="shrink-0">
            <ClipTimeline />
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
                {exportProgress < 85
                  ? `Рендеринг... ${Math.round(exportProgress)}%`
                  : exportProgress < 95
                    ? 'Применяем уникализацию...'
                    : 'Финализация файла...'}
              </span>
              <button className="btn-secondary px-3 py-1" style={{ fontSize: 13 }} onClick={cancelExport}>
                Отмена
              </button>
            </div>
          )}
        </div>

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

      {selectedTrack && audioBlobUrl && <audio ref={audioRef} src={audioBlobUrl} preload="auto" />}
      {showExport && <ExportModal />}
    </div>
  );
}
