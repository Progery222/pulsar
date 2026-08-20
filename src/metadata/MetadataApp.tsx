import { useMemo, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { mediaUrl, fileName } from '../utils/media';
import BatchPanel from './BatchPanel';
import { RandomOptions, DEFAULT_RAND, type RandOpts } from './RandomPanel';
import PresetBar, { usePresets, presetFields, type MetaPreset } from './PresetBar';
import LocationPicker from './LocationPicker';

type Row = { tag: string; label: string; value: string; editable: boolean };
type Group = { title: string; rows: Row[] };
type Summary = { camera: string | null; gps: string | null; shotDate: string | null; c2pa: boolean; stripped: boolean };
type Meta = {
  file: string; name: string; sizeKB: number; verdict: 'ai' | 'camera' | 'unknown'; verdictText: string;
  summary: Summary; groups: Group[]; gps: { lat: number; lon: number } | null;
  kind: 'image' | 'video'; writable: boolean; error?: string;
};

const VERDICT: Record<Meta['verdict'], { label: string; bg: string; fg: string }> = {
  ai: { label: '🤖 Похоже на ИИ-генерацию', bg: 'rgba(255,86,86,0.15)', fg: '#ff6b6b' },
  camera: { label: '📷 Похоже на реальную съёмку', bg: 'rgba(74,222,128,0.15)', fg: '#4ade80' },
  unknown: { label: '❔ Не определить точно', bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
};

// Часто нужные теги для кнопки «добавить поле» (список подсказок, вводить можно любой тег).
const COMMON_TAGS = [
  'Make', 'Model', 'LensModel', 'Software', 'DateTimeOriginal', 'CreateDate', 'ModifyDate',
  'Artist', 'Copyright', 'ImageDescription', 'UserComment', 'Rating', 'Keywords',
  'City', 'State', 'Country', 'Orientation', 'ISO', 'FNumber', 'ExposureTime', 'FocalLength',
  'XPTitle', 'XPComment', 'XPAuthor', 'XPKeywords', 'XPSubject',
];

const PLACEHOLDER: Record<string, string> = {
  __gps: '55.751244, 37.618423',
  DateTimeOriginal: '2024:05:01 13:45:07',
  CreateDate: '2024:05:01 13:45:07',
  ModifyDate: '2024:05:01 13:45:07',
};

export default function MetadataApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [tab, setTab] = useState<'one' | 'batch'>('one');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dels, setDels] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [rand, setRand] = useState<RandOpts>(DEFAULT_RAND);
  const [randOpen, setRandOpen] = useState(false);
  const [q, setQ] = useState('');
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const { presets, persist } = usePresets();
  const [mapOpen, setMapOpen] = useState(false);

  const dirty = Object.keys(edits).length > 0 || dels.length > 0;

  // «Прочие поля» — самая длинная секция, по умолчанию свёрнута.
  const isOpen = (title: string) => (q.trim() ? true : openMap[title] ?? !title.startsWith('Прочие'));
  const toggleGroup = (title: string) => setOpenMap((m) => ({ ...m, [title]: !isOpen(title) }));
  const setAllOpen = (v: boolean) => setOpenMap(Object.fromEntries([...(meta?.groups ?? []).map((g) => g.title), 'Новые поля'].map((t) => [t, v])));

  // Поиск режет строки внутри групп; пустые группы просто исчезают.
  const visibleGroups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const gs = meta?.groups ?? [];
    if (!s) return gs;
    return gs
      .map((g) => ({ ...g, rows: g.rows.filter((r) => (r.label + ' ' + r.tag + ' ' + r.value).toLowerCase().includes(s)) }))
      .filter((g) => g.rows.length);
  }, [meta, q]);
  const shownCount = visibleGroups.reduce((n, g) => n + g.rows.length, 0);

  const original = useMemo(() => {
    const m = new Map<string, string>();
    meta?.groups.forEach((g) => g.rows.forEach((r) => m.set(r.tag, r.value)));
    return m;
  }, [meta]);

  function reset() { setEdits({}); setDels([]); setAdded([]); setNewTag(''); setQ(''); setOpenMap({}); }

  async function load(file?: string | null) {
    const f = file ?? (await window.electronAPI.metaPick());
    if (!f) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.metaRead(f);
      if (res.error) showToast('Ошибка чтения: ' + res.error);
      setMeta(res);
      reset();
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (tab !== 'one') return; // в пакетном режиме дроп ловит BatchPanel
    const f = e.dataTransfer.files?.[0];
    if (f) load(window.electronAPI.getPathForFile(f));
  }

  function setVal(tag: string, value: string) {
    setDels((d) => d.filter((t) => t !== tag));
    setEdits((prev) => {
      const next = { ...prev };
      if (!added.includes(tag) && (original.get(tag) ?? '') === value) delete next[tag];
      else next[tag] = value;
      return next;
    });
  }

  function toggleDelete(tag: string) {
    setEdits((prev) => { const n = { ...prev }; delete n[tag]; return n; });
    setDels((d) => (d.includes(tag) ? d.filter((t) => t !== tag) : [...d, tag]));
  }

  function addField() {
    const tag = newTag.trim();
    if (!tag) return;
    if (original.has(tag) || added.includes(tag)) { showToast('Поле ' + tag + ' уже есть в списке'); return; }
    if (!/^[A-Za-z][A-Za-z0-9:_-]{1,60}$/.test(tag)) { showToast('Некорректное имя тега'); return; }
    setAdded((a) => [...a, tag]);
    setEdits((e) => ({ ...e, [tag]: '' }));
    setNewTag('');
  }

  // Пресет кладём в поля так же, как рандом: сначала видно, потом сохраняешь.
  function applyPreset(p: MetaPreset) {
    const gen = presetFields(p);
    const fresh = Object.keys(gen).filter((t) => !original.has(t) && !added.includes(t));
    setAdded((a) => [...a, ...fresh]);
    setDels((d) => d.filter((t) => !(t in gen)));
    setEdits((prev) => ({ ...prev, ...gen }));
    showToast('Применён пресет: ' + p.name);
  }

  // Что сохранять в пресет: правки плюс всё, что уже стоит в файле.
  function currentFields(): Record<string, string> {
    const out: Record<string, string> = {};
    original.forEach((v, k) => { if (v) out[k] = v; });
    return { ...out, ...edits };
  }

  // Случайное автозаполнение: подставляем в поля, но не пишем — можно поправить и только потом сохранить.
  async function fillRandom() {
    if (!meta) return;
    const gen = await window.electronAPI.metaRandom(rand, meta.kind);
    const fresh = Object.keys(gen).filter((t) => !original.has(t) && !added.includes(t));
    setAdded((a) => [...a, ...fresh]);
    setDels((d) => d.filter((t) => !(t in gen)));
    setEdits((prev) => ({ ...prev, ...gen }));
    showToast('Заполнено случайными значениями — проверь и сохрани');
  }

  async function save(mode: 'overwrite' | 'copy' | 'saveAs', stripAll = false) {
    if (!meta) return;
    let dest: string | undefined;
    if (mode === 'saveAs') {
      const p = await window.electronAPI.metaPickSavePath(meta.file);
      if (!p) return;
      dest = p;
    }
    setSaving(true);
    try {
      const res = await window.electronAPI.metaWrite({ file: meta.file, edits, deletes: dels, stripAll, mode, dest });
      if (res.error) { showToast('Не сохранено: ' + res.error); return; }
      setMeta(res);
      reset();
      showToast(mode === 'overwrite' ? 'Метаданные записаны в файл' : 'Сохранено: ' + res.name);
    } finally {
      setSaving(false);
    }
  }

  async function stripAll(mode: 'overwrite' | 'copy') {
    if (!meta) return;
    if (!window.confirm(mode === 'overwrite'
      ? 'Удалить ВСЕ метаданные прямо в файле? Отменить будет нельзя.'
      : 'Создать копию файла без единого метаданного поля?')) return;
    await save(mode, true);
  }

  const v = meta ? VERDICT[meta.verdict] : null;
  const ro = !!meta && !meta.writable;
  // Пустая GPS-строка есть всегда (чтобы можно было добавить гео) — «метаданных нет» считаем по значениям.
  const isEmpty = !!meta && meta.groups.every((g) => g.rows.every((r) => !r.value));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Метаданные — инспектор и редактор</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tab active={tab === 'one'} onClick={() => setTab('one')}>Одно фото</Tab>
          <Tab active={tab === 'batch'} onClick={() => setTab('batch')}>Пакет</Tab>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'one' && <button onClick={() => load()} style={btnPrimary}>Загрузить фото</button>}
        <button onClick={() => setAppMode('select')} style={btnSecondary}>На главную</button>
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
        {tab === 'batch' ? (
          <BatchPanel />
        ) : !meta ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => load()}
            style={{ height: '100%', minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: '2px dashed var(--border)', borderRadius: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 40 }}>🖼️</div>
            <div style={{ fontSize: 14 }}>{loading ? 'Читаю…' : 'Перетащи фото или видео сюда, или нажми, чтобы выбрать'}</div>
            <div style={{ fontSize: 11.5 }}>Фото: JPG · PNG · HEIC · WEBP · TIFF · Видео: MP4 · MOV · MKV · AVI</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Превью + вердикт */}
            <div style={{ width: 230, flexShrink: 0 }}>
              <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 8 }}>
                {meta.kind === 'video' ? (
                  <video key={meta.file} src={mediaUrl(meta.file)} controls muted style={{ width: '100%', maxHeight: 200, display: 'block' }} />
                ) : (
                  <img src={mediaUrl(meta.file)} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'contain', display: 'block' }} />
                )}
              </div>
              {v && (
                <div title={meta.verdictText} style={{ background: v.bg, color: v.fg, borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  {v.label}
                </div>
              )}
              <div title={meta.file} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName(meta.name)} · {meta.sizeKB} КБ
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button onClick={() => load()} style={btnMini}>🖼️ Другое</button>
                <button onClick={() => window.electronAPI.metaReveal(meta.file)} style={btnMini}>📂 В папке</button>
                {meta.gps && <button onClick={() => window.electronAPI.metaOpenMap(meta.gps!.lat, meta.gps!.lon)} style={{ ...btnMini, gridColumn: '1 / -1' }}>📍 На карте</button>}
                {!ro && <button disabled={saving} onClick={() => stripAll('copy')} style={btnMini}>🧹 Копия чистая</button>}
                {!ro && <button disabled={saving} onClick={() => stripAll('overwrite')} style={{ ...btnMini, border: '1px solid rgba(248,113,113,0.5)', color: '#f87171' }}>🧨 Стереть всё</button>}
              </div>
            </div>

            {/* Метаданные */}
            <div style={{ flex: 1, minWidth: 320 }}>
              {/* Итог по ключевым полям одной строкой — сразу видно, что есть, а чего нет */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <Chip label="📱 Камера" value={meta.summary.camera} />
                <Chip label="📍 GPS" value={meta.summary.gps} />
                <Chip label="🕑 Снято" value={meta.summary.shotDate} />
                <Chip label="🔏 C2PA" value={meta.summary.c2pa ? 'есть' : null} />
              </div>
              {meta.summary.stripped && (
                <div title="Telegram/WhatsApp/Instagram и т.п. чистят метаданные при пересылке. Чтобы увидеть телефон и гео — открой оригинал прямо с устройства, без сжатия."
                  style={{ marginBottom: 10, background: 'rgba(250,204,21,0.12)', color: '#facc15', borderRadius: 7, padding: '6px 10px', fontSize: 11 }}>
                  EXIF, похоже, вырезан при пересылке — камеры, GPS и даты в файле нет.
                </div>
              )}
              {ro && (
                <div style={{ marginBottom: 10, background: 'rgba(148,163,184,0.12)', color: 'var(--text-secondary)', borderRadius: 7, padding: '6px 10px', fontSize: 11 }}>
                  В этот формат запись метаданных не поддерживается — только просмотр.
                </div>
              )}

              {!ro && (
                <div style={{ marginBottom: 10 }}>
                  <PresetBar presets={presets} persist={persist} current={currentFields} onApply={applyPreset} />
                </div>
              )}

              {!ro && (
                <div style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={fillRandom} style={btnSecondary}>🎲 Заполнить случайно</button>
                    <button onClick={() => setMapOpen(true)} style={btnMini}>🗺 Место на карте</button>
                    <button onClick={() => setRandOpen((o) => !o)} style={btnMini}>{randOpen ? 'Свернуть' : 'Настроить'}</button>
                    <div style={{ flex: 1 }} />
                    <input
                      list="meta-tags"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addField(); }}
                      placeholder="Новый тег, напр. Artist"
                      style={{ ...inputBase, width: 170 }}
                    />
                    <datalist id="meta-tags">{COMMON_TAGS.map((t) => <option key={t} value={t} />)}</datalist>
                    <button onClick={addField} style={btnMini}>＋ Поле</button>
                  </div>
                  {randOpen && <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}><RandomOptions value={rand} onChange={setRand} /></div>}
                </div>
              )}

              {/* Поиск по полям + сворачивание — чтобы не листать длинный список */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Поиск по полям…" style={{ ...inputBase, flex: 1, maxWidth: 260 }} />
                {q && <button onClick={() => setQ('')} style={btnMini}>✕</button>}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{shownCount} полей</span>
                <button onClick={() => setAllOpen(true)} style={btnMini}>Развернуть всё</button>
                <button onClick={() => setAllOpen(false)} style={btnMini}>Свернуть всё</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 10, alignItems: 'start' }}>
                {visibleGroups.map((g) => (
                  <GroupBox key={g.title} title={g.title} count={g.rows.length} open={isOpen(g.title)} onToggle={() => toggleGroup(g.title)}>
                    {g.rows.map((r, i) => (
                      <FieldRow
                        key={r.tag + i}
                        row={r}
                        i={i}
                        readOnly={ro}
                        deleted={dels.includes(r.tag)}
                        changed={r.tag in edits}
                        value={edits[r.tag] ?? r.value}
                        onChange={(val) => setVal(r.tag, val)}
                        onDelete={() => toggleDelete(r.tag)}
                      />
                    ))}
                  </GroupBox>
                ))}

                {/* Добавленные вручную поля */}
                {added.length > 0 && (
                  <GroupBox title="Новые поля" count={added.length} open={isOpen('Новые поля')} onToggle={() => toggleGroup('Новые поля')}>
                    {added.map((tag, i) => (
                      <FieldRow
                        key={tag}
                        row={{ tag, label: tag, value: '', editable: true }}
                        i={i}
                        readOnly={ro}
                        deleted={false}
                        changed
                        value={edits[tag] ?? ''}
                        onChange={(val) => setVal(tag, val)}
                        onDelete={() => { setAdded((a) => a.filter((t) => t !== tag)); setEdits((e) => { const n = { ...e }; delete n[tag]; return n; }); }}
                      />
                    ))}
                  </GroupBox>
                )}
              </div>

              {q && visibleGroups.length === 0 && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, padding: 16, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  По запросу «{q}» ничего нет.
                </div>
              )}
              {!q && isEmpty && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, padding: 16, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, marginTop: 10 }}>
                  Метаданных в файле нет — можно заполнить поля выше и записать свои.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {mapOpen && (
        <LocationPicker
          value={edits['__gps'] ?? original.get('__gps') ?? ''}
          onPick={(c) => { setMapOpen(false); setVal('__gps', c); }}
          onClose={() => setMapOpen(false)}
        />
      )}

      {/* Панель сохранения — появляется, как только что-то изменено */}
      {tab === 'one' && meta && dirty && !ro && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Изменено полей: {Object.keys(edits).length}{dels.length ? ` · удалить: ${dels.length}` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <button disabled={saving} onClick={reset} style={btnSecondary}>Отменить правки</button>
          <button disabled={saving} onClick={() => save('saveAs')} style={btnSecondary}>💾 Сохранить как…</button>
          <button disabled={saving} onClick={() => save('copy')} style={btnSecondary}>Сохранить копию</button>
          <button disabled={saving} onClick={() => save('overwrite')} style={btnPrimary}>{saving ? 'Пишу…' : 'Записать в файл'}</button>
        </div>
      )}
    </div>
  );
}

// Сворачиваемая секция: заголовок + счётчик, в закрытом виде занимает одну строку.
function GroupBox({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', cursor: 'pointer', background: 'var(--bg-secondary)', userSelect: 'none' }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 9 }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{count}</span>
      </div>
      {open && children}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string | null }) {
  const has = !!value;
  return (
    <div title={value || 'нет в файле'} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 7, fontSize: 11.5, maxWidth: 300,
      border: `1px solid ${has ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.3)'}`,
      background: has ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.06)',
    }}>
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: has ? 'var(--text-primary)' : '#f87171', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{has ? value : 'нет'}</span>
    </div>
  );
}

function FieldRow({ row, i, value, changed, deleted, readOnly, onChange, onDelete }: {
  row: Row; i: number; value: string; changed: boolean; deleted: boolean; readOnly: boolean;
  onChange: (v: string) => void; onDelete: () => void;
}) {
  const editable = row.editable && !readOnly;
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '2px 8px', background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)', fontSize: 11.5 }}>
      <span title={row.label} style={{ width: 130, flexShrink: 0, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
      {editable ? (
        <input
          value={deleted ? '' : value}
          disabled={deleted}
          onChange={(e) => onChange(e.target.value)}
          placeholder={PLACEHOLDER[row.tag] ?? '— пусто —'}
          style={{
            ...inputBase,
            flex: 1,
            padding: '2px 5px',
            borderColor: deleted ? '#f87171' : changed ? 'var(--accent-green)' : 'transparent',
            background: deleted ? 'rgba(248,113,113,0.08)' : changed ? 'rgba(74,222,128,0.08)' : 'transparent',
            textDecoration: deleted ? 'line-through' : 'none',
          }}
        />
      ) : (
        <span title={row.value} style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: readOnly ? 1 : 0.75 }}>{row.value}</span>
      )}
      {editable && (
        <button
          onClick={onDelete}
          title={deleted ? 'Вернуть поле' : 'Удалить поле из файла'}
          style={{ border: 'none', background: 'transparent', color: deleted ? '#4ade80' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}
        >
          {deleted ? '↺' : '✕'}
        </button>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--accent-green)' : 'var(--border)'}`,
        background: active ? 'rgba(74,222,128,0.12)' : 'var(--bg-tertiary)',
        color: active ? 'var(--accent-green)' : 'var(--text-primary)',
      }}
    >
      {children}
    </button>
  );
}

const inputBase: React.CSSProperties = { padding: '4px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none', minWidth: 0 };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--accent-green)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const btnMini: React.CSSProperties = { padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' };
