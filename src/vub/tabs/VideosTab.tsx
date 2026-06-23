import { useState } from 'react';
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

  async function pick() {
    const paths = await window.electronAPI.selectVideos();
    if (paths.length) addVideos(paths);
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
