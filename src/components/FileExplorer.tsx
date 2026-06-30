import { useEffect, useState } from 'react';
import { useVubStore } from '../vub/store';

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

function Node({ entry, depth }: { entry: Entry; depth: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const addVideos = useVubStore((s) => s.addVideos);

  async function loadChildren() {
    setLoading(true);
    const r = await window.electronAPI.listDir(entry.path);
    setChildren(r.entries);
    setLoading(false);
  }
  async function toggle() {
    if (!entry.isDir) return;
    if (children === null) await loadChildren();
    setOpen((o) => !o);
  }
  function onActivate() {
    if (entry.isDir) toggle();
    else if (isVideo(entry.name)) addVideos([entry.path]);
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => startDrag(e, entry)}
        onClick={entry.isDir ? toggle : undefined}
        onDoubleClick={onActivate}
        title={entry.path + (entry.isDir ? '' : isVideo(entry.name) ? '  (двойной клик — добавить)' : '')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px',
          paddingLeft: 6 + depth * 12,
          cursor: 'pointer',
          fontSize: 13,
          color: entry.isDir ? 'var(--text-primary)' : isVideo(entry.name) ? 'var(--accent-green)' : 'var(--text-secondary)',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ width: 10, flexShrink: 0, color: 'var(--text-secondary)' }}>{entry.isDir ? (open ? '▾' : '▸') : ''}</span>
        <span style={{ flexShrink: 0 }}>{entry.isDir ? '📁' : isVideo(entry.name) ? '🎬' : '📄'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
      </div>
      {open && loading && (
        <div style={{ paddingLeft: 22 + depth * 12, fontSize: 12, color: 'var(--text-secondary)' }}>загрузка…</div>
      )}
      {open && children && children.map((c) => <Node key={c.path} entry={c} depth={depth + 1} />)}
      {open && children && children.length === 0 && !loading && (
        <div style={{ paddingLeft: 22 + depth * 12, fontSize: 12, color: 'var(--text-secondary)' }}>пусто</div>
      )}
    </div>
  );
}

export default function FileExplorer({ onClose }: { onClose?: () => void }) {
  const [roots, setRoots] = useState<Entry[]>([]);

  useEffect(() => {
    window.electronAPI.listDir(null).then((r) => setRoots(r.entries));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>Файлы</span>
        {onClose && (
          <button onClick={onClose} title="Свернуть панель" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}>
            ⟨
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0' }}>
        {roots.map((r) => (
          <Node key={r.path} entry={r} depth={0} />
        ))}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        🎬 = видео. Двойной клик добавляет в очередь. Перетащи файл/папку в нужное поле.
      </div>
    </div>
  );
}
