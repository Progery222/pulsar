import { useProjectStore } from '../store/projectStore';
import { EFFECTS } from '../data/effects';
import { reapplyEffects } from '../utils/regenerate';

// EditPanel (§7): сетка круглых переключателей эффектов с циклом уровней 0→1→2→0.
export default function EditPanel() {
  const activeEffects = useProjectStore((s) => s.activeEffects);
  const setActiveEffect = useProjectStore((s) => s.setActiveEffect);

  function cycle(key: (typeof EFFECTS)[number]['key']) {
    const next = (((activeEffects[key] + 1) % 3) as 0 | 1 | 2);
    setActiveEffect(key, next);
    reapplyEffects(); // обновить маркеры на Timeline
  }

  function shuffle() {
    reapplyEffects(); // новый случайный seed расстановки
  }

  return (
    <div className="p-3">
      {/* Кнопка Shuffle над сеткой */}
      <div className="mb-3 flex justify-end">
        <button
          className="btn-secondary flex items-center gap-2 px-3 py-1.5"
          style={{ fontSize: 13 }}
          onClick={shuffle}
          title="Перемешать расстановку эффектов"
        >
          ⤬ Перемешать
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {EFFECTS.map((eff) => {
          const level = activeEffects[eff.key];
          return (
            <div key={eff.key} className="flex flex-col items-center">
              <button
                onClick={() => cycle(eff.key)}
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 64,
                  height: 64,
                  backgroundColor: 'var(--bg-tertiary)',
                  border: level > 0 ? '2px solid var(--accent-green)' : '2px solid transparent',
                  color: level > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 24,
                }}
              >
                {eff.icon}
              </button>

              {/* Оранжевые точки уровня */}
              <div className="mt-1 flex h-2 items-center gap-1">
                {Array.from({ length: level }).map((_, i) => (
                  <span
                    key={i}
                    className="rounded-full"
                    style={{ width: 5, height: 5, backgroundColor: 'var(--accent-orange)' }}
                  />
                ))}
              </div>

              <span className="mt-0.5 text-center text-text-secondary" style={{ fontSize: 12 }}>
                {eff.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
