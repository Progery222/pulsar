import { useEffect, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';

type Scene = { text: string; keywords: string[]; clipUrl?: string; clipPreview?: string };
type Clip = { source: string; previewUrl: string; downloadUrl: string; width: number; height: number; duration: number };
type Phase = 'setup' | 'script' | 'generating' | 'done';

const LANGS = [
  { code: 'ru', label: 'Русский', voice: 'ru-RU-DmitryNeural' },
  { code: 'en', label: 'English', voice: 'en-US-GuyNeural' },
  { code: 'es', label: 'Español', voice: 'es-ES-AlvaroNeural' },
  { code: 'de', label: 'Deutsch', voice: 'de-DE-ConradNeural' },
  { code: 'fr', label: 'Français', voice: 'fr-FR-HenriNeural' },
];
const VOICES: Record<string, string[]> = {
  ru: ['ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural', 'ru-RU-DariyaNeural'],
  en: ['en-US-GuyNeural', 'en-US-JennyNeural', 'en-US-AriaNeural'],
  es: ['es-ES-AlvaroNeural', 'es-ES-ElviraNeural'],
  de: ['de-DE-ConradNeural', 'de-DE-KatjaNeural'],
  fr: ['fr-FR-HenriNeural', 'fr-FR-DeniseNeural'],
};

export default function AiVideoApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [phase, setPhase] = useState<Phase>('setup');
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState('portrait');
  const [lang, setLang] = useState('ru');
  const [seconds, setSeconds] = useState(40);
  const [sceneCount, setSceneCount] = useState(5);
  const [voice, setVoice] = useState('ru-RU-DmitryNeural');
  const [subtitles, setSubtitles] = useState(true);
  const [title, setTitle] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState(0);
  const [outPath, setOutPath] = useState<string | null>(null);
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
  const [clips, setClips] = useState<Record<number, Clip[]>>({});
  // Ключи
  const [keys, setKeys] = useState({ pexels: '', pixabay: '', openrouter: '' });
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    window.electronAPI.aiVideoGetKeys().then((k) => {
      setKeys(k);
      if (!k.pexels && !k.pixabay) setShowKeys(true);
    });
  }, []);

  function setLangAndVoice(code: string) {
    setLang(code);
    setVoice(LANGS.find((l) => l.code === code)?.voice ?? voice);
  }

  async function saveKeys() {
    await window.electronAPI.aiVideoSetKeys({ pexels: keys.pexels.trim(), pixabay: keys.pixabay.trim() });
    showToast('Ключи сохранены');
    setShowKeys(false);
  }

  async function genScript() {
    if (!topic.trim()) { showToast('Введите тему'); return; }
    setBusy(true);
    try {
      const res = await window.electronAPI.aiVideoScript(topic.trim(), { lang, seconds, scenes: sceneCount });
      if ('error' in res) { showToast('Сценарий: ' + res.error); return; }
      setTitle(res.title);
      setScenes(res.scenes.map((s) => ({ text: s.text, keywords: s.keywords })));
      setPhase('script');
    } catch (e) {
      showToast('Ошибка: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchScene(i: number) {
    const q = scenes[i].keywords[0] || topic;
    setSearchingIdx(i);
    try {
      const res = await window.electronAPI.aiVideoSearchClips(q, format);
      if ('error' in res && (!res.clips || !res.clips.length)) { showToast('Клипы: ' + res.error); return; }
      setClips((c) => ({ ...c, [i]: res.clips }));
    } finally {
      setSearchingIdx(null);
    }
  }

  function pickClip(i: number, clip: Clip) {
    setScenes((prev) => prev.map((s, k) => (k === i ? { ...s, clipUrl: clip.downloadUrl, clipPreview: clip.previewUrl } : s)));
  }

  async function generate() {
    const out = await window.electronAPI.proExportSavePath('mp4');
    if (!out) return;
    setOutPath(out);
    setPhase('generating');
    setBusy(true);
    setPct(0);
    const off = window.electronAPI.onAiVideoProgress((ev) => { setStage(ev.stage); setPct(ev.percent); });
    try {
      const res = await window.electronAPI.aiVideoGenerate({
        scenes: scenes.map((s) => ({ text: s.text, keywords: s.keywords, clipUrl: s.clipUrl })),
        lang, voice, format, outputPath: out, subtitles,
      });
      if ('error' in res) { showToast('Сборка: ' + res.error); setPhase('script'); return; }
      setPhase('done');
    } catch (e) {
      showToast('Ошибка сборки: ' + (e as Error).message);
      setPhase('script');
    } finally {
      off();
      setBusy(false);
    }
  }

  // --- Ключи-панель ---
  const keysPanel = showKeys && (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>API-ключи</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        Нужны бесплатные ключи стока: <b>Pexels</b> (pexels.com/api) и/или <b>Pixabay</b> (pixabay.com/api/docs). Ключ LLM берётся из «Воронки» (OpenRouter){keys.openrouter ? ' — задан ✓' : ' — не задан!'}.
      </div>
      <input value={keys.pexels} onChange={(e) => setKeys({ ...keys, pexels: e.target.value })} placeholder="Pexels API key" style={inp} />
      <input value={keys.pixabay} onChange={(e) => setKeys({ ...keys, pixabay: e.target.value })} placeholder="Pixabay API key" style={{ ...inp, marginTop: 8 }} />
      <button onClick={saveKeys} style={{ ...btnPrimary, marginTop: 10 }}>Сохранить ключи</button>
    </div>
  );

  if (phase === 'generating') {
    return (
      <div style={center}>
        <div style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 10 }}>{stage || 'Генерация…'}</div>
        <div style={{ width: 360, height: 8, borderRadius: 999, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-green)', borderRadius: 999, transition: 'width .3s' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>{pct}%</div>
        <button onClick={() => window.electronAPI.aiVideoCancel()} style={{ ...btnSecondary, marginTop: 16 }}>Отмена</button>
      </div>
    );
  }

  if (phase === 'done' && outPath) {
    return (
      <div style={{ ...pageWrap, alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>Ролик готов</h1>
        <video src={`media:///${encodeURIComponent(outPath)}`} controls style={{ maxWidth: 420, width: '100%', borderRadius: 12, background: '#000', border: '1px solid var(--border)' }} />
        <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => window.electronAPI.showItemInFolder(outPath)} style={btnPrimary}>Показать в папке</button>
          <button onClick={() => setPhase('script')} style={btnSecondary}>К сценарию</button>
          <button onClick={() => { setPhase('setup'); setScenes([]); }} style={btnSecondary}>Новый ролик</button>
        </div>
      </div>
    );
  }

  if (phase === 'script') {
    return (
      <div style={pageWrap}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title || 'Сценарий'}</h1>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '3px 0 0' }}>Отредактируйте текст сцен, при желании подберите клипы. Пустой клип — подберётся автоматически.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPhase('setup')} style={btnSecondary}>Назад</button>
            <button onClick={generate} disabled={busy || !scenes.length} style={btnPrimary}>Собрать ролик</button>
          </div>
        </div>

        {scenes.map((sc, i) => (
          <div key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--accent-green)', marginBottom: 4 }}>Сцена {i + 1}</div>
                <textarea value={sc.text} onChange={(e) => setScenes((p) => p.map((s, k) => (k === i ? { ...s, text: e.target.value } : s)))} style={{ ...inp, minHeight: 54, resize: 'vertical' }} />
                <input value={sc.keywords.join(', ')} onChange={(e) => setScenes((p) => p.map((s, k) => (k === i ? { ...s, keywords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } : s)))} placeholder="ключевые слова (EN) для стока" style={{ ...inp, marginTop: 8, fontSize: 12 }} />
              </div>
              <div style={{ width: 120, flexShrink: 0 }}>
                {sc.clipPreview ? (
                  <img src={sc.clipPreview} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--accent-green)' }} />
                ) : (
                  <div style={{ width: '100%', height: 90, borderRadius: 8, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', padding: 6 }}>Авто-подбор</div>
                )}
                <button onClick={() => searchScene(i)} disabled={searchingIdx === i} style={{ ...btnSecondary, width: '100%', marginTop: 6, fontSize: 11.5, padding: '6px 8px' }}>{searchingIdx === i ? 'Ищу…' : 'Подобрать клип'}</button>
              </div>
            </div>
            {clips[i] && clips[i].length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {clips[i].map((c, k) => (
                  <img key={k} src={c.previewUrl} alt="" onClick={() => pickClip(i, c)} style={{ width: 84, height: 60, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0, border: `2px solid ${sc.clipUrl === c.downloadUrl ? 'var(--accent-green)' : 'transparent'}` }} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // setup
  return (
    <div style={pageWrap}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>AI-ролик по теме</h1>
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 18 }}>Тема → сценарий (AI) → сток-видео → озвучка → субтитры → готовый ролик.</p>

      {keysPanel}
      {!showKeys && <button onClick={() => setShowKeys(true)} style={{ ...btnSecondary, marginBottom: 14, fontSize: 12.5 }}>API-ключи (Pexels/Pixabay)</button>}

      <textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Тема ролика (напр.: 5 фактов о космосе)" style={{ ...inp, minHeight: 70, fontSize: 15, marginBottom: 14 }} />

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 20 }}>
        <label style={fieldLbl}>Формат
          <select value={format} onChange={(e) => setFormat(e.target.value)} style={sel}>
            <option value="portrait">9:16 (Reels/Shorts)</option>
            <option value="square">1:1</option>
            <option value="landscape">16:9</option>
          </select>
        </label>
        <label style={fieldLbl}>Язык
          <select value={lang} onChange={(e) => setLangAndVoice(e.target.value)} style={sel}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label style={fieldLbl}>Голос
          <select value={voice} onChange={(e) => setVoice(e.target.value)} style={sel}>
            {(VOICES[lang] ?? [voice]).map((v) => <option key={v} value={v}>{v.split('-').slice(2).join('-')}</option>)}
          </select>
        </label>
        <label style={fieldLbl}>Длина, с
          <input type="number" min={15} max={120} value={seconds} onChange={(e) => setSeconds(Math.max(15, Math.min(120, Math.floor(Number(e.target.value) || 40))))} style={{ ...sel, width: 80 }} />
        </label>
        <label style={fieldLbl}>Сцен
          <input type="number" min={3} max={12} value={sceneCount} onChange={(e) => setSceneCount(Math.max(3, Math.min(12, Math.floor(Number(e.target.value) || 5))))} style={{ ...sel, width: 70 }} />
        </label>
        <label style={{ ...fieldLbl, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-end' }}>
          <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /> Субтитры
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={genScript} disabled={busy} style={btnPrimary}>{busy ? 'Генерирую сценарий…' : 'Сгенерировать сценарий'}</button>
        <button onClick={() => setAppMode('select')} style={btnSecondary}>На главную</button>
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = { height: '100%', overflowY: 'auto', padding: '28px 32px', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' };
const center: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' };
const btnPrimary: React.CSSProperties = { padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13.5, cursor: 'pointer' };
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' };
const sel: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13.5 };
const fieldLbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' };
