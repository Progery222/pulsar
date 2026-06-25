import { useEffect, useState } from 'react';
import { showToast } from '../store/toastStore';
import { useQueueStore } from '../store/queueStore';

const LANGS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
];

const ENGINES = [
  { value: 'edge', label: 'Edge TTS (живые нейроголоса, бесплатно, без ключа)' },
  { value: 'xtts', label: 'XTTS-v2 (многоязычный, клонирование)' },
  { value: 'silero', label: 'Silero (рус/англ, лёгкий)' },
  { value: 'gptsovits', label: 'GPT-SoVITS (топ рус-клонирование, через сервер)' },
];

// Естественные нейроголоса Edge по языкам.
const EDGE_VOICES: Record<string, { value: string; label: string }[]> = {
  ru: [
    { value: 'ru-RU-SvetlanaNeural', label: 'Светлана (ж)' },
    { value: 'ru-RU-DariyaNeural', label: 'Дария (ж)' },
    { value: 'ru-RU-DmitryNeural', label: 'Дмитрий (м)' },
  ],
  en: [
    { value: 'en-US-AriaNeural', label: 'Aria (ж)' },
    { value: 'en-US-JennyNeural', label: 'Jenny (ж)' },
    { value: 'en-US-GuyNeural', label: 'Guy (м)' },
    { value: 'en-GB-RyanNeural', label: 'Ryan UK (м)' },
  ],
  es: [{ value: 'es-ES-ElviraNeural', label: 'Elvira (ж)' }, { value: 'es-ES-AlvaroNeural', label: 'Álvaro (м)' }],
  de: [{ value: 'de-DE-KatjaNeural', label: 'Katja (ж)' }, { value: 'de-DE-ConradNeural', label: 'Conrad (м)' }],
  fr: [{ value: 'fr-FR-DeniseNeural', label: 'Denise (ж)' }, { value: 'fr-FR-HenriNeural', label: 'Henri (м)' }],
};

// Раздел «Озвучка»: текст → речь, опционально наложить на видео.
export default function TtsApp() {
  const [text, setText] = useState('');
  const [lang, setLang] = useState('ru');
  const [engine, setEngine] = useState('edge');
  const [voice, setVoice] = useState('');
  const [speed, setSpeed] = useState(1);
  const [speakerWav, setSpeakerWav] = useState('');
  const [promptText, setPromptText] = useState('');
  const [apiUrl, setApiUrl] = useState('http://127.0.0.1:9880');
  const [outputDir, setOutputDir] = useState('');
  const [attachVideo, setAttachVideo] = useState('');
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);

  // Короткая фраза-пример по языку.
  const SAMPLE_TEXT: Record<string, string> = {
    ru: 'Привет! Это пример голоса в Pulsar.',
    en: 'Hi! This is a voice sample in Pulsar.',
    es: '¡Hola! Esta es una muestra de voz en Pulsar.',
    de: 'Hallo! Das ist eine Sprachprobe in Pulsar.',
    fr: 'Salut ! Ceci est un exemple de voix dans Pulsar.',
  };

  async function playSample() {
    if (sampling) return;
    setSampling(true);
    try {
      const r = await window.electronAPI.ttsSample({
        text: SAMPLE_TEXT[lang] ?? SAMPLE_TEXT.en,
        lang,
        engine,
        speed,
        voice: engine === 'edge' ? voice || undefined : undefined,
        speakerWav: speakerWav || undefined,
        promptText: engine === 'gptsovits' ? promptText || undefined : undefined,
        apiUrl: engine === 'gptsovits' ? apiUrl || undefined : undefined,
      });
      if ('error' in r) {
        showToast(`Не удалось создать пример: ${r.error}`);
      } else {
        const audio = new Audio(`media:///${encodeURIComponent(r.out)}`);
        audio.play().catch(() => showToast('Не удалось воспроизвести пример'));
      }
    } finally {
      setSampling(false);
    }
  }

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
  async function pickSpeaker() {
    const a = await window.electronAPI.selectAudio();
    if (a) setSpeakerWav(a);
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
        engine,
        speed,
        voice: engine === 'edge' ? voice || undefined : undefined,
        speakerWav: speakerWav || undefined,
        promptText: engine === 'gptsovits' ? promptText || undefined : undefined,
        apiUrl: engine === 'gptsovits' ? apiUrl || undefined : undefined,
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
          title: `Озвучка • ${engine} • ${lang}`,
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

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px 48px' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)', marginBottom: 8 }}>
          Озвучка
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Текст → речь. Можно сразу наложить на видео. Движок выбирается ниже.
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
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={field}>
              {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Движок</label>
            <select value={engine} onChange={(e) => { setEngine(e.target.value); setVoice(''); }} style={field}>
              {ENGINES.map((en) => <option key={en.value} value={en.value}>{en.label}</option>)}
            </select>
          </div>
        </div>

        {engine === 'edge' && (EDGE_VOICES[lang] ?? []).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Голос</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} style={field}>
              <option value="">По умолчанию</option>
              {(EDGE_VOICES[lang] ?? []).map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <button
            onClick={playSample}
            disabled={sampling}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', opacity: sampling ? 0.5 : 1 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M8 5v14l11-7z" />
            </svg>
            {sampling ? 'Генерирую пример…' : 'Прослушать пример'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 10 }}>
            короткая фраза текущим движком и голосом
          </span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Скорость: {speed.toFixed(2)}×</label>
          <input type="range" min={0.5} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
        </div>

        {(engine === 'xtts' || engine === 'gptsovits') && (
          <div style={{ marginBottom: 16 }}>
            <label style={label}>
              Образец голоса для клонирования {engine === 'gptsovits' ? '(обязательно, 3–10 сек)' : '(опц., аудиофайл)'}
            </label>
            <button onClick={pickSpeaker} style={{ ...field, textAlign: 'left', cursor: 'pointer', color: speakerWav ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {speakerWav ? speakerWav.split(/[\\/]/).pop() : 'Выбрать аудио-образец…'}
            </button>
          </div>
        )}

        {engine === 'gptsovits' && (
          <div style={{ marginBottom: 16, padding: 14, border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={label}>Расшифровка образца (что говорят в образце)</label>
              <input value={promptText} onChange={(e) => setPromptText(e.target.value)} placeholder="Текст из аудио-образца" style={field} />
            </div>
            <label style={label}>Адрес сервера GPT-SoVITS</label>
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://127.0.0.1:9880" style={field} />
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
              Требуется запущенный сервер GPT-SoVITS (его <code>api.py</code>). Лучшее клонирование русского голоса.
            </p>
          </div>
        )}

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
          Движок ставится в «Настройках → Установка движков». Edge TTS — самые живые голоса бесплатно (<code>pip install edge-tts</code>, онлайн).
          XTTS — лучшее качество + клонирование (оффлайн). Прогресс виден в окне «Очередь».
        </p>
      </div>
    </div>
  );
}
