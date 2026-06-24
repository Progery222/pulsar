import { useVubStore, type VubParams } from '../store';
import { Block, Checkbox, RangeSlider } from '../components/ui';

const PARAMS: { key: keyof VubParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Яркость', min: -50, max: 50 },
  { key: 'contrast', label: 'Контрастность', min: -50, max: 50 },
  { key: 'sharpness', label: 'Резкость', min: -50, max: 50 },
  { key: 'volume', label: 'Громкость', min: -100, max: 100 },
  { key: 'duration', label: 'Длительность', min: -50, max: 50 },
  { key: 'rotation', label: 'Поворот (°)', min: -5, max: 5 },
];

// Вкладка 2: Параметры видео (§4.3 ТЗ).
export default function ParamsTab() {
  const params = useVubStore((s) => s.params);
  const setParam = useVubStore((s) => s.setParam);

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Параметры видео
      </h2>
      {PARAMS.map(({ key, label, min, max }) => {
        const p = params[key];
        return (
          <Block key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Checkbox checked={p.enabled} onChange={(v) => setParam(key, { enabled: v })} label={label} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {p.min > 0 ? `+${p.min}` : p.min}% … {p.max > 0 ? `+${p.max}` : p.max}%
              </span>
            </div>
            <RangeSlider
              min={min}
              max={max}
              valueMin={p.min}
              valueMax={p.max}
              onChange={(lo, hi) => setParam(key, { min: lo, max: hi })}
            />
          </Block>
        );
      })}
    </div>
  );
}
