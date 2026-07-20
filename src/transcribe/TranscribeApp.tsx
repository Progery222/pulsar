import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { fileName, isVideoFile } from '../utils/media';
import { groupWords, toSRT, toTXT, toVTT, type Cue } from './subs';

type VidItem = { path: string; name: string };

const LANGS = [
  { code: 'auto', label: 'Авто' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Українська' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
];

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TranscribeApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [videos, setVideos] = useState<VidItem[]>([]);
  const [selPath, setSelPath] = useState<string | null>(null);
  const [lang, setLang] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ stage: 'extract' | 'transcribe'; percent: number } | null>(null);
  const [cuesByPath, setCuesByPath] = useState<Record<string, Cue[]>>({});

  const cues = selPath ? cuesByPath[selPath] : undefined;

  async function addVideos() {
    const paths = await window.electronAPI.selectVideos();
    const valid = paths.filter(isVideoFile);
    if (paths.length > valid.length) showToast('Часть файлов не поддерживается (нужно видео/аудио)');
    if (!valid.length) return;
    setVideos((prev) => {
      const have = new Set(prev.map((v) => v.path));
      const added = valid.filter((p) => !have.has(p)).map((p) => ({ path: p, name: fileName(p) }));
      return [...prev, ...added];
    });
    setSelPath((cur) => cur ?? valid[0]);
  }

  async function transcribe(path: string) {
    setBusy(true);
    setProg({ stage: 'extract', percent: 0 });
    const off = window.electronAPI.onTranscribeProgress((ev) => setProg(ev));
    try {
      const res = await window.electronAPI.transcribeRun(path, lang);
      if ('error' in res) {
        showToast('Распознавание недоступно: ' + res.error + ' (нужен Python + Whisper — Настройки)');
        return;
      }
      const cs = groupWords(res.words);
      setCuesByPath((prev) => ({ ...prev, [path]: cs }));
      if (!cs.length) showToast('Речь не распознана');
    } catch (e) {
      showToast('Ошибка распознавания: ' + (e as Error).message);
    } finally {
      off();
      setBusy(false);
      setProg(null);
    }
  }

  async function transcribeAll() {
    for (const v of videos) {
      if (!cuesByPath[v.path]) {
        setSelPath(v.path);
        // eslint-disable-next-line no-await-in-loop
        await transcribe(v.path);
      }
    }
  }

  async function exportAs(fmtKind: 'srt' | 'vtt' | 'txt') {
    if (!selPath || !cues) return;
    const base = fileName(selPath).replace(/\.[^.]+$/, '');
    const content = fmtKind === 'srt' ? toSRT(cues) : fmtKind === 'vtt' ? toVTT(cues) : toTXT(cues);
    const res = await window.electronAPI.saveTextFile(`${base}.${fmtKind}`, content);
    if ('error' in res) showToast('Не удалось сохранить: ' + res.error);
    else if ('ok' in res) {
      showToast('Сохранено: ' + res.path);
      window.electronAPI.showItemInFolder(res.path); // открыть папку с выделением файла
    }
  }

  function copyText() {
    if (!cues) return;
    navigator.clipboard?.writeText(toTXT(cues));
    showToast('Текст скопирован');
  }

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--bg-primary)' }}>
      {/* Список видео */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={addVideos} style={{ ...primaryBtn, flex: 1 }}>Добавить видео</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {videos.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'center' }}>Добавьте видео или аудио для распознавания речи</div>}
          {videos.map((v) => (
            <button
              key={v.path}
              onClick={() => setSelPath(v.path)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, borderRadius: 8, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-primary)', background: selPath === v.path ? 'var(--bg-tertiary)' : 'transparent', border: `1px solid ${selPath === v.path ? 'var(--accent-green)' : 'transparent'}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {cuesByPath[v.path] ? '✓ ' : ''}{v.name}
            </button>
          ))}
        </div>
        {videos.length > 1 && (
          <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
            <button onClick={transcribeAll} disabled={busy} style={{ ...secondaryBtn, width: '100%' }}>Распознать все</button>
          </div>
        )}
        <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
          <button onClick={() => setAppMode('select')} style={{ ...secondaryBtn, width: '100%' }}>На главную</button>
        </div>
      </div>

      {/* Правая часть */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Язык
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={selectStyle}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <button onClick={() => selPath && transcribe(selPath)} disabled={!selPath || busy} style={primaryBtn}>
            {busy ? (prog?.stage === 'transcribe' && (prog?.percent ?? 0) > 1 ? `Распознаю… ${prog?.percent}%` : 'Распознаю…') : 'Распознать речь'}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => exportAs('srt')} disabled={!cues} style={secondaryBtn}>SRT</button>
          <button onClick={() => exportAs('vtt')} disabled={!cues} style={secondaryBtn}>VTT</button>
          <button onClick={() => exportAs('txt')} disabled={!cues} style={secondaryBtn}>TXT</button>
          <button onClick={copyText} disabled={!cues} style={secondaryBtn}>Копировать</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {!selPath && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Выберите видео слева.</div>}
          {selPath && !cues && !busy && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Нажмите «Распознать речь». Работает офлайн через Whisper.</div>}
          {busy && (
            <div style={{ maxWidth: 520 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
                <span>
                  {prog?.stage === 'extract'
                    ? 'Извлечение аудио…'
                    : (prog?.percent ?? 0) <= 1
                      ? 'Загрузка модели…'
                      : 'Распознавание речи…'}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{prog?.stage === 'transcribe' ? `${prog?.percent ?? 0}%` : ''}</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: prog?.stage === 'transcribe' && (prog?.percent ?? 0) > 1 ? `${prog?.percent}%` : '15%',
                    background: 'var(--accent-green)',
                    borderRadius: 999,
                    transition: 'width 0.3s ease',
                    animation: prog?.stage === 'extract' || (prog?.percent ?? 0) <= 1 ? 'tsIndet 1.1s ease-in-out infinite' : 'none',
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                Первый запуск может скачивать модель Whisper (~470 МБ) — тогда прогресс появится не сразу.
              </div>
              <style>{`@keyframes tsIndet{0%{transform:translateX(-30%)}50%{transform:translateX(300%)}100%{transform:translateX(-30%)}}`}</style>
            </div>
          )}
          {cues && cues.length > 0 && (
            <div style={{ maxWidth: 780 }}>
              {cues.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--accent-green)', fontVariantNumeric: 'tabular-nums', minWidth: 78, flexShrink: 0 }}>{fmt(c.start)} → {fmt(c.end)}</span>
                  <span style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.45 }}>{c.text}</span>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 10 }}>Реплик: {cues.length}</div>
            </div>
          )}
          {cues && cues.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Речь не распознана.</div>}
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = { padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '8px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' };
const selectStyle: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13 };
