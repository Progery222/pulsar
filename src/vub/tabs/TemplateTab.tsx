import { useVubStore } from '../store';

// Вкладка 6: Шаблон (Склейка) (§4.7 ТЗ).
export default function TemplateTab() {
  const template = useVubStore((s) => s.template);
  const setTemplate = useVubStore((s) => s.setTemplate);

  async function pickFolder() {
    const folder = await window.electronAPI.selectDirectory();
    if (folder) setTemplate({ folder });
  }

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Шаблон (Склейка)
      </h2>

      <button
        onClick={pickFolder}
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
      >
        Выбрать папку с клипами
      </button>
      {template.folder && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>{template.folder}</p>
      )}

      <label style={{ display: 'block', marginTop: 20, fontSize: 14, color: 'var(--text-secondary)' }}>
        Вставлять клип каждые (секунд):
        <input
          type="number"
          min={1}
          value={template.everySeconds}
          onChange={(e) => setTemplate({ everySeconds: Number(e.target.value) })}
          style={{ display: 'block', marginTop: 6, width: 140, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
        />
      </label>
    </div>
  );
}
