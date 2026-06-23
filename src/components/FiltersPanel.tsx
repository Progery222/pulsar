import { useProjectStore } from '../store/projectStore';
import { FILTERS } from '../data/filters';
import { mediaUrl } from '../utils/media';

// FiltersPanel (§8): лента карточек фильтров + ползунок интенсивности.
export default function FiltersPanel() {
  const activeFilter = useProjectStore((s) => s.activeFilter);
  const filterIntensity = useProjectStore((s) => s.filterIntensity);
  const setActiveFilter = useProjectStore((s) => s.setActiveFilter);
  const setFilterIntensity = useProjectStore((s) => s.setFilterIntensity);
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
    </div>
  );
}
