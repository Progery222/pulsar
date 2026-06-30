import { useVubStore, type VubTabKey } from './store';
import VideosTab from './tabs/VideosTab';
import ParamsTab from './tabs/ParamsTab';
import EffectsTab from './tabs/EffectsTab';
import HooksTab from './tabs/HooksTab';
import WatermarkTab from './tabs/WatermarkTab';
import TextTab from './tabs/TextTab';
import TitlesTab from './tabs/TitlesTab';
import TemplateTab from './tabs/TemplateTab';
import MetadataTab from './tabs/MetadataTab';
import PerformanceTab from './tabs/PerformanceTab';

const TABS: { key: VubTabKey; label: string }[] = [
  { key: 'videos', label: 'Загруженные видео' },
  { key: 'params', label: 'Параметры видео' },
  { key: 'effects', label: 'Видеоэффекты' },
  { key: 'hooks', label: 'Хуки' },
  { key: 'watermark', label: 'Водяной знак' },
  { key: 'text', label: 'Текст' },
  { key: 'titles', label: 'Титры' },
  { key: 'template', label: 'Шаблон (Склейка)' },
  { key: 'metadata', label: 'Метаданные' },
  { key: 'performance', label: 'Производительность' },
];

// Модуль Video Unique Booster — левое меню (8 вкладок) + центральная рабочая область (§4.1 ТЗ).
export default function VubApp() {
  const activeTab = useVubStore((s) => s.activeTab);
  const setActiveTab = useVubStore((s) => s.setActiveTab);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: 'var(--bg-primary)' }}>
      {/* Левое меню */}
      <nav
        style={{
          width: 280,
          flexShrink: 0,
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)',
          paddingTop: 56,
        }}
      >
        <div style={{ padding: '0 20px 16px', fontSize: 13, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>
          Уникализатор
        </div>
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '12px 20px',
                fontSize: 14,
                background: 'transparent',
                border: 'none',
                borderLeft: `3px solid ${active ? 'var(--accent-green)' : 'transparent'}`,
                color: active ? 'var(--accent-green)' : 'var(--text-primary)',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Центральная область */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '56px 40px 40px' }}>
        {activeTab === 'videos' && <VideosTab />}
        {activeTab === 'params' && <ParamsTab />}
        {activeTab === 'effects' && <EffectsTab />}
        {activeTab === 'hooks' && <HooksTab />}
        {activeTab === 'watermark' && <WatermarkTab />}
        {activeTab === 'text' && <TextTab />}
        {activeTab === 'titles' && <TitlesTab />}
        {activeTab === 'template' && <TemplateTab />}
        {activeTab === 'metadata' && <MetadataTab />}
        {activeTab === 'performance' && <PerformanceTab />}
      </main>
    </div>
  );
}
