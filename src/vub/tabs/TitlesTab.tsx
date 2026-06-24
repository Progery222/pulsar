import { useEffect, useState } from 'react';
import { useVubStore, type TitlesStyle } from '../store';
import { Block, Checkbox, Select, Slider, Switch } from '../components/ui';

// Вкладка «Титры»: авто-транскрибация речи (AssemblyAI) + стиль наложения.
export default function TitlesTab() {
  const titles = useVubStore((s) => s.titles);
  const setTitles = useVubStore((s) => s.setTitles);
  const videos = useVubStore((s) => s.videos);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    window.electronAPI.getVubApiKey().then((k) => setApiKey(k || ''));
  }, []);

  async function saveKey() {
    await window.electronAPI.setVubApiKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function testTranscribe() {
    if (!videos.length) {
      setTestResult('Сначала добавьте видео на вкладке «Загруженные видео».');
      return;
    }
    setTesting(true);
    setTestResult('Сохраняю ключ и распознаю первый ролик…');
    await window.electronAPI.setVubApiKey(apiKey.trim());
    const r = await window.electronAPI.testVubTranscribe(videos[0].path, titles.language);
    setTesting(false);
    if ('error' in r) setTestResult(`Ошибка: ${r.error}`);
    else if (!r.count) setTestResult('Речь не распознана (нет голоса или только музыка).');
    else setTestResult(`Распознано (${r.count} слов): ${r.text}`);
  }

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Титры (авто-субтитры из речи)
      </h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Switch checked={titles.enabled} onChange={(v) => setTitles({ enabled: v })} />
        <span style={{ fontSize: 14 }}>Распознавать речь и накладывать титры</span>
      </div>

      {/* API-ключ */}
      <Block>
        <div style={{ fontSize: 14, marginBottom: 8 }}>API-ключ AssemblyAI</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="вставьте ключ"
            style={{ flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
          />
          <button onClick={saveKey} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
            {saved ? 'Сохранено ✓' : 'Сохранить'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, marginBottom: 10 }}>
          Ключ хранится локально (зашифровано), в проект не попадает. Распознавание происходит при экспорте.
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

      {/* Стиль */}
      <Block>
        <div style={{ fontSize: 14, marginBottom: 12, fontWeight: 600 }}>Стиль титров</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Checkbox checked={titles.karaoke} onChange={(v) => setTitles({ karaoke: v })} label="Караоке (подсветка слов)" />
          <Checkbox checked={titles.uppercase} onChange={(v) => setTitles({ uppercase: v })} label="ЗАГЛАВНЫЕ" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Шрифт
            <div style={{ marginTop: 6 }}>
              <Select
                value={titles.font}
                options={[
                  { value: 'Arial', label: 'Arial' },
                  { value: 'Arial Black', label: 'Arial Black' },
                  { value: 'Impact', label: 'Impact' },
                  { value: 'Verdana', label: 'Verdana' },
                  { value: 'Tahoma', label: 'Tahoma' },
                ]}
                onChange={(font) => setTitles({ font })}
              />
            </div>
          </label>

          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Позиция
            <div style={{ marginTop: 6 }}>
              <Select<TitlesStyle['position']>
                value={titles.position}
                options={[
                  { value: 'top', label: 'Сверху' },
                  { value: 'center', label: 'По центру' },
                  { value: 'bottom', label: 'Снизу' },
                ]}
                onChange={(position) => setTitles({ position })}
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
      </Block>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Текст распознаётся один раз для каждого исходного видео; во всех вариациях слова одинаковые,
        отличается оформление и положение. Если речи нет — титры не добавляются.
      </p>
    </div>
  );
}
