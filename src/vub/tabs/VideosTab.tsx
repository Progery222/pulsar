import { useEffect, useState } from 'react';
import { useVubStore } from '../store';

function mediaUrl(p: string): string {
  return `media:///${encodeURIComponent(p)}`;
}

// Вкладка 1: Загруженные видео (§4.2 ТЗ).
export default function VideosTab() {
  const videos = useVubStore((s) => s.videos);
  const addVideos = useVubStore((s) => s.addVideos);
  const removeVideo = useVubStore((s) => s.removeVideo);
  const [dragOver, setDragOver] = useState(false);

  const [url, setUrl] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [dlStatus, setDlStatus] = useState<string | null>(null);
  const [dlPercent, setDlPercent] = useState(0);
  const [dlError, setDlError] = useState<string | null>(null);

  useEffect(() => {
    const off = window.electronAPI.onDownloadProgress((e) => {
      if (typeof e.percent === 'number') setDlPercent(e.percent);
      if (e.line) setDlStatus(e.line);
    });
    return off;
  }, []);

  async function pick() {
    const paths = await window.electronAPI.selectVideos();
    if (paths.length) addVideos(paths);
  }

  async function download() {
    const link = url.trim();
    if (!link || downloading) return;
    setDownloading(true);
    setDlError(null);
    setDlPercent(0);
    setDlStatus('Подготовка…');
    try {
      const res = await window.electronAPI.downloadVideo(link);
      if ('error' in res) {
        setDlError(res.error);
      } else {
        addVideos([res.path]);
        setUrl('');
        setDlStatus(null);
      }
    } finally {
      setDownloading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => !!p && /\.(mp4|mov|avi)$/i.test(p));
    if (paths.length) addVideos(paths);
  }

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Загруженные видео
      </h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && download()}
          placeholder="Вставьте ссылку (TikTok, YouTube, Instagram…)"
          disabled={downloading}
          style={{
            flex: 1,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
          }}
        />
        <button
          onClick={download}
          disabled={downloading || !url.trim()}
          style={{
            background: 'var(--accent-green)',
            border: 'none',
            color: '#000',
            borderRadius: 8,
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 600,
            cursor: downloading || !url.trim() ? 'default' : 'pointer',
            opacity: downloading || !url.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {downloading ? `${Math.round(dlPercent)}%` : 'Скачать'}
        </button>
      </div>
      {downloading && dlStatus && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{dlStatus}</div>
      )}
      {dlError && (
        <div style={{ fontSize: 13, color: '#ff6b6b', marginBottom: 16 }}>{dlError}</div>
      )}
      {!downloading && !dlError && <div style={{ marginBottom: 12 }} />}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={pick}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent-green)' : 'var(--border)'}`,
          borderRadius: 8,
          padding: 40,
          textAlign: 'center',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          marginBottom: 20,
        }}
      >
        Перетащите файлы сюда или нажмите для выбора (MP4, MOV, AVI)
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {videos.map((v) => (
          <div
            key={v.id}
            style={{
              height: 64,
              background: 'var(--bg-tertiary)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0 12px',
            }}
          >
            <video
              src={mediaUrl(v.path)}
              muted
              style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, background: '#000' }}
            />
            <span style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.name}
            </span>
            <button
              onClick={() => removeVideo(v.id)}
              style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}
              title="Удалить"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={pick}
        style={{
          marginTop: 16,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          borderRadius: 8,
          padding: '10px 16px',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Загрузить больше видео
      </button>
    </div>
  );
}
