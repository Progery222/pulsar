import { useCallback, useEffect, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { useUIStore } from '../store/uiStore';
import { mediaUrl } from '../utils/media';

type Phase = 'pick' | 'edit' | 'rendering' | 'done';
type Format = '9:16' | '1:1' | '16:9';

const FORMATS: Record<Format, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: '9:16 · Reels/TikTok' },
  '1:1': { w: 1080, h: 1080, label: '1:1 · Пост' },
  '16:9': { w: 1920, h: 1080, label: '16:9 · YouTube' },
};

const TEMPLATE_CARDS = [
  { id: 'story', title: 'Simple Cinematic', desc: 'Кино-фон, вырезка, анимированный текст' },
];

const ACCENTS = ['#a9d2ff', '#ccff00', '#ff5c8a', '#ffcc4d', '#7c5cff', '#3ad1c0', '#ffffff'];

export default function TemplatesApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);

  const [phase, setPhase] = useState<Phase>('pick');
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null); // data URL PNG с альфой
  const [cutBusy, setCutBusy] = useState(false);
  const [cutProg, setCutProg] = useState(0);
  const [cutErr, setCutErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<File | null>(null);

  const [templateId, setTemplateId] = useState('story');
  const [eyebrow, setEyebrow] = useState('exclusive drop');
  const [title, setTitle] = useState('SUMMER MOOD');
  const [subtitle, setSubtitle] = useState('new collection 2026');
  const [cta, setCta] = useState('Tap to shop');
  const [accent, setAccent] = useState('#a9d2ff');
  const [format, setFormat] = useState<Format>('9:16');
  const [duration, setDuration] = useState(6);
  const [musicPath, setMusicPath] = useState<string | null>(null);

  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<string | null>(null);
  const [renderErr, setRenderErr] = useState<string | null>(null);

  useEffect(() => {
    const off = window.electronAPI.onTemplateProgress((p) => setProgress(p));
    return off;
  }, []);

  const doCutout = useCallback(async (file: File) => {
    setCutBusy(true);
    setCutErr(null);
    setCutProg(0);
    try {
      const blob = await removeBackground(file, {
        progress: (_key, cur, total) => setCutProg(total > 0 ? Math.round((cur / total) * 100) : 0),
        output: { format: 'image/png' },
      });
      const reader = new FileReader();
      reader.onload = () => {
        setSubject(reader.result as string);
        setPhase('edit');
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      setCutErr(e instanceof Error ? e.message : 'Ошибка удаления фона');
    } finally {
      setCutBusy(false);
    }
  }, []);

  function onPick(files: FileList | null) {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    pendingFile.current = f;
    setSrcUrl(URL.createObjectURL(f));
    doCutout(f);
  }

  async function pickMusic() {
    const p = await window.electronAPI.selectAudio();
    if (p) setMusicPath(p);
  }

  async function render() {
    if (!subject) return;
    const out = await window.electronAPI.proExportSavePath('mp4');
    if (!out) return;
    setPhase('rendering');
    setProgress(0);
    setRenderErr(null);
    const { w, h } = FORMATS[format];
    const res = await window.electronAPI.renderTemplate({
      templateId,
      data: { eyebrow, title, subtitle, cta, accent, subjectImage: subject },
      width: w,
      height: h,
      fps: 30,
      durationSec: duration,
      outputPath: out,
      musicPath: musicPath || undefined,
    });
    if ('error' in res) {
      setRenderErr(res.error);
      setPhase('edit');
    } else {
      setOutput(res.path);
      setPhase('done');
    }
  }

  function reset() {
    setSubject(null);
    setSrcUrl(null);
    setOutput(null);
    setPhase('pick');
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, padding: '0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <button onClick={() => setAppMode('select')} style={{ width: 36, height: 36, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 18 }}>⌂</button>
        <span className="font-semibold" style={{ fontSize: 18, color: 'var(--accent-green)' }}>Шаблоны</span>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Превью-колонка */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-primary)' }}>
          {phase === 'done' && output ? (
            <video src={mediaUrl(output)} controls autoPlay loop style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: 12, background: '#000' }} />
          ) : subject ? (
            <div style={{ position: 'relative', maxHeight: '100%', maxWidth: '100%' }}>
              <img src={subject} alt="" style={{ maxHeight: '70vh', maxWidth: '100%', objectFit: 'contain', background: 'repeating-conic-gradient(#2a2a2a 0% 25%, #1c1c1c 0% 50%) 50% / 20px 20px', borderRadius: 12 }} />
              {phase === 'rendering' && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <div style={{ width: '70%', height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-green)', transition: 'width .2s' }} />
                  </div>
                  <span style={{ color: '#fff', fontSize: 14 }}>{progress < 80 ? `Рендер кадров… ${progress}%` : progress < 100 ? 'Склейка + музыка…' : 'Готово'}</span>
                </div>
              )}
            </div>
          ) : (
            <label style={{ width: 340, height: 420, border: '2px dashed var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              {cutBusy ? (
                <>
                  <div style={{ fontSize: 40 }}>✂️</div>
                  <div style={{ fontSize: 14 }}>Удаляю фон… {cutProg}%</div>
                  {srcUrl && <img src={srcUrl} alt="" style={{ maxWidth: 140, maxHeight: 140, opacity: 0.5, borderRadius: 8, marginTop: 8 }} />}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 46 }}>🖼️</div>
                  <div style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 600 }}>Выберите фото</div>
                  <div style={{ fontSize: 12.5 }}>фон уберётся автоматически (ИИ)</div>
                  {cutErr && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{cutErr}</div>}
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>

        {/* Панель настроек */}
        <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflowY: 'auto', padding: 18 }}>
          {phase === 'done' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="font-semibold" style={{ fontSize: 16, color: 'var(--text-primary)' }}>Готово ✅</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Ролик сохранён. Можно открыть папку или сделать ещё.</p>
              {output && <button onClick={() => window.electronAPI.showItemInFolder(output)} style={btn(true)}>Показать в папке</button>}
              <button onClick={() => setPhase('edit')} style={btn(false)}>Изменить текст/шаблон</button>
              <button onClick={reset} style={btn(false)}>Новое фото</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: subject ? 1 : 0.5, pointerEvents: subject ? 'auto' : 'none' }}>
              <Group label="Шаблон">
                {TEMPLATE_CARDS.map((t) => (
                  <button key={t.id} onClick={() => setTemplateId(t.id)} style={{ textAlign: 'left', padding: 12, borderRadius: 10, background: 'var(--bg-tertiary)', border: `2px solid ${templateId === t.id ? 'var(--accent-green)' : 'transparent'}`, cursor: 'pointer', width: '100%' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: templateId === t.id ? 'var(--accent-green)' : 'var(--text-primary)' }}>{t.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{t.desc}</div>
                  </button>
                ))}
              </Group>

              <Group label="Текст">
                <Field label="Надзаголовок" value={eyebrow} onChange={setEyebrow} />
                <Field label="Заголовок" value={title} onChange={setTitle} />
                <Field label="Подзаголовок" value={subtitle} onChange={setSubtitle} />
                <Field label="Кнопка (CTA)" value={cta} onChange={setCta} />
              </Group>

              <Group label="Акцент">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ACCENTS.map((c) => (
                    <button key={c} onClick={() => setAccent(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: accent === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
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

              <Group label={`Длительность · ${duration}с`}>
                <input type="range" min={4} max={12} value={duration} onChange={(e) => setDuration(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent-green)' }} />
              </Group>

              <Group label="Музыка">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={pickMusic} style={btn(false)}>{musicPath ? 'Сменить трек' : 'Выбрать трек'}</button>
                  {musicPath && <button onClick={() => setMusicPath(null)} style={{ ...btn(false), width: 'auto', padding: '9px 12px' }}>✕</button>}
                </div>
                {musicPath && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, wordBreak: 'break-all' }}>{musicPath.split(/[\\/]/).pop()}</div>}
              </Group>

              {renderErr && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{renderErr}</div>}
              <button onClick={render} disabled={!subject || phase === 'rendering'} style={{ ...btn(true), height: 44, fontSize: 15, opacity: phase === 'rendering' ? 0.6 : 1 }}>
                {phase === 'rendering' ? `Рендер… ${progress}%` : '✨ Сгенерировать'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
