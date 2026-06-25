import { useEffect, useState } from 'react';
import { showToast } from '../store/toastStore';
import { EDGE_VOICES } from '../tts/TtsApp';

const SRC_LANGS = [
  { value: 'auto', label: 'Авто-определение' },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'uk', label: 'Українська' },
];

const TGT_LANGS = [
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
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
];

// Раздел «Дубляж»: видео → распознавание речи → перевод → озвучка на другом языке → склейка.
export default function DubApp() {
  const [videoPath, setVideoPath] = useState('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const [voice, setVoice] = useState('');
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [syncTiming, setSyncTiming] = useState(true);
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [percent, setPercent] = useState(0);
  const [needTranslate, setNeedTranslate] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    window.electronAPI.getSetting('defaultOutputDir').then((d) => d && setOutputDir(d as string));
    const off = window.electronAPI.onDubProgress((e) => {
      setStage(e.stage);
      setPercent(e.percent);
    });
    return off;
  }, []);

  async function pickVideo() {
    const v = await window.electronAPI.selectVideos();
    if (v.length) setVideoPath(v[0]);
  }
  async function pickFolder() {
    const d = await window.electronAPI.selectDirectory();
    if (d) setOutputDir(d);
  }

  async function run() {
    if (!videoPath || !outputDir || busy) return;
    setBusy(true);
    setNeedTranslate(false);
    setStage('Запуск…');
    setPercent(0);
    try {
      const r = await window.electronAPI.dubRun({
        videoPath,
        sourceLang,
        targetLang,
        voice: voice || undefined,
        keepOriginal,
        originalVolume: 0.12,
        syncTiming,
        outputDir,
      });
      if ('error' in r) {
        if (/deep-translator/i.test(r.error)) setNeedTranslate(true);
        showToast(`Ошибка: ${r.error}`);
        setStage('');
      } else {
        window.electronAPI.historyAdd({
          id: `dub_${Date.now()}`,
          mode: 'cleaner',
          title: `Дубляж • ${sourceLang}→${targetLang}`,
          createdAt: Date.now(),
          outputDir,
          files: [r.out.split(/[\\/]/).pop() || ''],
          settings: null,
        });
        showToast('Дубляж готов!', { actionLabel: 'Открыть папку', onAction: () => window.electronAPI.openFolder(outputDir) });
        setStage('Готово');
      }
    } finally {
      setBusy(false);
    }
  }

  async function installTranslate() {
    setInstalling(true);
    const r = await window.electronAPI.setupInstall('translate');
    setInstalling(false);
    if ('error' in r) showToast(`Не удалось установить: ${r.error}`);
    else {
      setNeedTranslate(false);
      showToast('Модуль перевода установлен');
    }
  }

  const field: React.CSSProperties = {
    width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 14,
  };
  const label: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' };
  const voices = EDGE_VOICES[targetLang] ?? [];

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px 48px' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)', marginBottom: 8 }}>
          Дубляж
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Видео → распознавание речи → перевод → озвучка на другом языке → подкладка под видео по таймингам.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Видео</label>
          <button onClick={pickVideo} style={{ ...field, textAlign: 'left', cursor: 'pointer', color: videoPath ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {videoPath ? videoPath.split(/[\\/]/).pop() : 'Выбрать видео…'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={label}>Язык оригинала</label>
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} style={field}>
              {SRC_LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Перевести на</label>
            <select value={targetLang} onChange={(e) => { setTargetLang(e.target.value); setVoice(''); }} style={field}>
              {TGT_LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Голос дубляжа ({voices.length})</label>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} style={field}>
            <option value="">По умолчанию</option>
            {voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
          Оставить оригинальный звук приглушённо (эффект закадрового перевода)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
          <input type="checkbox" checked={syncTiming} onChange={(e) => setSyncTiming(e.target.checked)} />
          Синхронизация: подгонять длину фраз под исходные тайминги
        </label>

        <div style={{ marginBottom: 20 }}>
          <label style={label}>Папка сохранения</label>
          <button onClick={pickFolder} style={{ ...field, textAlign: 'left', cursor: 'pointer', color: outputDir ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {outputDir || 'Выбрать папку…'}
          </button>
        </div>

        {needTranslate && (
          <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--danger)', borderRadius: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>Нужен модуль перевода (deep-translator).</div>
            <button onClick={installTranslate} disabled={installing} className="btn-primary" style={{ padding: '7px 16px', fontSize: 13, opacity: installing ? 0.5 : 1 }}>
              {installing ? 'Установка…' : 'Установить перевод'}
            </button>
          </div>
        )}

        <button
          onClick={run}
          disabled={!videoPath || !outputDir || busy}
          className="btn-primary"
          style={{ padding: '12px 28px', fontSize: 15, opacity: !videoPath || !outputDir || busy ? 0.4 : 1 }}
        >
          {busy ? 'Дублирую…' : 'Дублировать'}
        </button>

        {(busy || stage) && (
          <div style={{ marginTop: 20 }}>
            <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, background: 'var(--accent-green)', transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{stage} {percent ? `· ${percent}%` : ''}</div>
          </div>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 20, lineHeight: 1.5 }}>
          Нужен ключ AssemblyAI (Настройки) для распознавания речи и движок Edge TTS. Перевод — бесплатный (deep-translator).
        </p>
      </div>
    </div>
  );
}
