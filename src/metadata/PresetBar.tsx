import { useEffect, useState } from 'react';
import { showToast } from '../store/toastStore';
import LocationPicker from './LocationPicker';
import { parseCoords, formatCoords, jitterCoords } from './geo';

// Пресет: «свой шаблон» полей метаданных, который применяется к любому файлу.
// Место хранится как базовая точка + радиус разброса, поэтому у каждого файла
// координаты получаются свои — рядом, но не совпадающие до шестого знака.

export interface MetaPreset {
  id: string;
  name: string;
  fields: Record<string, string>;
  gps?: { lat: number; lon: number; jitterKm: number };
  updatedAt: number;
}

const GPS_KEY = '__gps';

// Координаты пресета на один конкретный файл — со свежим разбросом.
export function presetCoords(p: MetaPreset): string | null {
  if (!p.gps) return p.fields[GPS_KEY] ?? null;
  return formatCoords(jitterCoords({ lat: p.gps.lat, lon: p.gps.lon }, p.gps.jitterKm));
}

// Поля пресета для применения: место каждый раз пересчитывается заново.
export function presetFields(p: MetaPreset): Record<string, string> {
  const out = { ...p.fields };
  const c = presetCoords(p);
  if (c) out[GPS_KEY] = c;
  return out;
}

export function usePresets() {
  const [presets, setPresets] = useState<MetaPreset[]>([]);

  useEffect(() => {
    window.electronAPI.metaPresetsLoad().then(setPresets);
  }, []);

  async function persist(next: MetaPreset[]) {
    setPresets(next);
    const res = await window.electronAPI.metaPresetsSave(next);
    if (res && 'error' in res) showToast('Пресеты не сохранились: ' + res.error);
  }

  return { presets, persist };
}

export default function PresetBar({
  presets,
  persist,
  current,
  onApply,
  selectedId,
  onSelect,
}: {
  presets: MetaPreset[];
  persist: (next: MetaPreset[]) => void | Promise<void>;
  /** Текущие поля — из них собирается новый пресет. */
  current: () => Record<string, string>;
  onApply: (preset: MetaPreset) => void;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const [ownSelected, setOwnSelected] = useState('');
  const selected = selectedId ?? ownSelected;
  const setSelected = (id: string) => {
    setOwnSelected(id);
    onSelect?.(id);
  };
  const [mapOpen, setMapOpen] = useState(false);
  // Имя нового пресета вводится прямо в панели: window.prompt в Electron не
  // поддерживается и бросает исключение — сохранение молча не доходило до диска.
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const preset = presets.find((p) => p.id === selected) ?? null;

  function startNaming() {
    if (!Object.keys(current()).length) {
      showToast('Нечего сохранять — сначала заполни поля');
      return;
    }
    setDraftName('Мой шаблон');
    setNaming(true);
  }

  async function saveNew() {
    const fields = current();
    const name = draftName.trim();
    if (!name) return;
    setNaming(false);

    // Координаты из полей запоминаем как базовую точку с разбросом по умолчанию.
    const c = parseCoords(fields[GPS_KEY] ?? '');
    const item: MetaPreset = {
      id: 'p' + Date.now() + Math.floor(Math.random() * 1000),
      name: name.trim(),
      fields,
      gps: c ? { lat: c.lat, lon: c.lon, jitterKm: 2 } : undefined,
      updatedAt: Date.now(),
    };
    await persist([...presets, item]);
    setSelected(item.id);
    showToast('Пресет сохранён: ' + item.name);
  }

  async function overwrite() {
    if (!preset) return;
    if (!window.confirm('Переписать пресет «' + preset.name + '» текущими полями?')) return;
    const fields = current();
    const c = parseCoords(fields[GPS_KEY] ?? '');
    await persist(
      presets.map((p) =>
        p.id === preset.id
          ? {
              ...p,
              fields,
              gps: c ? { lat: c.lat, lon: c.lon, jitterKm: p.gps?.jitterKm ?? 2 } : undefined,
              updatedAt: Date.now(),
            }
          : p,
      ),
    );
    showToast('Пресет обновлён');
  }

  async function remove() {
    if (!preset) return;
    if (!window.confirm('Удалить пресет «' + preset.name + '»?')) return;
    await persist(presets.filter((p) => p.id !== preset.id));
    setSelected('');
  }

  async function setJitter(km: number) {
    if (!preset || !preset.gps) return;
    const base = preset.gps;
    await persist(
      presets.map((p) =>
        p.id === preset.id ? { ...p, gps: { ...base, jitterKm: km }, updatedAt: Date.now() } : p,
      ),
    );
  }

  async function pickPlace(coords: string) {
    setMapOpen(false);
    const c = parseCoords(coords);
    if (!c || !preset) return;
    await persist(
      presets.map((p) =>
        p.id === preset.id
          ? { ...p, gps: { lat: c.lat, lon: c.lon, jitterKm: p.gps?.jitterKm ?? 2 }, updatedAt: Date.now() }
          : p,
      ),
    );
    showToast('Место пресета обновлено');
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Пресет</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ ...input, minWidth: 170 }}>
          <option value="">— не выбран —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <button
          disabled={!preset}
          onClick={() => preset && onApply(preset)}
          style={{ ...btnPrimary, opacity: preset ? 1 : 0.45 }}
        >
          Применить
        </button>
        <button onClick={startNaming} style={btnMini}>💾 Сохранить как пресет</button>
        {preset && <button onClick={overwrite} style={btnMini}>Перезаписать</button>}
        {preset && <button onClick={remove} style={{ ...btnMini, color: '#f87171' }}>Удалить</button>}
      </div>

      {naming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveNew();
              if (e.key === 'Escape') setNaming(false);
            }}
            placeholder="Название пресета"
            style={{ ...input, flex: 1, maxWidth: 260 }}
          />
          <button onClick={saveNew} disabled={!draftName.trim()} style={{ ...btnPrimary, opacity: draftName.trim() ? 1 : 0.45 }}>
            Сохранить
          </button>
          <button onClick={() => setNaming(false)} style={btnMini}>Отмена</button>
        </div>
      )}

      {preset && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Полей: {Object.keys(preset.fields).length}
          </span>
          <span style={{ fontSize: 11, color: preset.gps ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {preset.gps
              ? '📍 ' + preset.gps.lat.toFixed(4) + ', ' + preset.gps.lon.toFixed(4)
              : '📍 место не задано'}
          </span>
          <button onClick={() => setMapOpen(true)} style={btnMini}>🗺 Выбрать на карте</button>

          {preset.gps && (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>разброс</span>
              <select
                value={preset.gps.jitterKm}
                onChange={(e) => setJitter(Number(e.target.value))}
                style={{ ...input, width: 96 }}
              >
                {[0, 0.5, 1, 2, 3, 5, 10, 20].map((km) => (
                  <option key={km} value={km}>{km === 0 ? 'точно' : km + ' км'}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {preset && preset.gps && preset.gps.jitterKm > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.35 }}>
          Координаты считаются заново для каждого файла — точка попадает случайно в круг
          {' ' + preset.gps.jitterKm} км вокруг выбранной, поэтому у пачки они не совпадают.
        </div>
      )}

      {mapOpen && (
        <LocationPicker
          value={preset && preset.gps ? preset.gps.lat + ', ' + preset.gps.lon : ''}
          onPick={pickPlace}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}

const input: React.CSSProperties = { padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' };
const btnPrimary: React.CSSProperties = { padding: '5px 12px', borderRadius: 7, border: 'none', background: 'var(--accent-green)', color: 'var(--accent-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const btnMini: React.CSSProperties = { padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' };
