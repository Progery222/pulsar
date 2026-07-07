import { useCallback, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';

type Status = 'idle' | 'processing' | 'done' | 'error';

const CHECKER =
  'repeating-conic-gradient(#2a2a2a 0% 25%, #1c1c1c 0% 50%) 50% / 20px 20px';

export default function CutoutScreen() {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Нужно изображение (PNG/JPG/WebP).');
      setStatus('error');
      return;
    }
    fileRef.current = file;
    setSrcUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setOutUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStatus('idle');
    setError('');
    setProgress(0);
  }, []);

  const run = useCallback(async () => {
    const file = fileRef.current;
    if (!file) return;
    setStatus('processing');
    setError('');
    setProgress(0);
    try {
      const blob = await removeBackground(file, {
        progress: (key, current, total) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress(pct);
          setProgressLabel(
            key.startsWith('fetch')
              ? `Загрузка модели… ${pct}%`
              : `Обработка… ${pct}%`,
          );
        },
        output: { format: 'image/png' },
      });
      setOutUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить фон');
      setStatus('error');
    }
  }, []);

  const download = useCallback(() => {
    if (!outUrl) return;
    const a = document.createElement('a');
    a.href = outUrl;
    const base = fileRef.current?.name.replace(/\.[^.]+$/, '') || 'cutout';
    a.download = `${base}-no-bg.png`;
    a.click();
  }, [outUrl]);

  return (
    <div
      className="screen-fade"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 28px',
        gap: 18,
        overflow: 'auto',
      }}
    >
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
          Удаление фона
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          ИИ вырезает фон локально на устройстве. Первый запуск скачивает модель (~40 МБ), дальше — из кэша.
        </p>
      </div>

      {/* Drop zone / picker */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: '1.5px dashed var(--border, #333)',
          borderRadius: 12,
          padding: srcUrl ? 10 : 40,
          textAlign: 'center',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          background: 'var(--bg-secondary, #141414)',
        }}
      >
        {srcUrl ? 'Другое изображение — клик или перетащите' : 'Перетащите изображение сюда или нажмите, чтобы выбрать'}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {srcUrl && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          <Panel title="Оригинал">
            <img src={srcUrl} alt="" style={imgStyle} />
          </Panel>
          <Panel title="Без фона" checker>
            {outUrl ? (
              <img src={outUrl} alt="" style={imgStyle} />
            ) : (
              <div style={{ color: 'var(--text-muted, #777)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                {status === 'processing' ? progressLabel || 'Обработка…' : 'Нажмите «Удалить фон»'}
              </div>
            )}
          </Panel>
        </div>
      )}

      {status === 'processing' && (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-secondary,#222)', overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent, #c8ff00)', transition: 'width .2s' }} />
        </div>
      )}

      {error && <div style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</div>}

      {srcUrl && (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={run}
            disabled={status === 'processing'}
            style={btn(true, status === 'processing')}
          >
            {status === 'processing' ? 'Обработка…' : 'Удалить фон'}
          </button>
          <button onClick={download} disabled={!outUrl} style={btn(false, !outUrl)}>
            Скачать PNG
          </button>
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  checker,
  children,
}: {
  title: string;
  checker?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 12,
          border: '1px solid var(--border, #2a2a2a)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: checker ? CHECKER : 'var(--bg-secondary, #141414)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const imgStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
};

function btn(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: primary ? 'none' : '1px solid var(--border, #333)',
    background: primary ? 'var(--accent, #c8ff00)' : 'transparent',
    color: primary ? '#0a0a0a' : 'var(--text-primary, #eee)',
  };
}
