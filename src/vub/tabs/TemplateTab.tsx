import { useVubStore } from '../store';
import { Switch } from '../components/ui';

// Вкладка «Шаблон (Склейка)»: из папки берутся случайные клипы и вставляются
// в случайные места видео. count — сколько клипов вставить в каждый ролик.
export default function TemplateTab() {
  const template = useVubStore((s) => s.template);
  const setTemplate = useVubStore((s) => s.setTemplate);

  async function pickFolder() {
    const folder = await window.electronAPI.selectDirectory();
    if (folder) setTemplate({ folder });
  }
  function onFolderDrop(e: React.DragEvent) {
    e.preventDefault();
    const p = e.dataTransfer.getData('application/x-pulsar-path');
    const isDir = e.dataTransfer.getData('application/x-pulsar-isdir');
    if (p && isDir === '1') setTemplate({ folder: p });
  }

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Шаблон (Склейка)
      </h2>

      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          marginBottom: 16,
        }}
      >
        Из выбранной папки берутся <b>случайные</b> клипы и вставляются в видео в <b>разных
        случайных местах</b> (cutaway-вставки). Это меняет монтаж и временную структуру —
        сильно сбивает перцептивный/временной отпечаток. Для каждой копии места вставки и
        набор клипов свои.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Switch checked={template.enabled} onChange={(v) => setTemplate({ enabled: v })} />
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Вставлять клипы из папки</span>
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={onFolderDrop}>
        <button
          onClick={pickFolder}
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
        >
          Выбрать папку с клипами
        </button>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-secondary)' }}>или перетащи папку из проводника слева</span>
        {template.folder && (
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{template.folder}</p>
        )}
      </div>

      <label style={{ display: 'block', marginTop: 20, fontSize: 14, color: 'var(--text-secondary)' }}>
        Сколько клипов вставить:
        <input
          type="number"
          min={1}
          max={20}
          value={template.count}
          onChange={(e) => setTemplate({ count: Math.max(1, Number(e.target.value)) })}
          style={{ display: 'block', marginTop: 6, width: 140, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
        />
      </label>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
        Клипы берутся случайно (можно повторяться, если в папке их меньше). Поддерживаются
        .mp4, .mov, .mkv, .webm, .avi, .m4v.
      </p>
    </div>
  );
}
