import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { EFFECTS } from '../data/effects';
import { MONTAGE_STYLES, applyMontageStyle } from '../data/montageStyles';
import { reapplyEffects } from '../utils/regenerate';
import type { EffectName } from '../types';

// EditPanel (§7): сетка переключателей эффектов с уровнями 0→1→2→0 и мини-настройками.
export default function EditPanel() {
  const activeEffects = useProjectStore((s) => s.activeEffects);
  const setActiveEffect = useProjectStore((s) => s.setActiveEffect);
  const effectSettings = useProjectStore((s) => s.effectSettings);
  const setEffectSetting = useProjectStore((s) => s.setEffectSetting);

  const [settingsFor, setSettingsFor] = useState<EffectName | null>(null);

  function cycle(key: EffectName) {
    const next = (((activeEffects[key] + 1) % 3) as 0 | 1 | 2);
    setActiveEffect(key, next);
    reapplyEffects();
  }

  function shuffle() {
    reapplyEffects();
  }

  const meta = settingsFor ? EFFECTS.find((e) => e.key === settingsFor) ?? null : null;
  const setting = settingsFor ? effectSettings[settingsFor] : null;

  return (
    <div className="relative p-3">
      {/* B4: стиль-пресеты монтажа — один клик задаёт mood/эффекты/фильтр */}
      <div className="mb-3">
        <div className="mb-1 text-text-secondary" style={{ fontSize: 12 }}>Стиль монтажа</div>
        <div className="grid grid-cols-4 gap-2">
          {MONTAGE_STYLES.map((style) => (
            <button
              key={style.key}
              onClick={() => applyMontageStyle(style)}
              className="flex flex-col items-center gap-0.5 rounded-el py-2"
              style={{ fontSize: 11, backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              title={`Применить стиль «${style.label}»`}
            >
              <span style={{ fontSize: 18 }}>{style.icon}</span>
              <span>{style.label}</span>
            </button>
          ))}
        </div>
      </div>

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
            <div key={eff.key} className="relative flex flex-col items-center">
              {/* Шестерёнка настроек */}
              <button
                className="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary"
                style={{ fontSize: 11 }}
                onClick={() => setSettingsFor(eff.key)}
                title="Настройки эффекта"
              >
                ⚙
              </button>

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

              <div className="mt-1 flex h-2 items-center gap-1">
                {Array.from({ length: level }).map((_, i) => (
                  <span key={i} className="rounded-full" style={{ width: 5, height: 5, backgroundColor: 'var(--accent-orange)' }} />
                ))}
              </div>

              <span className="mt-0.5 text-center text-text-secondary" style={{ fontSize: 12 }}>
                {eff.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Мини-диалог настроек эффекта */}
      {meta && setting && settingsFor && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 p-3"
          onClick={() => setSettingsFor(null)}
        >
          <div
            className="w-full rounded-card bg-bg-secondary p-4"
            style={{ border: '1px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold text-text-primary" style={{ fontSize: 15 }}>
                {meta.icon} {meta.label}
              </span>
              <button className="text-text-secondary hover:text-text-primary" onClick={() => setSettingsFor(null)}>
                ✕
              </button>
            </div>

            {/* Интенсивность */}
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-text-secondary" style={{ fontSize: 12 }}>
                <span>Интенсивность</span>
                <span>{setting.intensity}</span>
              </div>
              <input
                type="range" min={0} max={100}
                value={setting.intensity}
                onChange={(e) => setEffectSetting(settingsFor, { intensity: Number(e.target.value) })}
                className="w-full accent-[var(--accent-green)]"
              />
            </div>

            {/* Вариант */}
            {meta.variants.length > 0 && (
              <div>
                <div className="mb-1 text-text-secondary" style={{ fontSize: 12 }}>Режим</div>
                <div className="flex flex-wrap gap-2">
                  {meta.variants.map((v) => {
                    const sel = v.key === setting.variant;
                    return (
                      <button
                        key={v.key}
                        onClick={() => setEffectSetting(settingsFor, { variant: v.key })}
                        className="rounded-el px-3 py-1 font-semibold"
                        style={{
                          fontSize: 12,
                          backgroundColor: sel ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                          color: sel ? '#000' : 'var(--text-primary)',
                        }}
                      >
                        {v.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Быстрое включение/уровень */}
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <span className="text-text-secondary" style={{ fontSize: 12 }}>Уровень</span>
              <div className="flex gap-2">
                {([0, 1, 2] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => { setActiveEffect(settingsFor, lvl); reapplyEffects(); }}
                    className="h-7 w-7 rounded-el font-semibold"
                    style={{
                      fontSize: 13,
                      backgroundColor: activeEffects[settingsFor] === lvl ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                      color: activeEffects[settingsFor] === lvl ? '#000' : 'var(--text-primary)',
                    }}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
