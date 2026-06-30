import { useEffect, useState } from 'react';

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

const VIDEO_RE = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const isVideo = (n: string) => VIDEO_RE.test(n);

// MIME-типы для внутреннего drag-n-drop (между проводником и дроп-зонами).
export const DND_PATH = 'application/x-pulsar-path';
export const DND_ISDIR = 'application/x-pulsar-isdir';

function startDrag(e: React.DragEvent, entry: Entry) {
  e.dataTransfer.setData(DND_PATH, entry.path);
  e.dataTransfer.setData(DND_ISDIR, entry.isDir ? '1' : '0');
  e.dataTransfer.setData('text/plain', entry.path);
  e.dataTransfer.effectAllowed = 'copy';
}

function Node({ entry, depth, onPickFile }: { entry: Entry; depth: number; onPickFile: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(false);

  async function toggle() {
    if (!entry.isDir) return;
    if (children === null) {
      setLoading(true);
      const r = await window.electronAPI.listDir(entry.path);
      setChildren(r.entries);
      setLoading(false);
    }
    setOpen((o) => !o);
  }
  function onActivate() {
    if (entry.isDir) toggle();
    else if (isVideo(entry.name)) onPickFile(entry.path);
  }

  const video = !entry.isDir && isVideo(entry.name);

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => startDrag(e, entry)}
        onClick={entry.isDir ? toggle : onActivate}
        onDoubleClick={onActivate}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={entry.path + (video ? '  ·  двойной клик — добавить' : '')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 26,
          paddingRight: 8,
          paddingLeft: 8 + depth * 12,
          cursor: 'pointer',
          fontSize: 13,
          color: video ? 'var(--accent-green)' : 'var(--text-primary)',
          background: hover ? 'var(--bg-tertiary)' : 'transparent',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <span style={{ width: 10, flexShrink: 0, fontSize: 10, color: 'var(--text-secondary)' }}>
          {entry.isDir ? (open ? '▾' : '▸') : ''}
        </span>
        <span style={{ flexShrink: 0, fontSize: 13, opacity: 0.9 }}>{entry.isDir ? '📁' : video ? '🎬' : '📄'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
      </div>
      {open && loading && (
        <div style={{ height: 22, paddingLeft: 26 + depth * 12, fontSize: 12, color: 'var(--text-secondary)' }}>загрузка…</div>
      )}
      {open && children && children.map((c) => <Node key={c.path} entry={c} depth={depth + 1} onPickFile={onPickFile} />)}
      {open && children && children.length === 0 && !loading && (
        <div style={{ height: 22, paddingLeft: 26 + depth * 12, fontSize: 12, color: 'var(--text-secondary)' }}>пусто</div>
      )}
    </div>
  );
}

// Боковой файловый проводник в стиле приложения.
export default function FileExplorer({ onPickFile, onClose }: { onPickFile: (p: string) => void; onClose?: () => void }) {
  const [roots, setRoots] = useState<Entry[]>([]);

  useEffect(() => {
    window.electronAPI.listDir(null).then((r) => setRoots(r.entries));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 56,
          padding: '56px 12px 10px 20px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>Файлы</span>
        {onClose && (
          <button
            onClick={onClose}
            title="Свернуть панель"
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}
          >
            ⟨
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 8 }}>
        {roots.map((r) => (
          <Node key={r.path} entry={r} depth={0} onPickFile={onPickFile} />
        ))}
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45, flexShrink: 0 }}>
        🎬 видео — двойной клик добавляет. Файл/папку можно перетащить в нужное поле.
      </div>
    </div>
  );
}
