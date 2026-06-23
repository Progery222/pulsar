import { useVubStore, type VubText } from '../store';
import { Select } from '../components/ui';

// Вкладка 5: Текст (§4.6 ТЗ).
export default function TextTab() {
  const text = useVubStore((s) => s.text);
  const setText = useVubStore((s) => s.setText);

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Текст
      </h2>

      <textarea
        value={text.spintax}
        onChange={(e) => setText({ spintax: e.target.value })}
        placeholder="Spintax, например: {Привет|Здравствуйте|Хай}"
        rows={5}
        style={{
          width: '100%',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: 'var(--text-primary)',
          padding: 12,
          fontSize: 14,
          fontFamily: 'inherit',
          resize: 'vertical',
          outline: 'none',
        }}
      />

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Шрифт
          <div style={{ marginTop: 6 }}>
            <Select
              value={text.font}
              options={[
                { value: 'Inter', label: 'Inter' },
                { value: 'Arial', label: 'Arial' },
                { value: 'Times New Roman', label: 'Times New Roman' },
                { value: 'Courier New', label: 'Courier New' },
              ]}
              onChange={(font) => setText({ font })}
            />
          </div>
        </label>

        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Размер
          <input
            type="number"
            min={8}
            max={200}
            value={text.size}
            onChange={(e) => setText({ size: Number(e.target.value) })}
            style={{ display: 'block', marginTop: 6, width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
          />
        </label>

        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Цвет
          <input
            type="color"
            value={text.color}
            onChange={(e) => setText({ color: e.target.value.toUpperCase() })}
            style={{ display: 'block', marginTop: 6, width: '100%', height: 38, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8 }}
          />
        </label>

        <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Позиция
          <div style={{ marginTop: 6 }}>
            <Select<VubText['position']>
              value={text.position}
              options={[
                { value: 'top', label: 'Сверху' },
                { value: 'center', label: 'По центру' },
                { value: 'bottom', label: 'Снизу' },
              ]}
              onChange={(position) => setText({ position })}
            />
          </div>
        </label>
      </div>
    </div>
  );
}
