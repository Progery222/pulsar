import { useVubStore } from '../store';
import { Switch } from '../components/ui';

// Вкладка 7: Метаданные (§4.8 ТЗ).
export default function MetadataTab() {
  const cleanMetadata = useVubStore((s) => s.cleanMetadata);
  const setCleanMetadata = useVubStore((s) => s.setCleanMetadata);

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Метаданные
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
        Метаданные файла (Copyright, XMP Toolkit, Handler Type, дата создания и др.) будут
        полностью очищены и заменены на уникальные сгенерированные значения. Это удаляет
        цифровые «отпечатки» исходного файла и затрудняет автоматическое сопоставление
        алгоритмами платформ.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Switch checked={cleanMetadata} onChange={setCleanMetadata} />
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Очистка метаданных</span>
      </div>
    </div>
  );
}
