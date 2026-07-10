import { useCallback, useEffect, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { useUIStore } from '../store/uiStore';
import { mediaUrl } from '../utils/media';
import { TEMPLATES, type TemplateDef } from './templates';

type Phase = 'gallery' | 'edit' | 'rendering' | 'done';
type Format = '9:16' | '1:1' | '16:9';

const FORMATS: Record<Format, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: '9:16 · Reels/TikTok' },
  '1:1': { w: 1080, h: 1080, label: '1:1 · Пост' },
  '16:9': { w: 1920, h: 1080, label: '16:9 · YouTube' },
};

const ACCENTS = ['#a9d2ff', '#ccff00', '#ff5c8a', '#ffcc4d', '#7c5cff', '#3ad1c0', '#00e5ff', '#c8a26a', '#ffffff'];

export default function TemplatesApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);

  const [phase, setPhase] = useState<Phase>('gallery');
  const [tpl, setTpl] = useState<TemplateDef | null>(null);

  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const [cutProg, setCutProg] = useState(0);
  const [cutErr, setCutErr] = useState<string | null>(null);

  const [eyebrow, setEyebrow] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [cta, setCta] = useState('');
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

  function chooseTemplate(t: TemplateDef) {
    setTpl(t);
    setEyebrow(t.defaults.eyebrow || '');
    setTitle(t.defaults.title);
    setSubtitle(t.defaults.subtitle);
    setCta(t.defaults.cta);
    setAccent(t.accent);
    setPhase('edit');
  }

  const doCutout = useCallback(async (file: File) => {
    setCutBusy(true);
    setCutErr(null);
    setCutProg(0);
    try {
      const blob = await removeBackground(file, {
        progress: (_k, cur, total) => setCutProg(total > 0 ? Math.round((cur / total) * 100) : 0),
        output: { format: 'image/png' },
      });
      const reader = new FileReader();
      reader.onload = () => setSubject(reader.result as string);
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
    setSrcUrl(URL.createObjectURL(f));
    doCutout(f);
  }

  async function pickMusic() {
    const p = await window.electronAPI.selectAudio();
    if (p) setMusicPath(p);
  }

  async function render() {
    if (!subject || !tpl) return;
    const out = await window.electronAPI.proExportSavePath('mp4');
    if (!out) return;
    setPhase('rendering');
    setProgress(0);
    setRenderErr(null);
    const { w, h } = FORMATS[format];
    const res = await window.electronAPI.renderTemplate({
      templateId: tpl.id,
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

  // ── Галерея примеров ──
  if (phase === 'gallery') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <Header onHome={() => setAppMode('select')} title="Шаблоны" />
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 18 }}>
            Выбери понравившийся пример — дальше добавишь своё фото и текст.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => chooseTemplate(t)} className="tpl-card"
                style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-secondary)', textAlign: 'left' }}>
                <video src={t.preview} autoPlay loop muted playsInline
                  style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', display: 'block', background: '#000' }} />
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{t.tag}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Редактор / рендер / результат ──
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <Header onHome={() => setAppMode('select')} title={tpl?.name || 'Шаблон'}
        onBack={phase === 'done' ? undefined : () => setPhase('gallery')} />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Превью */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {phase === 'done' && output ? (
            <video src={mediaUrl(output)} controls autoPlay loop style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: 12, background: '#000' }} />
          ) : subject ? (
            <div style={{ position: 'relative' }}>
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
            <label style={{ width: 320, height: 400, border: '2px dashed var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', color: 'var(--text-secondary)' }}>
              {cutBusy ? (
                <>
                  <div style={{ fontSize: 40 }}>✂️</div>
                  <div style={{ fontSize: 14 }}>Удаляю фон… {cutProg}%</div>
                  {srcUrl && <img src={srcUrl} alt="" style={{ maxWidth: 140, maxHeight: 140, opacity: 0.5, borderRadius: 8, marginTop: 8 }} />}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 44 }}>🖼️</div>
                  <div style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 600 }}>Выберите фото</div>
                  <div style={{ fontSize: 12.5 }}>фон уберётся автоматически (ИИ)</div>
                  {cutErr && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{cutErr}</div>}
                </>
              )}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>

        {/* Панель */}
        <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflowY: 'auto', padding: 18 }}>
          {phase === 'done' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="font-semibold" style={{ fontSize: 16, color: 'var(--text-primary)' }}>Готово ✅</div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Ролик сохранён. Открой папку или сделай ещё.</p>
              {output && <button onClick={() => window.electronAPI.showItemInFolder(output)} style={btn(true)}>Показать в папке</button>}
              <button onClick={() => setPhase('edit')} style={btn(false)}>Изменить</button>
              <button onClick={() => setPhase('gallery')} style={btn(false)}>Другой шаблон</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: subject ? 1 : 0.5, pointerEvents: subject ? 'auto' : 'none' }}>
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
