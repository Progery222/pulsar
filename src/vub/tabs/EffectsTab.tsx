import { useState } from 'react';
import { useVubStore, type MirrorMode } from '../store';
import { Block, Checkbox, RangeSlider, Select, Slider } from '../components/ui';

// Вкладка 3: Видеоэффекты (§4.4 ТЗ).
export default function EffectsTab() {
  const effects = useVubStore((s) => s.effects);
  const setEffects = useVubStore((s) => s.setEffects);
  const [colorInput, setColorInput] = useState('#CCFF00');

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Видеоэффекты
      </h2>

      {/* 1. Затемнение */}
      <Block>
        <Checkbox
          checked={effects.darken.enabled}
          onChange={(v) => setEffects({ darken: { ...effects.darken, enabled: v } })}
          label="Затемнение"
        />
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 70 }}>
            {effects.darken.duration} сек
          </span>
          <div style={{ flex: 1 }}>
            <Slider
              min={1}
              max={30}
              value={effects.darken.duration}
              onChange={(d) => setEffects({ darken: { ...effects.darken, duration: d } })}
            />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Checkbox
            checked={effects.darken.audioFadeIn}
            onChange={(v) => setEffects({ darken: { ...effects.darken, audioFadeIn: v } })}
            label="Плавное появление аудио"
          />
        </div>
      </Block>

      {/* 2. Отзеркаливание */}
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Checkbox
            checked={effects.mirror.enabled}
            onChange={(v) => setEffects({ mirror: { ...effects.mirror, enabled: v } })}
            label="Отзеркаливание"
          />
          <Select<MirrorMode>
            value={effects.mirror.mode}
            options={[
              { value: 'random', label: 'Случайно' },
              { value: 'always', label: 'Всегда' },
              { value: 'never', label: 'Никогда' },
            ]}
            onChange={(mode) => setEffects({ mirror: { ...effects.mirror, mode } })}
          />
        </div>
      </Block>

      {/* 3. Полупрозрачная сетка */}
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Checkbox
            checked={effects.grid.enabled}
            onChange={(v) => setEffects({ grid: { ...effects.grid, enabled: v } })}
            label="Полупрозрачная сетка"
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {effects.grid.opacityMin}% … {effects.grid.opacityMax}%
          </span>
        </div>
        <RangeSlider
          min={1}
          max={50}
          valueMin={effects.grid.opacityMin}
          valueMax={effects.grid.opacityMax}
          onChange={(lo, hi) => setEffects({ grid: { ...effects.grid, opacityMin: lo, opacityMax: hi } })}
        />
      </Block>

      {/* 4. Цвет сетки */}
      <Block>
        <Checkbox
          checked={effects.gridColor.enabled}
          onChange={(v) => setEffects({ gridColor: { ...effects.gridColor, enabled: v } })}
          label="Цвет сетки"
        />
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="color"
            value={colorInput}
            onChange={(e) => setColorInput(e.target.value)}
            style={{ width: 36, height: 32, background: 'none', border: '1px solid var(--border)', borderRadius: 4 }}
          />
          <button
            onClick={() =>
              setEffects({ gridColor: { ...effects.gridColor, colors: [...effects.gridColor.colors, colorInput.toUpperCase()] } })
            }
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
          >
            Добавить цвет
          </button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {effects.gridColor.colors.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid var(--border)' }} />
              {c}
              <button
                onClick={() => setEffects({ gridColor: { ...effects.gridColor, colors: effects.gridColor.colors.filter((_, j) => j !== i) } })}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Block>

      {/* 5. Размер сетки */}
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Checkbox
            checked={effects.gridSize.enabled}
            onChange={(v) => setEffects({ gridSize: { ...effects.gridSize, enabled: v } })}
            label="Размер сетки"
          />
          <input
            type="number"
            min={4}
            max={256}
            value={effects.gridSize.size}
            onChange={(e) => setEffects({ gridSize: { ...effects.gridSize, size: Number(e.target.value) } })}
            style={{ width: 70, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          />
        </div>
        <Slider
          min={4}
          max={256}
          value={effects.gridSize.size}
          onChange={(s) => setEffects({ gridSize: { ...effects.gridSize, size: s } })}
        />
      </Block>
    </div>
  );
}
