import { useEffect, useState } from 'react';
import { useVubStore } from '../store';
import { Block, Checkbox, Select, Slider, Switch } from '../components/ui';
import TitlePreview from '../components/TitlePreview';
import Scrubber from '../components/Scrubber';
import { BUILTIN_TITLE_PRESETS, styleFromTitles, type TitlePreset } from '../titlePresets';

// Встроенные (зашитые в assets/fonts, с кириллицей) + системные шрифты.
const FONT_OPTIONS = [
  { value: 'Montserrat', label: 'Montserrat (встроен)' },
  { value: 'Oswald', label: 'Oswald — узкий (встроен)' },
  { value: 'Rubik', label: 'Rubik — округлый (встроен)' },
  { value: 'Fira Sans', label: 'Fira Sans (встроен)' },
  { value: 'Russo One', label: 'Russo One — жирный (встроен)' },
  { value: 'Arial', label: 'Arial (системный)' },
  { value: 'Arial Black', label: 'Arial Black (системный)' },
  { value: 'Impact', label: 'Impact (системный)' },
];

// Вкладка «Титры»: авто-транскрибация речи (AssemblyAI) + стиль наложения.
export default function TitlesTab() {
  const titles = useVubStore((s) => s.titles);
  const setTitles = useVubStore((s) => s.setTitles);
  const videos = useVubStore((s) => s.videos);
  const [hasKey, setHasKey] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);
  const [customPresets, setCustomPresets] = useState<TitlePreset[]>([]);

  useEffect(() => {
    window.electronAPI.getVubApiKey().then((k) => setHasKey(!!k));
    window.electronAPI.getSetting('titlePresets').then((p) => {
      if (Array.isArray(p)) setCustomPresets(p as TitlePreset[]);
    });
  }, []);

  function applyPreset(p: TitlePreset) {
    setTitles(p.style);
  }
  async function saveCurrentAsPreset() {
    const name = window.prompt('Название пресета:');
    if (!name?.trim()) return;
    const next = [
      ...customPresets,
      { id: `${Date.now()}`, name: name.trim(), style: styleFromTitles(titles) },
    ];
    setCustomPresets(next);
    await window.electronAPI.setSetting('titlePresets', next);
  }
  async function deletePreset(id: string) {
    const next = customPresets.filter((p) => p.id !== id);
    setCustomPresets(next);
    await window.electronAPI.setSetting('titlePresets', next);
  }
  // Быстрое размещение: X по центру, Y — верх/центр/низ.
  function placeTitle(posYPct: number) {
    setTitles({ posXPct: 50, posYPct });
  }

  async function testTranscribe() {
    if (!videos.length) {
      setTestResult('Сначала добавьте видео на вкладке «Загруженные видео».');
      return;
    }
    setTesting(true);
    setTestResult('Распознаю первый ролик…');
    const r = await window.electronAPI.testVubTranscribe(videos[0].path, titles.language);
    setTesting(false);
    if ('error' in r) setTestResult(`Ошибка: ${r.error}`);
    else if (!r.count) setTestResult('Речь не распознана (нет голоса или только музыка).');
    else setTestResult(`Распознано (${r.count} слов): ${r.text}`);
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Титры (авто-субтитры из речи)
      </h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Switch checked={titles.enabled} onChange={(v) => setTitles({ enabled: v })} />
        <span style={{ fontSize: 14 }}>Распознавать речь и накладывать титры</span>
      </div>

      {/* API-ключ задаётся централизованно в Настройках (стартовый экран). */}
      <Block>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Распознавание речи (AssemblyAI)</div>
        <p style={{ fontSize: 12, color: hasKey ? 'var(--text-secondary)' : 'var(--danger)', marginTop: 0, marginBottom: 10 }}>
          {hasKey
            ? 'API-ключ настроен. Изменить можно в «Настройках» на стартовом экране.'
            : 'API-ключ не задан. Откройте «Настройки» на стартовом экране и вставьте ключ AssemblyAI.'}
        </p>
        <button
          onClick={testTranscribe}
          disabled={testing}
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', opacity: testing ? 0.5 : 1 }}
        >
          {testing ? 'Распознаю…' : 'Тест распознавания (1-й ролик)'}
        </button>
        {testResult && (
          <p style={{ fontSize: 13, color: testResult.startsWith('Ошибка') ? 'var(--danger)' : 'var(--text-primary)', marginTop: 10, marginBottom: 0, lineHeight: 1.4 }}>
            {testResult}
          </p>
        )}
      </Block>

      {/* Язык */}
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>Язык речи</span>
          <Select
            value={titles.language}
            options={[
              { value: 'auto', label: 'Авто-определение' },
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
              { value: 'de', label: 'Deutsch' },
            ]}
            onChange={(language) => setTitles({ language })}
          />
        </div>
      </Block>

      {/* Пресеты стиля */}
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Пресеты титров</span>
          <button
            onClick={saveCurrentAsPreset}
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            + Сохранить текущий
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {BUILTIN_TITLE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 16, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}
            >
              {p.name}
            </button>
          ))}
          {customPresets.map((p) => (
            <span
              key={p.id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-tertiary)', border: '1px solid var(--accent-green)', borderRadius: 16, padding: '6px 10px 6px 14px', fontSize: 12 }}
            >
              <button onClick={() => applyPreset(p)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: 0, fontSize: 12 }}>
                {p.name}
              </button>
              <button onClick={() => deletePreset(p.id)} title="Удалить" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>
                ✕
              </button>
            </span>
          ))}
        </div>
      </Block>

      {/* Стиль */}
      <Block>
        <div style={{ fontSize: 14, marginBottom: 12, fontWeight: 600 }}>Стиль титров</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Checkbox checked={titles.karaoke} onChange={(v) => setTitles({ karaoke: v })} label="Караоке (подсветка слов)" />
          <Checkbox checked={titles.uppercase} onChange={(v) => setTitles({ uppercase: v })} label="ЗАГЛАВНЫЕ" />
          <Checkbox checked={titles.bold} onChange={(v) => setTitles({ bold: v })} label="Жирный" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
            Шрифт
            <div style={{ marginTop: 6 }}>
              <Select
                value={titles.font}
                options={FONT_OPTIONS}
                onChange={(font) => setTitles({ font })}
              />
            </div>
          </label>

          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Цвет текста
            <input
              type="color"
              value={titles.baseColor}
              onChange={(e) => setTitles({ baseColor: e.target.value.toUpperCase() })}
              style={{ display: 'block', marginTop: 6, width: '100%', height: 36, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8 }}
            />
          </label>

          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Цвет подсветки
            <input
              type="color"
              value={titles.highlightColor}
              onChange={(e) => setTitles({ highlightColor: e.target.value.toUpperCase() })}
              style={{ display: 'block', marginTop: 6, width: '100%', height: 36, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Размер шрифта</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{titles.fontSize}px</span>
          </div>
          <Slider min={24} max={140} value={titles.fontSize} onChange={(v) => setTitles({ fontSize: v })} />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Обводка</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{titles.outline}px</span>
          </div>
          <Slider min={0} max={10} value={titles.outline} onChange={(v) => setTitles({ outline: v })} />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Слов в строке</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{titles.maxWordsPerLine}</span>
          </div>
          <Slider min={1} max={8} value={titles.maxWordsPerLine} onChange={(v) => setTitles({ maxWordsPerLine: v })} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Быстрое размещение</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { label: 'Верх', y: 12 },
              { label: 'Центр', y: 50 },
              { label: 'Низ', y: 88 },
            ].map((b) => {
              const active = titles.posXPct === 50 && titles.posYPct === b.y;
              return (
                <button
                  key={b.label}
                  onClick={() => placeTitle(b.y)}
                  style={{
                    flex: 1,
                    background: active ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    color: active ? '#0D0D0D' : 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 0',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Scrubber label="Позиция X, %" value={titles.posXPct} min={0} max={100} suffix="%" onChange={(v) => setTitles({ posXPct: v })} />
          <Scrubber label="Позиция Y, %" value={titles.posYPct} min={0} max={100} suffix="%" onChange={(v) => setTitles({ posYPct: v })} />
        </div>
      </Block>

      {/* Подложка */}
      <Block>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Checkbox checked={titles.bg.enabled} onChange={(v) => setTitles({ bg: { ...titles.bg, enabled: v } })} label="Подложка под текстом" />
          <input
            type="color"
            value={titles.bg.color}
            onChange={(e) => setTitles({ bg: { ...titles.bg, color: e.target.value.toUpperCase() } })}
            style={{ width: 44, height: 32, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8 }}
          />
        </div>
        <div style={{ maxWidth: 320 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Затемнение (непрозрачность)</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{titles.bg.opacity}%</span>
          </div>
          <Slider min={0} max={100} value={titles.bg.opacity} onChange={(v) => setTitles({ bg: { ...titles.bg, opacity: v } })} />
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
            Подложка автоматически обтягивает текст (и перенос строк) — ничего не вылезает за рамку.
          </p>
        </div>
      </Block>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Текст распознаётся один раз для каждого исходного видео; во всех вариациях слова одинаковые,
        отличается оформление и положение. Если речи нет — титры не добавляются.
      </p>
      </div>

      <div style={{ width: 240, flexShrink: 0, position: 'sticky', top: 0 }}>
        <TitlePreview
          style={titles}
          onMove={(x, y) => setTitles({ posXPct: x, posYPct: y })}
          videoSrc={videos[0] ? `media:///${encodeURIComponent(videos[0].path)}` : undefined}
        />
      </div>
    </div>
  );
}
