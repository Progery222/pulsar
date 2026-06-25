import { useEffect, useState } from 'react';
import { showToast } from '../store/toastStore';
import { useQueueStore } from '../store/queueStore';
import { EDGE_VOICES } from './edgeVoices';

const LANGS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'uk', label: 'Українська' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'pl', label: 'Polski' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh', label: '中文' },
];

// Естественные нейроголоса Edge по языкам.
// Каталог голосов вынесен в общий модуль (используется и в Дубляже, и в Воронке).
export { EDGE_VOICES };

const SAMPLE_TEXT: Record<string, string> = {
  ru: 'Привет! Это пример голоса в Pulsar.',
  en: 'Hi! This is a voice sample in Pulsar.',
  uk: 'Привіт! Це приклад голосу в Pulsar.',
  es: '¡Hola! Esta es una muestra de voz en Pulsar.',
  de: 'Hallo! Das ist eine Sprachprobe in Pulsar.',
  fr: 'Salut ! Ceci est un exemple de voix dans Pulsar.',
};

// Раздел «Озвучка» на Edge TTS: текст → речь, опционально наложить на видео.
export default function TtsApp() {
  const [text, setText] = useState('');
  const [lang, setLang] = useState('ru');
  const [voice, setVoice] = useState('');
  const [speed, setSpeed] = useState(1);
  const [outputDir, setOutputDir] = useState('');
  const [attachVideo, setAttachVideo] = useState('');
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);

  useEffect(() => {
    window.electronAPI.getSetting('defaultOutputDir').then((d) => {
      if (d) setOutputDir(d as string);
    });
  }, []);

  async function pickFolder() {
    const d = await window.electronAPI.selectDirectory();
    if (d) setOutputDir(d);
  }
  async function pickVideo() {
    const v = await window.electronAPI.selectVideos();
    if (v.length) setAttachVideo(v[0]);
  }

  async function playSample() {
    if (sampling) return;
    setSampling(true);
    try {
      const r = await window.electronAPI.ttsSample({
        text: SAMPLE_TEXT[lang] ?? SAMPLE_TEXT.en,
        lang,
        engine: 'edge',
        speed,
        voice: voice || undefined,
      });
      if ('error' in r) showToast(`Не удалось создать пример: ${r.error}`);
      else new Audio(`media:///${encodeURIComponent(r.out)}`).play().catch(() => showToast('Не удалось воспроизвести'));
    } finally {
      setSampling(false);
    }
  }

  async function generate() {
    if (!text.trim() || !outputDir || busy) return;
    setBusy(true);
    const id = `tts_${Date.now()}`;
    const name = text.trim().slice(0, 40).replace(/\s+/g, '_') || 'voice';
    const queue = useQueueStore.getState();
    queue.addJobs([{ id, mode: 'editor', name: `Озвучка • ${name}`, status: 'processing', percent: 50 }]);
    try {
      const r = await window.electronAPI.ttsSynth({
        text,
        lang,
        engine: 'edge',
        speed,
        voice: voice || undefined,
        outputDir,
        outName: name,
        attachVideo: attachVideo || undefined,
        keepOriginal,
        originalVolume: 0.15,
      });
      if ('error' in r) {
        queue.updateJob(id, { status: 'error', percent: 0, error: r.error });
        showToast(`Ошибка: ${r.error}`);
      } else {
        queue.updateJob(id, { status: 'done', percent: 100 });
        window.electronAPI.historyAdd({
          id,
          mode: 'editor',
          title: `Озвучка • ${lang}${voice ? ' • ' + voice : ''}`,
          createdAt: Date.now(),
          outputDir,
          files: [r.out.split(/[\\/]/).pop() || ''],
          settings: null,
        });
        showToast('Готово!', { actionLabel: 'Открыть папку', onAction: () => window.electronAPI.openFolder(outputDir) });
      }
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 14,
  };
  const label: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' };
  const voices = EDGE_VOICES[lang] ?? [];

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px 48px' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)', marginBottom: 8 }}>
          Озвучка
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Текст → речь живыми нейроголосами (Edge TTS, бесплатно). Можно сразу наложить на видео.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Введите текст для озвучки…"
          rows={6}
          style={{ ...field, resize: 'vertical', marginBottom: 16, lineHeight: 1.5 }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={label}>Язык</label>
            <select value={lang} onChange={(e) => { setLang(e.target.value); setVoice(''); }} style={field}>
              {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Голос ({voices.length})</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} style={field}>
              <option value="">По умолчанию</option>
              {voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <button
            onClick={playSample}
            disabled={sampling}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', opacity: sampling ? 0.5 : 1 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>
            {sampling ? 'Генерирую пример…' : 'Прослушать пример'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 10 }}>
            короткая фраза этим голосом
          </span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Скорость: {speed.toFixed(2)}×</label>
          <input type="range" min={0.5} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
        </div>

        <div style={{ marginBottom: 16, padding: 14, border: '1px solid var(--border)', borderRadius: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!attachVideo} onChange={(e) => { if (!e.target.checked) setAttachVideo(''); else pickVideo(); }} />
            Наложить озвучку на видео
          </label>
          {attachVideo && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>{attachVideo.split(/[\\/]/).pop()}</p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
                Оставить оригинальный звук (приглушённо), а не заменять
              </label>
            </>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={label}>Папка сохранения</label>
          <button onClick={pickFolder} style={{ ...field, textAlign: 'left', cursor: 'pointer', color: outputDir ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {outputDir || 'Выбрать папку…'}
          </button>
        </div>

        <button
          onClick={generate}
          disabled={!text.trim() || !outputDir || busy}
          className="btn-primary"
          style={{ padding: '12px 28px', fontSize: 15, opacity: !text.trim() || !outputDir || busy ? 0.4 : 1 }}
        >
          {busy ? 'Генерация…' : 'Озвучить'}
        </button>

        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 20, lineHeight: 1.5 }}>
          Движок Edge TTS ставится в «Настройках → Установка движков» (<code>pip install edge-tts</code>, онлайн). Прогресс — в окне «Очередь».
        </p>
      </div>
    </div>
  );
}
