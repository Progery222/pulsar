import { useState } from 'react';
import FileExplorer from './FileExplorer';

// Раскладка «боковой проводник + контент». Используется во всех режимах, где
// нужно грузить видео с компьютера (Уникализатор, Замена титров, Дубляж).
export default function ExplorerLayout({
  onPickFile,
  children,
}: {
  onPickFile: (path: string) => void;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(true);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: 'var(--bg-primary)' }}>
      {show ? (
        <div style={{ width: 240, flexShrink: 0, height: '100%' }}>
          <FileExplorer onPickFile={onPickFile} onClose={() => setShow(false)} />
        </div>
      ) : (
        <button
          onClick={() => setShow(true)}
          title="Показать файлы"
          style={{
            width: 26,
            flexShrink: 0,
            height: '100%',
            background: 'var(--bg-secondary)',
            border: 'none',
            borderRight: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 14,
            paddingTop: 64,
          }}
        >
          ⟩
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0, height: '100%' }}>{children}</div>
    </div>
  );
}
