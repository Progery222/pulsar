import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { mediaUrl } from '../utils/media';
import { mixAudioTracks } from './audioMix';
import RecorderEditor from './RecorderEditor';
import type { Quality, RecorderSource, RecordingResult } from './types';

type Phase = 'setup' | 'countdown' | 'recording' | 'saving' | 'done' | 'prepping' | 'editor';

const QUALITY: Record<Quality, { label: string; w?: number; h?: number; bitrate: number }> = {
  '1080p': { label: '1080p', w: 1920, h: 1080, bitrate: 12_000_000 },
  '1440p': { label: '1440p (2K)', w: 2560, h: 1440, bitrate: 24_000_000 },
  '4k': { label: '2160p (4K)', w: 3840, h: 2160, bitrate: 40_000_000 },
  native: { label: 'Родное разрешение', bitrate: 25_000_000 },
};

function pickMime(): string {
  const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return cands.find((c) => MediaRecorder.isTypeSupported(c)) ?? 'video/webm';
}

export default function RecorderApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [phase, setPhase] = useState<Phase>('setup');
  const [sources, setSources] = useState<RecorderSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mic, setMic] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [webcam, setWebcam] = useState(false);
  const [quality, setQuality] = useState<Quality>('1080p');
  const [hideCursor, setHideCursor] = useState(false);
  const [useCountdown, setUseCountdown] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [saveProgress, setSaveProgress] = useState<number | null>(null);
  const [savedMp4, setSavedMp4] = useState<string | null>(null);
  const [prepPct, setPrepPct] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pauseStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const webcamRecRef = useRef<MediaRecorder | null>(null);
  const webcamChunksRef = useRef<Blob[]>([]);
  const webcamDoneRef = useRef<Promise<void> | null>(null);

  async function loadSources() {
    try {
      const list = await window.electronAPI.recorderGetSources();
      setSources(list);
      setSelectedId((cur) => cur ?? list.find((s) => s.type === 'screen')?.id ?? list[0]?.id ?? null);
    } catch (e) {
      showToast('Не удалось получить список источников: ' + (e as Error).message);
    }
  }

  useEffect(() => {
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Команды с плавающего контрола (стоп/пауза/продолжить).
  useEffect(() => {
    const off = window.electronAPI.onRecorderControlAction((action) => {
      if (action === 'stop') stopRecording();
      else if (action === 'resume') resumeRecording();
      else if (action === 'pause') {
        // Переключатель (для глобального хоткея): пауза ↔ продолжить.
        if (recorderRef.current?.state === 'paused') resumeRecording();
        else pauseRecording();
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupStreams() {
    for (const s of streamsRef.current) s.getTracks().forEach((t) => t.stop());
    streamsRef.current = [];
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function beginCapture() {
    if (!selectedId) return;
    await window.electronAPI.recorderSelectSource(selectedId);
    const q = QUALITY[quality];

    // Видео + (опц.) системный звук через наш display-media-handler.
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 60,
        cursor: hideCursor ? 'never' : 'always',
        ...(q.w && q.h ? { width: { ideal: q.w }, height: { ideal: q.h } } : {}),
      } as MediaTrackConstraints,
      audio: systemAudio,
    });
    streamsRef.current.push(displayStream);

    const videoTrack = displayStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    dimsRef.current = { w: settings.width ?? q.w ?? 1920, h: settings.height ?? q.h ?? 1080 };

    // Микрофон отдельным потоком.
    const audioStreams: MediaStream[] = [];
    if (systemAudio && displayStream.getAudioTracks().length) audioStreams.push(displayStream);
    if (mic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
        streamsRef.current.push(micStream);
        audioStreams.push(micStream);
      } catch {
        showToast('Микрофон недоступен — пишем без него');
      }
    }

    const tracks: MediaStreamTrack[] = [videoTrack];
    const mixed = mixAudioTracks(audioStreams);
    if (mixed) {
      audioCtxRef.current = mixed.ctx;
      tracks.push(mixed.track);
    }

    // Вебкамера — отдельный поток и отдельный рекордер (только видео, синхроним по старту).
    webcamChunksRef.current = [];
    webcamRecRef.current = null;
    if (webcam) {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        streamsRef.current.push(camStream);
        const camMime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
        const camRec = new MediaRecorder(camStream, { mimeType: camMime, videoBitsPerSecond: 6_000_000 });
        camRec.ondataavailable = (ev) => { if (ev.data.size > 0) webcamChunksRef.current.push(ev.data); };
        webcamDoneRef.current = new Promise<void>((res) => { camRec.onstop = () => res(); });
        webcamRecRef.current = camRec;
      } catch {
        showToast('Камера недоступна — пишем без неё');
      }
    }

    const recStream = new MediaStream(tracks);
    const mimeType = pickMime();
    const rec = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: q.bitrate });
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = onRecStop;
    recorderRef.current = rec;

    // Если пользователь остановил захват из системной плашки — трактуем как стоп.
    videoTrack.addEventListener('ended', () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') stopRecording();
    });

    await window.electronAPI.recorderCursorStart();
    await window.electronAPI.recorderMinimizeMain();
    await window.electronAPI.recorderOpenControl();

    startRef.current = Date.now();
    pausedMsRef.current = 0;
    rec.start(1000);
    webcamRecRef.current?.start(1000);
    setPhase('recording');
    setElapsed(0);
    timerRef.current = setInterval(() => {
      if (recorderRef.current?.state === 'paused') return;
      const secs = Math.floor((Date.now() - startRef.current - pausedMsRef.current) / 1000);
      setElapsed(secs);
      window.electronAPI.recorderPushState({ elapsed: secs, paused: false });
    }, 500);
  }

  async function startRecording() {
    if (!selectedId) {
      showToast('Выберите источник записи');
      return;
    }
    setSavedMp4(null);
    setResult(null);
    if (useCountdown) {
      setPhase('countdown');
      for (let n = 3; n >= 1; n--) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    try {
      await beginCapture();
    } catch (e) {
      cleanupStreams();
      setPhase('setup');
      showToast('Не удалось начать запись: ' + (e as Error).message);
    }
  }

  function pauseRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.pause();
      webcamRecRef.current?.state === 'recording' && webcamRecRef.current.pause();
      pauseStartRef.current = Date.now();
      window.electronAPI.recorderPushState({ elapsed, paused: true });
    }
  }

  function resumeRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state === 'paused') {
      pausedMsRef.current += Date.now() - pauseStartRef.current;
      rec.resume();
      webcamRecRef.current?.state === 'paused' && webcamRecRef.current.resume();
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      setPhase('saving');
      if (webcamRecRef.current && webcamRecRef.current.state !== 'inactive') webcamRecRef.current.stop();
      rec.stop(); // → onRecStop
    }
  }

  async function onRecStop() {
    const durationMs = Date.now() - startRef.current - pausedMsRef.current;
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    // Дождаться флаша вебкамеры до остановки треков.
    if (webcamDoneRef.current) {
      await Promise.race([webcamDoneRef.current, new Promise((r) => setTimeout(r, 2000))]);
    }
    const camBlob = webcamChunksRef.current.length ? new Blob(webcamChunksRef.current, { type: 'video/webm' }) : null;
    cleanupStreams();

    const cursorData = await window.electronAPI.recorderCursorStop();
    await window.electronAPI.recorderCloseControl();
    await window.electronAPI.recorderCloseNotes();
    await window.electronAPI.recorderRestoreMain();

    try {
      const buf = await blob.arrayBuffer();
      const saved = await window.electronAPI.recorderSaveWebm(buf);
      let webcamPath: string | undefined;
      if (camBlob) {
        const camBuf = await camBlob.arrayBuffer();
        const camSaved = await window.electronAPI.recorderSaveWebm(camBuf);
        webcamPath = camSaved.path;
      }
      setResult({
        webmPath: saved.path,
        webcamPath,
        durationMs,
        cursor: cursorData.samples,
        display: cursorData.display,
        width: dimsRef.current.w,
        height: dimsRef.current.h,
      });
      setPhase('done');
    } catch (e) {
      setPhase('setup');
      showToast('Ошибка сохранения записи: ' + (e as Error).message);
    }
  }

  async function saveAsMp4() {
    if (!result) return;
    const dir = await window.electronAPI.selectDirectory();
    if (!dir) return;
    const base = result.webmPath.split(/[\\/]/).pop()!.replace(/\.webm$/i, '.mp4');
    const outPath = `${dir}\\${base}`;
    setSaveProgress(0);
    const off = window.electronAPI.onRecorderMp4Progress((p) => setSaveProgress(p));
    const res = await window.electronAPI.recorderToMp4(result.webmPath, outPath);
    off();
    setSaveProgress(null);
    if ('error' in res) {
      showToast('Не удалось сохранить MP4: ' + res.error);
      return;
    }
    setSavedMp4(res.path);
    showToast('Сохранено: ' + res.path);
  }

  // Подготовка редактора: разово перегоняем запись в MP4 (корректная длительность/перемотка;
  // webm от MediaRecorder не имеет длительности → перемотка и экспорт в редакторе ломаются).
  async function openEditor() {
    if (!result) return;
    if (result.editPath) {
      setPhase('editor');
      return;
    }
    setPhase('prepping');
    setPrepPct(0);
    const tmp = result.webmPath.replace(/\.webm$/i, '-edit.mp4');
    const off = window.electronAPI.onRecorderMp4Progress((p) => setPrepPct(p));
    try {
      const res = await window.electronAPI.recorderToMp4(result.webmPath, tmp);
      if ('error' in res) {
        off();
        showToast('Не удалось подготовить запись: ' + res.error);
        setPhase('done');
        return;
      }
      // Вебкамеру тоже в mp4 (для перемотки/синхрона в редакторе).
      let webcamEditPath: string | undefined;
      if (result.webcamPath) {
        const camTmp = result.webcamPath.replace(/\.webm$/i, '-edit.mp4');
        const camRes = await window.electronAPI.recorderToMp4(result.webcamPath, camTmp);
        if (!('error' in camRes)) webcamEditPath = camRes.path;
      }
      off();
      setResult({ ...result, editPath: res.path, webcamEditPath });
      setPhase('editor');
    } catch (e) {
      off();
      showToast('Ошибка подготовки: ' + (e as Error).message);
      setPhase('done');
    }
  }

  // --- Рендер ---
  if (phase === 'countdown') {
    return (
      <div style={center}>
        <div style={{ fontSize: 120, fontWeight: 700, color: 'var(--accent-green)' }}>{countdown}</div>
      </div>
    );
  }

  if (phase === 'recording') {
    return (
      <div style={center}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#ff3b30' }} />
          <span style={{ fontSize: 40, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 6 }}>Идёт запись… управление — в плавающей панели снизу</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 20, opacity: 0.8 }}>Хоткеи: Ctrl+Alt+S — стоп · Ctrl+Alt+P — пауза</div>
        <button onClick={stopRecording} style={{ ...primaryBtn, background: '#ff3b30' }}>Остановить</button>
      </div>
    );
  }

  if (phase === 'saving') {
    return <div style={center}><div style={{ color: 'var(--text-secondary)' }}>Сохраняю запись…</div></div>;
  }

  if (phase === 'prepping') {
    return <div style={center}><div style={{ color: 'var(--text-secondary)' }}>Подготовка редактора… {prepPct}%</div></div>;
  }

  if (phase === 'editor' && result) {
    return <RecorderEditor result={result} onBack={() => setPhase('done')} />;
  }

  if (phase === 'done' && result) {
    return (
      <div style={{ ...pageWrap, alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', margin: '4px 0 16px' }}>Запись готова</h1>
        <video
          src={mediaUrl(result.webmPath)}
          controls
          style={{ maxWidth: 720, width: '100%', borderRadius: 12, background: '#000', border: '1px solid var(--border)' }}
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={openEditor} style={primaryBtn}>Открыть в редакторе (авто-зум)</button>
          <button onClick={saveAsMp4} style={secondaryBtn} disabled={saveProgress !== null}>
            {saveProgress !== null ? `Сохранение… ${saveProgress}%` : 'Сохранить как есть (MP4)'}
          </button>
          {savedMp4 && (
            <button onClick={() => window.electronAPI.recorderReveal(savedMp4)} style={secondaryBtn}>Показать в папке</button>
          )}
          <button onClick={() => { setPhase('setup'); loadSources(); }} style={secondaryBtn}>Записать ещё</button>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 14, textAlign: 'center', maxWidth: 620 }}>
          Собрано {result.cursor.length} точек курсора для авто-зума.
        </div>
      </div>
    );
  }

  // phase === 'setup'
  return (
    <div style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Запись экрана</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>Выберите, что записывать</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.electronAPI.recorderOpenNotes()} style={secondaryBtn}>Заметки</button>
          <button onClick={loadSources} style={secondaryBtn}>Обновить</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            style={{
              textAlign: 'left',
              padding: 8,
              borderRadius: 10,
              cursor: 'pointer',
              background: 'var(--bg-secondary)',
              border: `2px solid ${selectedId === s.id ? 'var(--accent-green)' : 'var(--border)'}`,
            }}
          >
            <img src={s.thumbnail} alt={s.name} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, background: '#000' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              {s.appIcon && <img src={s.appIcon} alt="" style={{ width: 16, height: 16 }} />}
              <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{s.type === 'screen' ? 'Экран' : 'Окно'}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center', marginBottom: 22 }}>
        <label style={optRow}>
          <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} /> Системный звук
        </label>
        <label style={optRow}>
          <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /> Микрофон
        </label>
        <label style={optRow}>
          <input type="checkbox" checked={webcam} onChange={(e) => setWebcam(e.target.checked)} /> Вебкамера
        </label>
        <label style={optRow}>
          <input type="checkbox" checked={useCountdown} onChange={(e) => setUseCountdown(e.target.checked)} /> Отсчёт 3 сек
        </label>
        <label style={optRow} title="Работает не на всех системах — курсор можно нарисовать в редакторе">
          <input type="checkbox" checked={hideCursor} onChange={(e) => setHideCursor(e.target.checked)} /> Скрыть системный курсор
        </label>
        <label style={{ ...optRow, gap: 8 }}>
          Качество
          <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} style={selectStyle}>
            {(Object.keys(QUALITY) as Quality[]).map((q) => (
              <option key={q} value={q}>{QUALITY[q].label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={startRecording} style={primaryBtn} disabled={!selectedId}>Начать запись</button>
        <button onClick={() => setAppMode('select')} style={secondaryBtn}>На главную</button>
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '28px 32px',
  background: 'var(--bg-primary)',
  display: 'flex',
  flexDirection: 'column',
};
const center: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-primary)',
};
const primaryBtn: React.CSSProperties = {
  padding: '10px 22px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent-green)',
  color: '#04120c',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  fontSize: 14,
  cursor: 'pointer',
};
const optRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 13.5,
  color: 'var(--text-primary)',
  cursor: 'pointer',
};
const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  fontSize: 13,
};
