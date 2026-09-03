import { useEffect, useState } from 'react';

// Опции автозаполнения «снято на телефон X, в городе Y, тогда-то».
export type RandOpts = {
  device: boolean; shot: boolean; gps: boolean; date: boolean;
  city?: string | null; deviceModel?: string | null; dateFrom?: string; dateTo?: string;
};

export const DEFAULT_RAND: RandOpts = { device: true, shot: true, gps: true, date: true, city: null, deviceModel: null, dateFrom: '', dateTo: '' };

// Каталог телефонов/городов живёт в main — тянем один раз и кэшируем на модуль.
let cache: { devices: string[]; cities: string[]; encoders: string[]; genres: string[] } | null = null;

const EMPTY_CATALOG = { devices: [], cities: [], encoders: [], genres: [] };

export function useMetaCatalog() {
  const [cat, setCat] = useState(cache);
  useEffect(() => {
    if (cache) return;
    window.electronAPI.metaCatalog().then((c) => { cache = c; setCat(c); });
  }, []);
  // Подставляем недостающие списки, а не отдаём то, что пришло, как есть:
  // старая сборка main могла не знать про новые поля, и перебор undefined
  // ронял бы весь интерфейс в чёрный экран вместо пустого выпадающего списка.
  return { ...EMPTY_CATALOG, ...(cat ?? {}) };
}

export function RandomOptions({ value, onChange, kind = 'image' }: {
  value: RandOpts;
  onChange: (v: RandOpts) => void;
  kind?: 'image' | 'video' | 'audio';
}) {
  const cat = useMetaCatalog();
  const set = (patch: Partial<RandOpts>) => onChange({ ...value, ...patch });

  // У звука те же переключатели означают другое: телефон и координаты к музыке
  // отношения не имеют, вместо них — кодировщик и жанр. Поля переиспользуются
  // (device → кодировщик, shot → жанр, deviceModel/city → конкретные значения),
  // чтобы не заводить второй набор настроек ради трёх опций.
  if (kind === 'audio') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Check label="Кодировщик" checked={value.device} onChange={(v) => set({ device: v })} hint="чем собран файл: LAME, FL Studio, Ableton…" />
          <Check label="Жанр" checked={value.shot} onChange={(v) => set({ shot: v })} hint="жанр из стандартного списка ID3" />
          <Check label="Год" checked={value.date} onChange={(v) => set({ date: v })} hint="случайный год в диапазоне" />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={value.deviceModel ?? ''} onChange={(e) => set({ deviceModel: e.target.value || null })} style={select} disabled={!value.device}>
            <option value="">🎛 Кодировщик: случайный</option>
            {cat.encoders.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={value.city ?? ''} onChange={(e) => set({ city: e.target.value || null })} style={select} disabled={!value.shot}>
            <option value="">🎵 Жанр: случайный</option>
            {cat.genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label style={dateLbl}>
            с <input type="date" value={value.dateFrom || ''} onChange={(e) => set({ dateFrom: e.target.value })} style={dateInp} disabled={!value.date} />
          </label>
          <label style={dateLbl}>
            по <input type="date" value={value.dateTo || ''} onChange={(e) => set({ dateTo: e.target.value })} style={dateInp} disabled={!value.date} />
          </label>
        </div>

        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
          Исполнитель, название и альбом не подставляются: это авторство, его вы заполняете сами.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Check label="Телефон" checked={value.device} onChange={(v) => set({ device: v })} hint="Make / Model / Software / объектив" />
        <Check label="Параметры съёмки" checked={value.shot} onChange={(v) => set({ shot: v })} hint="выдержка, диафрагма, ISO, фокусное" />
        <Check label="GPS" checked={value.gps} onChange={(v) => set({ gps: v })} hint="координаты со сдвигом внутри города" />
        <Check label="Дата съёмки" checked={value.date} onChange={(v) => set({ date: v })} hint="случайный день в диапазоне, время дневное" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={value.deviceModel ?? ''} onChange={(e) => set({ deviceModel: e.target.value || null })} style={select} disabled={!value.device && !value.shot}>
          <option value="">📱 Телефон: случайный</option>
          {cat.devices.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {/* Текстовое поле с подсказками вместо списка: в каталоге 34 тысячи
            городов, и любой из них можно просто напечатать — «Ош», «Бишкек», «Osh». */}
        <input
          list="meta-cities"
          value={value.city ?? ''}
          onChange={(e) => set({ city: e.target.value || null })}
          placeholder="📍 Город: случайный — или введите свой"
          style={{ ...select, minWidth: 220 }}
          disabled={!value.gps}
        />
        <datalist id="meta-cities">
          {cat.cities.map((c) => <option key={c} value={c} />)}
        </datalist>
        <label style={dateLbl}>
          с <input type="date" value={value.dateFrom || ''} onChange={(e) => set({ dateFrom: e.target.value })} style={dateInp} disabled={!value.date} />
        </label>
        <label style={dateLbl}>
          по <input type="date" value={value.dateTo || ''} onChange={(e) => set({ dateTo: e.target.value })} style={dateInp} disabled={!value.date} />
        </label>
      </div>
      {value.date && !value.dateFrom && !value.dateTo && (
        <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Диапазон не задан — берётся последний год.</div>
      )}
    </div>
  );
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label title={hint} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--accent-green)' }} />
      {label}
    </label>
  );
}

const select: React.CSSProperties = { padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none' };
const dateLbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary)' };
const dateInp: React.CSSProperties = { ...select, padding: '4px 6px', colorScheme: 'dark' };
