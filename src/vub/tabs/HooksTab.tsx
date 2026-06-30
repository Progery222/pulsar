import { useVubStore } from '../store';
import { Switch } from '../components/ui';

// Вкладка «Хуки»: папка с короткими роликами-зацепками. Случайный хук добавляется
// в начало каждого видео; при нескольких копиях каждая получает свой хук.
export default function HooksTab() {
  const hooks = useVubStore((s) => s.hooks);
  const setHooks = useVubStore((s) => s.setHooks);
  const variations = useVubStore((s) => s.variations);

  async function pickFolder() {
    const folder = await window.electronAPI.selectDirectory();
    if (folder) setHooks({ folder });
  }
  function onFolderDrop(e: React.DragEvent) {
    e.preventDefault();
    const p = e.dataTransfer.getData('application/x-pulsar-path');
    const isDir = e.dataTransfer.getData('application/x-pulsar-isdir');
    if (p && isDir === '1') setHooks({ folder: p });
  }

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Хуки
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
        Короткий ролик-«зацепка» добавляется в <b>начало</b> каждого видео — он удерживает
        зрителя в первые секунды. Хуки берутся из выбранной папки в случайном порядке. Если
        у видео несколько копий, каждая копия получает <b>свой</b> хук (разный).
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Switch checked={hooks.enabled} onChange={(v) => setHooks({ enabled: v })} />
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Добавлять хук в начало видео</span>
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={onFolderDrop}>
        <button
          onClick={pickFolder}
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
        >
          Выбрать папку с хуками
        </button>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-secondary)' }}>или перетащи папку из проводника слева</span>
        {hooks.folder && (
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{hooks.folder}</p>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '16px 0 0', lineHeight: 1.6 }}>
        Поддерживаются .mp4, .mov, .mkv, .webm, .avi, .m4v. Хук масштабируется под формат
        основного видео.
        {variations > 1 && ` Сейчас копий на видео: ${variations} — для разнообразия положи в папку не меньше ${variations} хуков.`}
      </p>
    </div>
  );
}
