import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { useUIStore } from '../store/uiStore';
import { mediaUrl } from '../utils/media';
import { MONTAGE_TEMPLATES, applyMontageTemplate } from './montageTemplates';
import {
  SCENE_TEMPLATES, TRANSITIONS,
  type SceneTemplate, type SceneSpec, type Transition,
} from './sceneTemplates';
import tracksData from '../data/tracks.json';

type Track = { id: string; title: string; file: string };
const trackById = (id?: string): Track | undefined =>
  id ? (tracksData as Track[]).find((x) => x.id === id) : undefined;

type Phase = 'gallery' | 'edit' | 'rendering' | 'done';
type Format = '9:16' | '1:1' | '16:9';

const FORMATS: Record<Format, { w: number; h: number; label: string; ratio: number }> = {
  '9:16': { w: 1080, h: 1920, label: '9:16 · Reels/TikTok', ratio: 9 / 16 },
  '1:1': { w: 1080, h: 1080, label: '1:1 · Пост', ratio: 1 },
  '16:9': { w: 1920, h: 1080, label: '16:9 · YouTube', ratio: 16 / 9 },
};

const ACCENTS = ['#ff5c8a', '#ccff00', '#00e5ff', '#a9d2ff', '#ffcc4d', '#7c5cff', '#3ad1c0', '#c8a26a', '#ffffff'];

// Прозрачный плейсхолдер-силуэт, пока в слот не загружено фото.
const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='560'>" +
      "<g fill='#3a3f48'><circle cx='200' cy='150' r='92'/>" +
      "<path d='M52 560 C52 372 118 292 200 292 C282 292 348 372 348 560 Z'/></g></svg>"
  );

// URL движка и шрифтов относительно корня приложения (dev http / prod file).
const RUNTIME_URL = new URL('templates/runtime.html', document.baseURI).href;
const FONTS_URL = new URL('fonts/', document.baseURI).href;
const sfxUrl = (n: string) => new URL(`templates/sfx/${n}.mp3`, document.baseURI).href;
// Переход → звук (совпадает с рендером): свайпы/вайпы/зеркало — whoosh, удар/глитч/зум — impact, вспышка — pop.
const TRANS_SFX_UI: Record<string, string | undefined> = {
  text: 'whoosh', wipe: 'whoosh', swipe: 'whoosh', swipeUp: 'whoosh', mirror: 'whoosh',
  zoom: 'impact', punch: 'impact', glitchcut: 'impact', flash: 'pop',
};

// Слот шаблона: фото (cutout-PNG) или видео-клип (путь + blob + длительность + трим-старт).
type Slot =
  | { kind: 'image'; src: string; orig: string }
  | { kind: 'video'; path: string; blob: string; dur: number; start: number }
  | null;
const fileUrl = (p: string) => encodeURI('file:///' + p.replace(/\\/g, '/'));

function sceneLabel(s: SceneSpec): string {
  switch (s.type) {
    case 'text': return s.text || 'текст';
    case 'cta': return s.cta || 'CTA';
    case 'photo': return `фото ${s.slot + 1}`;
    case 'cover': return s.text || `кадр ${s.slot + 1}`;
    case 'split': return s.caption || 'сплит';
    case 'stat': return s.text || 'цифра';
    case 'list': return s.title || 'список';
    case 'quote': return s.text || 'цитата';
    case 'beforeafter': return 'до/после';
    case 'price': return s.price || 'ценник';
    case 'countdown': return 'отсчёт';
  }
}
const SCENE_KIND: Record<SceneSpec['type'], string> = {
  text: 'текст', photo: 'фото', cover: 'кадр', split: 'сплит', stat: 'цифра', list: 'список', quote: 'цитата',
  beforeafter: 'до/после', price: 'ценник', countdown: 'отсчёт', cta: 'CTA',
};

export default function TemplatesApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);

  const [phase, setPhase] = useState<Phase>('gallery');
  const [tab, setTab] = useState<'scenes' | 'montage'>('scenes');

  // Выбранный сцена-шаблон + редактируемая копия сцен.
  const [tpl, setTpl] = useState<SceneTemplate | null>(null);
  const [scenes, setScenes] = useState<SceneSpec[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotBusy, setSlotBusy] = useState<number | null>(null);
  const [slotProg, setSlotProg] = useState(0);
  const [selIdx, setSelIdx] = useState(0);

  const [accent, setAccent] = useState('#ff5c8a');
  const [format, setFormat] = useState<Format>('9:16');
  const [musicPath, setMusicPath] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [clipAudio, setClipAudio] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Живое превью.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const playRef = useRef(false);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenesRef = useRef<SceneSpec[]>(scenes);
  const sfxRef = useRef<Record<string, HTMLAudioElement>>({});
  const lastSceneRef = useRef(0);
  const [sfxOn, setSfxOn] = useState(true);
  const sfxOnRef = useRef(true);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { sfxOnRef.current = sfxOn; }, [sfxOn]);
  useEffect(() => {
    const mk = (n: string) => { const a = new Audio(sfxUrl(n)); a.volume = 0.55; return a; };
    sfxRef.current = { whoosh: mk('whoosh'), impact: mk('impact'), pop: mk('pop') };
  }, []);
  // Музыка в живом превью через blob (media:// напрямую в <audio> в Electron ненадёжен).
  const [audioBlob, setAudioBlob] = useState<string | null>(null);
  useEffect(() => {
    if (!musicPath) { setAudioBlob(null); return; }
    let alive = true; let url: string | null = null;
    fetch(mediaUrl(musicPath)).then((r) => r.blob()).then((b) => { if (!alive) return; url = URL.createObjectURL(b); setAudioBlob(url); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [musicPath]);

  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<string | null>(null);
  const [renderErr, setRenderErr] = useState<string | null>(null);

  const totalDur = useMemo(() => scenes.reduce((s, sc) => s + sc.dur, 0) || 1, [scenes]);

  useEffect(() => {
    const off = window.electronAPI.onTemplateProgress((p) => setProgress(p));
    return off;
  }, []);

  // Данные для движка (то же, что уйдёт в рендер) — WYSIWYG. forRender: видео как
  // file:// (окно рендера грузит с диска), иначе blob: (живое превью в iframe).
  const engineData = useCallback(
    (forRender = false) => {
      const firstImg = slots.find((s): s is { kind: 'image'; src: string; orig: string } => !!s && s.kind === 'image');
      const mapSlot = (s: Slot) =>
        !s ? { i: PLACEHOLDER, o: PLACEHOLDER } : s.kind === 'image' ? { i: s.src, o: s.orig } : { v: forRender ? fileUrl(s.path) : s.blob, start: s.start, path: s.path };
      return { accent, subjectImage: firstImg?.src || PLACEHOLDER, slots: slots.map(mapSlot), scenes };
    },
    [accent, slots, scenes]
  );

  const seekEngine = useCallback((tt: number) => {
    const w = iframeRef.current?.contentWindow as unknown as { seek?: (t: number) => void } | null;
    w?.seek?.(tt);
  }, []);

  const pushToEngine = useCallback(() => {
    const w = iframeRef.current?.contentWindow as unknown as
      | { initTemplate?: (cfg: unknown) => void; seek?: (t: number) => void }
      | null;
    if (!w?.initTemplate) return;
    w.initTemplate({ id: 'scenes', dur: totalDur, fontsUrl: FONTS_URL, data: engineData() });
    w.seek?.(tRef.current);
  }, [engineData, totalDur]);

  // Перестроить превью при изменении контента (дебаунс для плавности при печати).
  useEffect(() => {
    if (!ready || phase !== 'edit') return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(pushToEngine, 120);
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
  }, [ready, phase, pushToEngine]);

  // Плеер реального времени.
  const loop = useCallback(
    (ts: number) => {
      if (playRef.current) {
        if (!lastTsRef.current) lastTsRef.current = ts;
        const dt = (ts - lastTsRef.current) / 1000;
        lastTsRef.current = ts;
        let nt = tRef.current + dt;
        if (nt >= totalDur) { nt = 0; if (audioRef.current) audioRef.current.currentTime = 0; }
        tRef.current = nt;
        setT(nt);
        seekEngine(nt);
        // SFX на входе в новую сцену (совпадает со стыком перехода).
        const sc = scenesRef.current;
        let idx = 0, acc = 0;
        for (let i = 0; i < sc.length; i++) { if (nt >= acc - 1e-6) idx = i; acc += sc[i].dur; }
        if (nt < 0.05) lastSceneRef.current = 0;
        else if (idx > lastSceneRef.current) {
          if (sfxOnRef.current) {
            const nm = sc[idx] ? TRANS_SFX_UI[sc[idx].trans] : undefined;
            const a = nm ? sfxRef.current[nm] : undefined;
            if (a) { try { a.currentTime = 0; void a.play(); } catch { /* noop */ } }
          }
          lastSceneRef.current = idx;
        }
      } else {
        lastTsRef.current = 0;
      }
      rafRef.current = requestAnimationFrame(loop);
    },
    [totalDur, seekEngine]
  );
  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  function togglePlay() {
    playRef.current = !playRef.current;
    setPlaying(playRef.current);
    const a = audioRef.current;
    if (a) {
      if (playRef.current) { try { a.currentTime = tRef.current; void a.play(); } catch { /* noop */ } }
      else a.pause();
    }
  }
  function scrub(v: number) {
    const nt = v * totalDur;
    tRef.current = nt;
    setT(nt);
    seekEngine(nt);
    if (audioRef.current) { try { audioRef.current.currentTime = nt; } catch { /* noop */ } }
  }

  function chooseTemplate(tt: SceneTemplate) {
    setTpl(tt);
    setScenes(tt.scenes.map((s) => ({ ...s })));
    setSlots(new Array(tt.slotCount).fill(null));
    setAccent(tt.accent);
    // Музыка-пресет шаблона (можно сменить в панели).
    const track = trackById(tt.music);
    setMusicPath(track?.file || null);
    setMusicName(track?.title || null);
    setSelIdx(0);
    tRef.current = 0;
    setT(0);
    playRef.current = false;
    setPlaying(false);
    setOutput(null);
    setRenderErr(null);
    setPhase('edit');
    // при первом заходе iframe уже мог быть готов — форсим пуш
    setTimeout(() => pushToEngine(), 60);
  }

  const doCutout = useCallback(async (file: File, slot: number) => {
    setSlotBusy(slot);
    setSlotProg(0);
    try {
      // Оригинал (с фоном) — для полноэкранных/сплит сцен; cutout — для сцен на дизайн-фоне.
      const orig = await new Promise<string>((res) => {
        const rd = new FileReader(); rd.onload = () => res(rd.result as string); rd.readAsDataURL(file);
      });
      const blob = await removeBackground(file, {
        progress: (_k, cur, total) => setSlotProg(total > 0 ? Math.round((cur / total) * 100) : 0),
        output: { format: 'image/png' },
      });
      const cut = await new Promise<string>((res) => {
        const rd = new FileReader(); rd.onload = () => res(rd.result as string); rd.readAsDataURL(blob);
      });
      setSlots((prev) => prev.map((s, i) => (i === slot ? { kind: 'image', src: cut, orig } : s)));
    } catch (e) {
      setRenderErr(e instanceof Error ? e.message : 'Ошибка удаления фона');
    } finally {
      setSlotBusy(null);
    }
  }, []);

  const addVideo = useCallback(async (file: File, slot: number) => {
    let p = '';
    try { p = window.electronAPI.getPathForFile(file); } catch { p = (file as File & { path?: string }).path || ''; }
    if (!p) { setRenderErr('Не удалось получить путь к видео'); return; }
    setSlotBusy(slot);
    setSlotProg(0);
    try {
      // blob для живого превью (media:// напрямую в <video> в Electron ненадёжен).
      const blob = await fetch(mediaUrl(p)).then((r) => r.blob());
      const url = URL.createObjectURL(blob);
      // Длительность клипа — для трима.
      const dur = await new Promise<number>((res) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => res(Number.isFinite(v.duration) ? v.duration : 0);
        v.onerror = () => res(0);
        v.src = url;
      });
      setSlots((prev) => prev.map((s, i) => (i === slot ? { kind: 'video', path: p, blob: url, dur, start: 0 } : s)));
    } catch {
      setRenderErr('Не удалось загрузить видео');
    } finally {
      setSlotBusy(null);
    }
  }, []);

  function pickSlot(slot: number, files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (f.type.startsWith('image/')) doCutout(f, slot);
    else if (f.type.startsWith('video/')) addVideo(f, slot);
  }

  async function pickMusic() {
    const p = await window.electronAPI.selectAudio();
    if (p) { setMusicPath(p); setMusicName(p.split(/[\\/]/).pop() || null); }
  }

  function patchScene(i: number, patch: Partial<SceneSpec>) {
    setScenes((prev) => prev.map((s, idx) => (idx === i ? ({ ...s, ...patch } as SceneSpec) : s)));
  }
  function setSlotStart(slotIdx: number, start: number) {
    setSlots((prev) => prev.map((s, i) => (i === slotIdx && s && s.kind === 'video' ? { ...s, start } : s)));
  }

  // Изменение длительности сцены перетаскиванием края на таймлайне.
  const tlRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ i: number; startX: number; startDur: number; pps: number } | null>(null);
  const onHandleMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dsec = (e.clientX - d.startX) / d.pps;
    const nd = Math.max(0.4, Math.min(6, Number((d.startDur + dsec).toFixed(1))));
    setScenes((prev) => prev.map((s, idx) => (idx === d.i ? { ...s, dur: nd } : s)));
  }, []);
  const onHandleUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onHandleMove);
    window.removeEventListener('pointerup', onHandleUp);
  }, [onHandleMove]);
  function onHandleDown(e: React.PointerEvent, i: number) {
    e.stopPropagation();
    e.preventDefault();
    const W = tlRef.current?.clientWidth || 1;
    dragRef.current = { i, startX: e.clientX, startDur: scenes[i].dur, pps: W / totalDur };
    window.addEventListener('pointermove', onHandleMove);
    window.addEventListener('pointerup', onHandleUp);
  }

  async function render() {
    if (!tpl) return;
    const filled = slots.filter(Boolean).length;
    if (filled < tpl.slotCount) {
      setRenderErr(`Загрузите все фото (${filled}/${tpl.slotCount})`);
      return;
    }
    const out = await window.electronAPI.proExportSavePath('mp4');
    if (!out) return;
    playRef.current = false;
    setPlaying(false);
    setPhase('rendering');
    setProgress(0);
    setRenderErr(null);
    const { w, h } = FORMATS[format];
    const res = await window.electronAPI.renderTemplate({
      templateId: 'scenes',
      data: engineData(true),
      width: w,
      height: h,
      fps: 30,
      durationSec: totalDur,
      outputPath: out,
      musicPath: musicPath || undefined,
      clipAudio,
    });
    if ('error' in res) {
      setRenderErr(res.error);
      setPhase('edit');
    } else {
      setOutput(res.path);
      setPhase('done');
    }
  }

  // ── Галерея ──
  if (phase === 'gallery') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <Header onHome={() => setAppMode('select')} title="Шаблоны" />
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
          <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-tertiary)', padding: 4, borderRadius: 10, marginBottom: 18 }}>
            {([['scenes', '🎬 Шаблоны'], ['montage', '🔥 Тренды']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: tab === k ? 'var(--accent-green)' : 'transparent', color: tab === k ? '#000' : 'var(--text-secondary)' }}>{label}</button>
            ))}
          </div>

          {tab === 'scenes' ? (
            <>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Многосценовые шаблоны с переходами. Выбери → загрузи фото по слотам → правь тексты/переходы вживую → рендер.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 16 }}>
                {SCENE_TEMPLATES.map((tt) => (
                  <button key={tt.key} onClick={() => chooseTemplate(tt)}
                    style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-secondary)', textAlign: 'left' }}>
                    <div style={{ position: 'relative' }}>
                      <video src={tt.preview} autoPlay loop muted playsInline
                        style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', display: 'block', background: '#000' }} />
                      <div style={{ position: 'absolute', bottom: 8, right: 8, padding: '2px 6px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', fontSize: 10.5, fontWeight: 600, color: '#fff' }}>{tt.scenes.length} сцен</div>
                    </div>
                    <div style={{ padding: '9px 11px' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{tt.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{tt.tag}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Выбери тренд → кинь свои ролики → соберётся монтаж под биты.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 16 }}>
                {MONTAGE_TEMPLATES.map((tt) => (
                  <button key={tt.id} onClick={() => applyMontageTemplate(tt)}
                    style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-secondary)', textAlign: 'left' }}>
                    <div style={{ position: 'relative' }}>
                      <video src={tt.preview} autoPlay loop muted playsInline
                        style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', display: 'block', background: '#000' }} />
                      <div style={{ position: 'absolute', bottom: 8, right: 8, padding: '2px 6px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', fontSize: 10.5, fontWeight: 600, color: '#fff' }}>{tt.duration}с</div>
                    </div>
                    <div style={{ padding: '9px 11px' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5 }}><span>{tt.icon}</span>{tt.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{tt.tag}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const sel = scenes[selIdx];
  const done = phase === 'done';

  // ── Редактор с живым превью ──
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <Header onHome={() => setAppMode('select')} title={tpl?.name || 'Шаблон'} onBack={done ? undefined : () => setPhase('gallery')} />
      <audio ref={audioRef} src={audioBlob || undefined} preload="auto" />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Живое превью + таймлайн */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {done && output ? (
              <video src={mediaUrl(output)} controls autoPlay loop style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: 12, background: '#000' }} />
            ) : (
              <div style={{ position: 'relative', height: '100%', aspectRatio: `${FORMATS[format].ratio}`, maxWidth: '100%', borderRadius: 12, overflow: 'hidden', background: '#000', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
                <iframe
                  ref={iframeRef}
                  src={RUNTIME_URL}
                  title="preview"
                  onLoad={() => { setReady(true); setTimeout(pushToEngine, 30); }}
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
                />
                {phase === 'rendering' && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <div style={{ width: '70%', height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-green)', transition: 'width .2s' }} />
                    </div>
                    <span style={{ color: '#fff', fontSize: 14 }}>{progress < 80 ? `Рендер кадров… ${progress}%` : progress < 100 ? 'Склейка + музыка…' : 'Готово'}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {!done && (
            <>
              {/* Транспорт */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={togglePlay} style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 15 }}>{playing ? '⏸' : '▶'}</button>
                <button onClick={() => setSfxOn((v) => !v)} title="Звук переходов" style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'var(--bg-tertiary)', color: sfxOn ? 'var(--accent-green)' : 'var(--text-secondary)', fontSize: 14 }}>{sfxOn ? '🔊' : '🔇'}</button>
                <input type="range" min={0} max={1000} value={Math.round((t / totalDur) * 1000)} onChange={(e) => scrub(Number(e.target.value) / 1000)} style={{ flex: 1, accentColor: 'var(--accent-green)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 74, textAlign: 'right' }}>{t.toFixed(1)} / {totalDur.toFixed(1)}с</span>
              </div>

              {/* Таймлайн сцен: блоки пропорционально длительности, метки переходов,
                  клик = выбрать/сик, перетаскивание правого края = длительность сцены */}
              <div ref={tlRef} style={{ display: 'flex', gap: 3, height: 58, position: 'relative' }}>
                {scenes.map((s, i) => {
                  const startAcc = scenes.slice(0, i).reduce((a, x) => a + x.dur, 0);
                  const active = i === selIdx;
                  return (
                    <button key={i}
                      onClick={() => { setSelIdx(i); scrub(startAcc / totalDur + 0.001); }}
                      title={`${sceneLabel(s)} · ${s.dur.toFixed(1)}с`}
                      style={{
                        flex: s.dur, minWidth: 0, position: 'relative', borderRadius: 8, cursor: 'pointer', textAlign: 'left', padding: '6px 8px', overflow: 'hidden',
                        border: active ? '2px solid var(--accent-green)' : '1px solid var(--border)',
                        background: s.type === 'photo' ? 'var(--bg-tertiary)' : s.type === 'cta' ? '#2a2030' : '#1c2436',
                        color: 'var(--text-primary)',
                      }}>
                      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)' }}>{SCENE_KIND[s.type]}{(s.type === 'photo' || s.type === 'cover') ? ` ${s.slot + 1}` : ''}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sceneLabel(s)}</div>
                      <div style={{ position: 'absolute', bottom: 3, left: 8, fontSize: 9, color: 'var(--text-secondary)' }}>{s.dur.toFixed(1)}с</div>
                      {i > 0 && <div style={{ position: 'absolute', top: 2, right: 4, fontSize: 8.5, color: 'var(--accent-green)' }}>⇥ {transLabel(s.trans)}</div>}
                      {/* Ручка изменения длительности */}
                      <div onPointerDown={(e) => onHandleDown(e, i)} title="Тянуть — длительность"
                        style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 9, cursor: 'col-resize', background: 'linear-gradient(90deg,transparent,rgba(204,255,0,0.5))' }} />
                    </button>
                  );
                })}
                {/* Playhead */}
                <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${(t / totalDur) * 100}%`, width: 2, background: 'var(--accent-green)', pointerEvents: 'none' }} />
              </div>
            </>
          )}
        </div>

        {/* Панель */}
        <div style={{ width: 360, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflowY: 'auto', padding: 18 }}>
          {done ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="font-semibold" style={{ fontSize: 16, color: 'var(--text-primary)' }}>Готово ✅</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Ролик сохранён.</p>
              {output && <button onClick={() => window.electronAPI.showItemInFolder(output)} style={btn(true)}>Показать в папке</button>}
              <button onClick={() => setPhase('edit')} style={btn(false)}>Изменить</button>
              <button onClick={() => setPhase('gallery')} style={btn(false)}>Другой шаблон</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Слоты медиа: фото (cutout) или видео-клип */}
              <Group label={`Медиа (${slots.filter(Boolean).length}/${slots.length})`}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {slots.map((s, i) => (
                    <label key={i} style={{ width: 72, height: 72, borderRadius: 10, border: `1px dashed ${s ? 'var(--accent-green)' : 'var(--border)'}`, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
                      {slotBusy === i ? (
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>✂️ {slotProg}%</span>
                      ) : !s ? (
                        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>＋<br />фото/видео</span>
                      ) : s.kind === 'image' ? (
                        <img src={s.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <>
                          <video src={s.blob} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 12 }}>🎬</span>
                        </>
                      )}
                      <input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={(e) => { pickSlot(i, e.target.files); e.target.value = ''; }} />
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Фото — фон убирается ИИ. Видео — играет во весь кадр сцены.</div>
              </Group>

              {/* Редактор выбранной сцены */}
              {sel && (
                <Group label={`Сцена ${selIdx + 1} · ${SCENE_KIND[sel.type]}`}>
                  {selIdx > 0 && (
                    <label style={{ display: 'block' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Переход входа</span>
                      <select value={sel.trans} onChange={(e) => patchScene(selIdx, { trans: e.target.value as Transition })}
                        style={selectStyle}>
                        {TRANSITIONS.map((tr) => <option key={tr.key} value={tr.key}>{tr.label}</option>)}
                      </select>
                    </label>
                  )}
                  {sel.type === 'text' && (
                    <>
                      <Field label="Надзаголовок" value={sel.kicker || ''} onChange={(v) => patchScene(selIdx, { kicker: v })} />
                      <Field label="Текст" value={sel.text} onChange={(v) => patchScene(selIdx, { text: v })} />
                    </>
                  )}
                  {sel.type === 'photo' && (
                    <>
                      <Field label="Подпись" value={sel.caption || ''} onChange={(v) => patchScene(selIdx, { caption: v })} />
                      <label style={{ display: 'block' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Слот медиа</span>
                        <select value={sel.slot} onChange={(e) => patchScene(selIdx, { slot: Number(e.target.value) })} style={selectStyle}>
                          {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                        </select>
                      </label>
                      {(() => {
                        const sl = slots[sel.slot];
                        if (!sl || sl.kind !== 'video') return null;
                        const max = Math.max(0, Number((sl.dur - sel.dur).toFixed(1)));
                        return (
                          <label style={{ display: 'block' }}>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Начало клипа · {sl.start.toFixed(1)}с {sl.dur ? `(клип ${sl.dur.toFixed(1)}с)` : ''}</span>
                            <input type="range" min={0} max={max} step={0.1} value={Math.min(sl.start, max)} disabled={max <= 0}
                              onChange={(e) => setSlotStart(sel.slot, Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent-green)' }} />
                          </label>
                        );
                      })()}
                    </>
                  )}
                  {sel.type === 'cta' && (
                    <>
                      <Field label="Заголовок" value={sel.title || ''} onChange={(v) => patchScene(selIdx, { title: v })} />
                      <Field label="Кнопка (CTA)" value={sel.cta || ''} onChange={(v) => patchScene(selIdx, { cta: v })} />
                    </>
                  )}
                  {sel.type === 'cover' && (
                    <>
                      <Field label="Надзаголовок" value={sel.kicker || ''} onChange={(v) => patchScene(selIdx, { kicker: v })} />
                      <Field label="Заголовок" value={sel.text || ''} onChange={(v) => patchScene(selIdx, { text: v })} />
                      <label style={{ display: 'block' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Слот медиа</span>
                        <select value={sel.slot} onChange={(e) => patchScene(selIdx, { slot: Number(e.target.value) })} style={selectStyle}>
                          {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                        </select>
                      </label>
                      {(() => {
                        const sl = slots[sel.slot];
                        if (!sl || sl.kind !== 'video') return null;
                        const max = Math.max(0, Number((sl.dur - sel.dur).toFixed(1)));
                        return (
                          <label style={{ display: 'block' }}>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Начало клипа · {sl.start.toFixed(1)}с</span>
                            <input type="range" min={0} max={max} step={0.1} value={Math.min(sl.start, max)} disabled={max <= 0}
                              onChange={(e) => setSlotStart(sel.slot, Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent-green)' }} />
                          </label>
                        );
                      })()}
                    </>
                  )}
                  {sel.type === 'split' && (
                    <>
                      <Field label="Подпись (центр)" value={sel.caption || ''} onChange={(v) => patchScene(selIdx, { caption: v })} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <label style={{ flex: 1 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Слева</span>
                          <select value={sel.slot} onChange={(e) => patchScene(selIdx, { slot: Number(e.target.value) })} style={selectStyle}>
                            {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                          </select>
                        </label>
                        <label style={{ flex: 1 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Справа</span>
                          <select value={sel.slot2} onChange={(e) => patchScene(selIdx, { slot2: Number(e.target.value) })} style={selectStyle}>
                            {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                          </select>
                        </label>
                      </div>
                    </>
                  )}
                  {sel.type === 'stat' && (
                    <>
                      <Field label="Сверху" value={sel.kicker || ''} onChange={(v) => patchScene(selIdx, { kicker: v })} />
                      <Field label="Цифра/слоган" value={sel.text} onChange={(v) => patchScene(selIdx, { text: v })} />
                      <Field label="Снизу" value={sel.caption || ''} onChange={(v) => patchScene(selIdx, { caption: v })} />
                    </>
                  )}
                  {sel.type === 'list' && (
                    <>
                      <Field label="Заголовок" value={sel.title || ''} onChange={(v) => patchScene(selIdx, { title: v })} />
                      <label style={{ display: 'block' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Пункты (по строке, до 4)</span>
                        <textarea value={sel.items.join('\n')} rows={4}
                          onChange={(e) => patchScene(selIdx, { items: e.target.value.split('\n').slice(0, 4) })}
                          style={{ width: '100%', marginTop: 3, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }} />
                      </label>
                    </>
                  )}
                  {sel.type === 'quote' && (
                    <>
                      <Field label="Цитата" value={sel.text} onChange={(v) => patchScene(selIdx, { text: v })} />
                      <Field label="Автор/подпись" value={sel.caption || ''} onChange={(v) => patchScene(selIdx, { caption: v })} />
                    </>
                  )}
                  {sel.type === 'beforeafter' && (
                    <>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <label style={{ flex: 1 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>«До»</span>
                          <select value={sel.slot} onChange={(e) => patchScene(selIdx, { slot: Number(e.target.value) })} style={selectStyle}>
                            {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                          </select>
                        </label>
                        <label style={{ flex: 1 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>«После»</span>
                          <select value={sel.slot2} onChange={(e) => patchScene(selIdx, { slot2: Number(e.target.value) })} style={selectStyle}>
                            {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                          </select>
                        </label>
                      </div>
                      <Field label="Метка «до»" value={sel.text || ''} onChange={(v) => patchScene(selIdx, { text: v })} />
                      <Field label="Метка «после»" value={sel.caption || ''} onChange={(v) => patchScene(selIdx, { caption: v })} />
                    </>
                  )}
                  {sel.type === 'price' && (
                    <>
                      <Field label="Название" value={sel.text || ''} onChange={(v) => patchScene(selIdx, { text: v })} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}><Field label="Старая цена" value={sel.old || ''} onChange={(v) => patchScene(selIdx, { old: v })} /></div>
                        <div style={{ flex: 1 }}><Field label="Цена" value={sel.price || ''} onChange={(v) => patchScene(selIdx, { price: v })} /></div>
                      </div>
                      <Field label="Бейдж скидки" value={sel.badge || ''} onChange={(v) => patchScene(selIdx, { badge: v })} />
                      <label style={{ display: 'block' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Фон (слот, опц.)</span>
                        <select value={sel.slot ?? -1} onChange={(e) => patchScene(selIdx, { slot: Number(e.target.value) < 0 ? undefined : Number(e.target.value) })} style={selectStyle}>
                          <option value={-1}>без фото</option>
                          {slots.map((_, i) => <option key={i} value={i}>Слот {i + 1}</option>)}
                        </select>
                      </label>
                    </>
                  )}
                  {sel.type === 'countdown' && (
                    <>
                      <label style={{ display: 'block' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Считать с · {sel.count ?? 3}</span>
                        <input type="range" min={1} max={9} step={1} value={sel.count ?? 3} onChange={(e) => patchScene(selIdx, { count: Number(e.target.value) })} style={{ width: '100%', accentColor: 'var(--accent-green)' }} />
                      </label>
                      <Field label="Подпись" value={sel.caption || ''} onChange={(v) => patchScene(selIdx, { caption: v })} />
                    </>
                  )}
                  <label style={{ display: 'block' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Длительность сцены · {sel.dur.toFixed(1)}с</span>
                    <input type="range" min={0.4} max={6} step={0.1} value={sel.dur} onChange={(e) => patchScene(selIdx, { dur: Number(e.target.value) })} style={{ width: '100%', accentColor: 'var(--accent-green)' }} />
                  </label>
                </Group>
              )}

              <Group label="Акцент">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ACCENTS.map((c) => (
                    <button key={c} onClick={() => setAccent(c)} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: accent === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
              </Group>
              <Group label="Формат">
                <div style={{ display: 'flex', gap: 8 }}>
                  {(Object.keys(FORMATS) as Format[]).map((f) => (
                    <button key={f} onClick={() => setFormat(f)} title={FORMATS[f].label} style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, background: format === f ? 'var(--accent-green)' : 'var(--bg-tertiary)', color: format === f ? '#000' : 'var(--text-primary)', border: 'none', cursor: 'pointer' }}>{f}</button>
                  ))}
                </div>
              </Group>
              <Group label="Музыка">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={pickMusic} style={btn(false)}>{musicPath ? 'Сменить трек' : 'Выбрать трек'}</button>
                  {musicPath && <button onClick={() => { setMusicPath(null); setMusicName(null); }} style={{ ...btn(false), width: 'auto', padding: '9px 12px' }}>✕</button>}
                </div>
                {musicPath && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, wordBreak: 'break-all' }}>♪ {musicName || musicPath.split(/[\\/]/).pop()}</div>}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={clipAudio} onChange={(e) => setClipAudio(e.target.checked)} style={{ accentColor: 'var(--accent-green)' }} />
                  Звук из видео-клипов
                </label>
              </Group>
              {renderErr && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{renderErr}</div>}
              <button onClick={render} disabled={phase === 'rendering'} style={{ ...btn(true), height: 44, fontSize: 15, opacity: phase === 'rendering' ? 0.6 : 1 }}>
                {phase === 'rendering' ? `Рендер… ${progress}%` : '✨ Сгенерировать'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const transLabel = (k: Transition): string => TRANSITIONS.find((x) => x.key === k)?.label.split(' ')[0] || k;

function Header({ title, onHome, onBack }: { title: string; onHome: () => void; onBack?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onHome} title="На главную" style={hbtn}>⌂</button>
        {onBack && <button onClick={onBack} title="К галерее" style={hbtn}>←</button>}
      </div>
      <span className="font-semibold" style={{ fontSize: 18, color: 'var(--accent-green)' }}>{title}</span>
      <div style={{ width: 36 }} />
    </div>
  );
}

const hbtn: React.CSSProperties = { width: 36, height: 36, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 18 };
const selectStyle: React.CSSProperties = { width: '100%', marginTop: 3, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13 };

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', marginTop: 3, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 13 }} />
    </label>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '9px 14px', borderRadius: 9, fontSize: 13.5, fontWeight: 600,
    cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent-green)' : 'transparent', color: primary ? '#0a0a0a' : 'var(--text-primary)',
  };
}
