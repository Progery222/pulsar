import { useProjectStore } from '../store/projectStore';
import { FILTERS } from '../data/filters';
import { mediaUrl } from '../utils/media';

// FiltersPanel (§8): лента карточек фильтров + ползунок интенсивности.
export default function FiltersPanel() {
  const activeFilter = useProjectStore((s) => s.activeFilter);
  const filterIntensity = useProjectStore((s) => s.filterIntensity);
  const setActiveFilter = useProjectStore((s) => s.setActiveFilter);
  const setFilterIntensity = useProjectStore((s) => s.setFilterIntensity);
  const sharpen = useProjectStore((s) => s.sharpen);
  const grain = useProjectStore((s) => s.grain);
  const setSharpen = useProjectStore((s) => s.setSharpen);
  const setGrain = useProjectStore((s) => s.setGrain);
  const firstClip = useProjectStore((s) => s.generatedClips[0]);

  return (
    <div className="flex h-full flex-col p-3">
      {/* Лента карточек фильтров */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {FILTERS.map((f) => {
          const selected = (f.key === 'none' && activeFilter === null) || f.key === activeFilter;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key === 'none' ? null : f.key)}
              className="flex shrink-0 flex-col items-center"
            >
              <div
                className="overflow-hidden rounded-el bg-bg-tertiary"
                style={{
                  width: 72,
                  height: 100,
                  border: selected ? '2px solid var(--accent-green)' : '2px solid transparent',
                }}
              >
                {firstClip ? (
                  <video
                    src={mediaUrl(firstClip.sourceFile)}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                    style={{ filter: f.css }}
                    onLoadedMetadata={(e) => {
                      if (firstClip.startTime) e.currentTarget.currentTime = firstClip.startTime;
                    }}
                  />
                ) : (
                  <div className="h-full w-full" style={{ filter: f.css, backgroundColor: '#444' }} />
                )}
              </div>
              <span
                className="mt-1 text-center"
                style={{ fontSize: 11, color: selected ? 'var(--accent-green)' : 'var(--text-secondary)' }}
              >
                {f.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ползунок интенсивности */}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-text-secondary" style={{ fontSize: 12 }}>
          <span>Интенсивность</span>
          <span>{filterIntensity}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={filterIntensity}
          disabled={activeFilter === null}
          onChange={(e) => setFilterIntensity(Number(e.target.value))}
          className="w-full accent-[var(--accent-green)]"
        />
      </div>

      {/* Детализация: резкость и зерно — общий слой поверх грейда на весь ролик */}
      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="uppercase text-text-secondary" style={{ fontSize: 12, letterSpacing: 1 }}>
            Детализация
          </span>
          {(sharpen > 0 || grain > 0) && (
            <button
              onClick={() => { setSharpen(0); setGrain(0); }}
              className="text-text-secondary hover:text-text-primary"
              style={{ fontSize: 11 }}
            >
              Сбросить
            </button>
          )}
        </div>

        <Slider
          label="Резкость"
          hint="Подчёркивает контуры (unsharp). Выше 70 на мягком исходнике лезут ореолы."
          value={sharpen}
          onChange={setSharpen}
        />
        <Slider
          label="Зерно / шум"
          hint="Плёночное зерно поверх картинки. Заодно ломает гладкие градиенты — видео меньше похоже на съэкспортированное из шаблона."
          value={grain}
          onChange={setGrain}
        />

        <p className="mt-2 text-text-secondary" style={{ fontSize: 11, lineHeight: 1.4 }}>
          Применяется ко всему ролику при экспорте. В превью резкость и зерно показаны
          приблизительно — итог считает FFmpeg.
        </p>
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between" style={{ fontSize: 12 }}>
        <span className="text-text-primary">{label}</span>
        <span style={{ color: value > 0 ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
          {value > 0 ? value : 'выкл'}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent-green)]"
      />
      <div className="text-text-secondary" style={{ fontSize: 10.5, lineHeight: 1.35 }}>{hint}</div>
    </div>
  );
}
