import { useProjectStore } from '../store/projectStore';
import { shuffleMontage } from '../utils/regenerate';
import type { UniqualizerSettings } from '../types/uniqualizer';

type CheckKey = Exclude<keyof UniqualizerSettings, 'enabled'>;

const OPTIONS: { key: CheckKey; label: string; desc: string }[] = [
  { key: 'colorShift', label: 'Цветовой сдвиг', desc: 'Незаметное смещение цветового баланса' },
  { key: 'mirrorFlip', label: 'Зеркальный флип', desc: 'Горизонтальный флип + обратный флип (незаметно)' },
  { key: 'noise', label: 'Шум', desc: 'Добавить микро-зерно поверх видео' },
  { key: 'speed', label: 'Скорость', desc: 'Изменить скорость на ±0.5–2%' },
  { key: 'cropEdges', label: 'Обрезка краёв', desc: 'Обрезать 1–3px по краям и растянуть обратно' },
  { key: 'audioShift', label: 'Аудио сдвиг', desc: 'Сдвинуть аудиодорожку на 10–50ms' },
  { key: 'reverse', label: 'Реверс видео', desc: 'Проиграть видео и звук задом наперёд' },
];

const COUNTS = [1, 10, 20, 40, 50, 100];

export default function UniqualizerPanel() {
  const settings = useProjectStore((s) => s.uniqualizerSettings);
  const setSettings = useProjectStore((s) => s.setUniqualizerSettings);
  const count = useProjectStore((s) => s.uniqualizerCount);
  const setCount = useProjectStore((s) => s.setUniqualizerCount);
  const hasMontage = useProjectStore((s) => !!s.beatData);

  return (
    <div className="mb-4 border-t border-border pt-4">
      {/* Заголовок + iOS-toggle */}
      <div className="mb-2 flex items-center justify-between">
        <span
          className="uppercase text-text-secondary"
          style={{ fontSize: 12, letterSpacing: 1 }}
        >
          Уникализация
        </span>
        <button
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => setSettings({ enabled: !settings.enabled })}
          className="relative rounded-full transition-colors"
          style={{
            width: 40,
            height: 22,
            backgroundColor: settings.enabled ? 'var(--accent-green)' : 'var(--bg-tertiary)',
          }}
        >
          <span
            className="absolute rounded-full bg-white transition-all"
            style={{ width: 18, height: 18, top: 2, left: settings.enabled ? 20 : 2 }}
          />
        </button>
      </div>

      {/* Раскрывающаяся панель */}
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: settings.enabled ? 600 : 0, opacity: settings.enabled ? 1 : 0 }}
      >
        {/* Количество уникальных копий */}
        <div className="mb-3">
          <div className="mb-1 text-text-primary" style={{ fontSize: 13 }}>
            Количество уникальных роликов
          </div>
          <div className="flex flex-wrap gap-2">
            {COUNTS.map((c) => {
              const sel = c === count;
              return (
                <button
                  key={c}
                  onClick={() => setCount(c)}
                  className="rounded-el px-3 py-1 font-semibold"
                  style={{
                    fontSize: 13,
                    backgroundColor: sel ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    color: sel ? '#000' : 'var(--text-primary)',
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {hasMontage && (
            <button
              onClick={() => shuffleMontage()}
              title="Перемешать порядок клипов в монтаже"
              className="mt-2 rounded-el px-3 py-1.5 font-semibold"
              style={{ fontSize: 13, backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              ⤮ Перемешать порядок
            </button>
          )}
        </div>

        {/* Блок «Авто» */}
        <p className="mb-3 text-text-secondary" style={{ fontSize: 11 }}>
          Метаданные, хэш файла и технические параметры изменяются автоматически
        </p>

        {/* Режим «Видимая вариация» */}
        <label
          className="mb-3 flex cursor-pointer items-start gap-2 rounded-el p-2"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          <input
            type="checkbox"
            checked={settings.visibleVariation}
            onChange={(e) => setSettings({ visibleVariation: e.target.checked })}
            className="mt-0.5 accent-[var(--accent-green)]"
          />
          <span>
            <span className="block font-semibold text-text-primary" style={{ fontSize: 13 }}>
              Видимая вариация
            </span>
            <span className="block text-text-secondary" style={{ fontSize: 11 }}>
              Каждая копия с заметно разным фильтром, зумом и отражением — реально разные ролики, а не только разный хэш
            </span>
          </span>
        </label>

        {/* Блок «Дополнительно» */}
        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt) => (
            <label key={opt.key} className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={settings[opt.key]}
                onChange={(e) => setSettings({ [opt.key]: e.target.checked })}
                className="mt-0.5 accent-[var(--accent-green)]"
              />
              <span>
                <span className="block text-text-primary" style={{ fontSize: 13 }}>
                  {opt.label}
                </span>
                <span className="block text-text-secondary" style={{ fontSize: 11 }}>
                  {opt.desc}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
