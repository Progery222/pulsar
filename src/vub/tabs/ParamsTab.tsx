import { useVubStore, type VubParams } from '../store';
import { Block, Checkbox, RangeSlider, Select } from '../components/ui';

const UPSCALE_TARGETS: { value: string; label: string }[] = [
  { value: '1920', label: 'Full HD (длинная сторона 1920)' },
  { value: '2560', label: '2K (2560)' },
  { value: '3840', label: '4K (3840)' },
];

const PARAMS: { key: keyof VubParams; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Яркость', min: -50, max: 50 },
  { key: 'contrast', label: 'Контрастность', min: -50, max: 50 },
  { key: 'sharpness', label: 'Резкость', min: -50, max: 50 },
  { key: 'volume', label: 'Громкость', min: -100, max: 100 },
  { key: 'duration', label: 'Длительность', min: -50, max: 50 },
  { key: 'rotation', label: 'Поворот (°)', min: -5, max: 5 },
  { key: 'zoom', label: 'Зум / кадрирование', min: 0, max: 20 },
];

// Вкладка 2: Параметры видео (§4.3 ТЗ).
export default function ParamsTab() {
  const params = useVubStore((s) => s.params);
  const setParam = useVubStore((s) => s.setParam);
  const upscale = useVubStore((s) => s.upscale);
  const setUpscale = useVubStore((s) => s.setUpscale);
  const randomSubset = useVubStore((s) => s.randomSubset);
  const setRandomSubset = useVubStore((s) => s.setRandomSubset);
  const pitch = params.pitch;

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Параметры видео
      </h2>

      <Block>
        <Checkbox
          checked={randomSubset}
          onChange={setRandomSubset}
          label="Случайный набор на каждое видео"
        />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0', lineHeight: 1.5 }}>
          Каждое видео применяет лишь <b>часть</b> включённых фильтров (~60%) — ролики в партии
          получаются по-настоящему разными. Метаданные, текст и хуки применяются <b>всегда</b>.
        </p>
      </Block>

      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Checkbox
            checked={upscale.enabled}
            onChange={(v) => setUpscale({ enabled: v })}
            label="Апскейл (повышение разрешения)"
          />
          <Select
            value={String(upscale.target)}
            options={UPSCALE_TARGETS}
            onChange={(v) => setUpscale({ target: Number(v) })}
          />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          Источник пересобирается рендером в более высокое разрешение (lanczos). Сильно меняет
          перцептивный хеш кадра. Если исходник уже больше цели — не трогаем.
        </p>
      </Block>

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

      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Checkbox
            checked={pitch.enabled}
            onChange={(v) => setParam('pitch', { enabled: v })}
            label="Аудио анти-fingerprint (тон + EQ + задержка)"
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {pitch.min > 0 ? `+${pitch.min}` : pitch.min} … {pitch.max > 0 ? `+${pitch.max}` : pitch.max} полут.
          </span>
        </div>
        <RangeSlider
          min={-6}
          max={6}
          step={0.5}
          valueMin={pitch.min}
          valueMax={pitch.max}
          onChange={(lo, hi) => setParam('pitch', { min: lo, max: hi })}
        />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          Сдвиг высоты звука (без изменения длительности) + 3-полосный EQ + микро-задержка.
          Двигает спектральные пики и баланс частот, по которым TikTok матчит музыку. ±1…2
          полутона почти незаметно на слух, но ломает акустический отпечаток. Больше — надёжнее.
        </p>
      </Block>
    </div>
  );
}
