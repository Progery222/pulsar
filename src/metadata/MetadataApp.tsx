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

const VERDICT: Record<Meta['verdict'], { label: string; fg: string }> = {
  ai: { label: 'Похоже на ИИ-генерацию', fg: '#ff6b6b' },
  camera: { label: 'Похоже на реальную съёмку', fg: '#4ade80' },
  unknown: { label: 'Не определить точно', fg: '#94a3b8' },
};

const GPS = '__gps';

// «Главное» — поля, ради которых сюда и приходят. Показываются всегда, даже если
// в файле их нет: пустая строка сразу готова к заполнению. Раньше отсутствующее
// поле просто не рисовалось, и добавлять его приходилось вручную по имени тега.
const KEY_FIELDS: { tag: string; label: string; placeholder?: string; kind?: 'image' | 'video' }[] = [
  { tag: 'Make', label: 'Производитель', placeholder: 'Apple' },
  { tag: 'Model', label: 'Модель', placeholder: 'iPhone 15 Pro' },
  { tag: GPS, label: 'Координаты', placeholder: '55.751244, 37.618423' },
  { tag: 'DateTimeOriginal', label: 'Дата съёмки', placeholder: '2024:05:01 13:45:07', kind: 'image' },
  { tag: 'CreateDate', label: 'Дата съёмки', placeholder: '2024:05:01 13:45:07', kind: 'video' },
  { tag: 'Software', label: 'Прошивка / софт', placeholder: '17.5.1' },
];

const COMMON_TAGS = [
  'Make', 'Model', 'LensModel', 'Software', 'DateTimeOriginal', 'CreateDate', 'ModifyDate',
  'Artist', 'Copyright', 'ImageDescription', 'UserComment', 'Rating', 'Keywords',
  'City', 'State', 'Country', 'Orientation', 'ISO', 'FNumber', 'ExposureTime', 'FocalLength',
];

type Popover = 'none' | 'random' | 'preset' | 'clean' | 'field';

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
  const [pop, setPop] = useState<Popover>('none');
  const [allOpen, setAllOpen] = useState(false);
  const [q, setQ] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const { presets, persist } = usePresets();

  const dirty = Object.keys(edits).length > 0 || dels.length > 0;

  const original = useMemo(() => {
    const m = new Map<string, string>();
    meta?.groups.forEach((g) => g.rows.forEach((r) => m.set(r.tag, r.value)));
    return m;
  }, [meta]);

  // Только те теги, которые вообще можно записать. Нужно для пресета: раньше он
  // забирал все строки подряд — включая подписи C2PA и вычисляемые поля вроде
  // размеров кадра, — и запись падала на первом же непригодном имени.
  const editableTags = useMemo(() => {
    const s = new Set<string>(KEY_FIELDS.map((f) => f.tag));
    meta?.groups.forEach((g) => g.rows.forEach((r) => { if (r.editable) s.add(r.tag); }));
    return s;
  }, [meta]);

  const valueOf = (tag: string) => edits[tag] ?? original.get(tag) ?? '';

  // «Все поля» — то, что раньше висело на экране постоянно. Теперь свёрнуто:
  // 40–60 сырых тегов нужны редко, а места занимали больше, чем всё остальное.
  const allRows = useMemo(() => {
    const keyTags = new Set(KEY_FIELDS.map((f) => f.tag));
    const s = q.trim().toLowerCase();
    return (meta?.groups ?? [])
      .map((g) => ({
        ...g,
        rows: g.rows.filter(
          (r) => !keyTags.has(r.tag) && (!s || (r.label + ' ' + r.tag + ' ' + r.value).toLowerCase().includes(s)),
        ),
      }))
      .filter((g) => g.rows.length);
  }, [meta, q]);
  const allCount = allRows.reduce((n, g) => n + g.rows.length, 0);

  function reset() { setEdits({}); setDels([]); setAdded([]); setNewTag(''); setQ(''); setPop('none'); }

  async function load(file?: string | null) {
    const f = file ?? (await window.electronAPI.metaPick());
    if (!f) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.metaRead(f);
      if (res.error) showToast('Ошибка чтения: ' + res.error);
      setMeta(res);
      reset();
      setAllOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (tab !== 'one') return;
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
    if (original.has(tag) || added.includes(tag)) { showToast('Поле ' + tag + ' уже есть'); return; }
    if (!/^[A-Za-z][A-Za-z0-9:_-]{1,60}$/.test(tag)) { showToast('Некорректное имя тега'); return; }
    setAdded((a) => [...a, tag]);
    setEdits((e) => ({ ...e, [tag]: '' }));
    setNewTag('');
    setAllOpen(true);
    setPop('none');
  }

  // Подстановка набора значений (рандом или пресет). Ключевые поля уже показаны
  // сверху, поэтому в «новые» их не дублируем.
  function mergeIn(gen: Record<string, string>) {
    const fresh = Object.keys(gen).filter(
      (t) => !original.has(t) && !added.includes(t) && !KEY_FIELDS.some((f) => f.tag === t),
    );
    setAdded((a) => [...a, ...fresh]);
    setDels((d) => d.filter((t) => !(t in gen)));
    setEdits((prev) => ({ ...prev, ...gen }));
  }

  async function fillRandom() {
    if (!meta) return;
    mergeIn(await window.electronAPI.metaRandom(rand, meta.kind));
    showToast('Заполнено случайно — проверь и сохрани');
  }

  function applyPreset(p: MetaPreset) {
    mergeIn(presetFields(p));
    setPop('none');
    showToast('Применён пресет: ' + p.name);
  }

  function currentFields(): Record<string, string> {
    const out: Record<string, string> = {};
    original.forEach((v, k) => { if (v && editableTags.has(k)) out[k] = v; });
    for (const [k, v] of Object.entries(edits)) if (editableTags.has(k)) out[k] = v;
    return out;
  }

  async function save(mode: 'overwrite' | 'copy' | 'saveAs', strip = false) {
    if (!meta) return;
    let dest: string | undefined;
    if (mode === 'saveAs') {
      const p = await window.electronAPI.metaPickSavePath(meta.file);
      if (!p) return;
      dest = p;
    }
    setSaving(true);
    try {
      const res = await window.electronAPI.metaWrite({ file: meta.file, edits, deletes: dels, stripAll: strip, mode, dest });
      if (res.error) { showToast('Не сохранено: ' + res.error); return; }
      setMeta(res);
      reset();
      showToast(mode === 'overwrite' ? 'Записано в файл' : 'Сохранено: ' + res.name);
    } finally {
      setSaving(false);
    }
  }

  async function stripAll(mode: 'overwrite' | 'copy') {
    if (!meta) return;
    if (!window.confirm(mode === 'overwrite'
      ? 'Удалить ВСЕ метаданные прямо в файле? Отменить будет нельзя.'
      : 'Создать копию файла без метаданных?')) return;
    setPop('none');
    await save(mode, true);
  }

  const v = meta ? VERDICT[meta.verdict] : null;
  const ro = !!meta && !meta.writable;
  const keyFields = KEY_FIELDS.filter((f) => !f.kind || f.kind === meta?.kind);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Метаданные</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <Tab active={tab === 'one'} onClick={() => setTab('one')}>Один файл</Tab>
          <Tab active={tab === 'batch'} onClick={() => setTab('batch')}>Пакет</Tab>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'one' && (
          <button onClick={() => load()} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>Загрузить</button>
        )}
        <button onClick={() => setAppMode('select')} className="btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }}>На главную</button>
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
        {tab === 'batch' ? (
          <BatchPanel />
        ) : !meta ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => load()}
            style={{ height: '100%', minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, border: '2px dashed var(--border)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 38 }}>🖼️</div>
            <div style={{ fontSize: 14 }}>{loading ? 'Читаю…' : 'Перетащи фото или видео, либо нажми для выбора'}</div>
            <div style={{ fontSize: 11.5 }}>JPG · PNG · HEIC · WEBP · TIFF · MP4 · MOV</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Файл */}
            <div style={{ width: 250, flexShrink: 0 }}>
              <div className="img-outline" style={{ background: '#000', borderRadius: 8, overflow: 'hidden' }}>
                {meta.kind === 'video' ? (
                  <video key={meta.file} src={mediaUrl(meta.file)} controls muted style={{ width: '100%', maxHeight: 210, display: 'block' }} />
                ) : (
                  <img src={mediaUrl(meta.file)} alt="" style={{ width: '100%', maxHeight: 210, objectFit: 'contain', display: 'block' }} />
                )}
              </div>

              {v && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: v.fg, fontWeight: 600 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: v.fg, flexShrink: 0 }} />
                    {v.label}
                  </div>
                  {/* Причина вердикта была только в подсказке при наведении — из-за
                      этого было непонятно, почему после правки полей он не меняется. */}
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{meta.verdictText}</div>
                </div>
              )}

              <div title={meta.file} style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName(meta.name)} · {meta.sizeKB} КБ
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <IconBtn title="Другой файл" onClick={() => load()}>🖼</IconBtn>
                <IconBtn title="Показать в папке" onClick={() => window.electronAPI.metaReveal(meta.file)}>📂</IconBtn>
                {meta.gps && (
                  <IconBtn title="Открыть на карте" onClick={() => window.electronAPI.metaOpenMap(meta.gps!.lat, meta.gps!.lon)}>📍</IconBtn>
                )}
              </div>

              {meta.summary.stripped && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#facc15', lineHeight: 1.45 }}>
                  Метаданные вырезаны — так делают мессенджеры при пересылке.
                </div>
              )}
              {ro && (
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  В этот формат запись не поддерживается — только просмотр.
                </div>
              )}
            </div>

            {/* Главное, действия, всё остальное */}
            <div style={{ flex: 1, minWidth: 330 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Главное</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {keyFields.map((f, i) => (
                  <KeyRow
                    key={f.tag}
                    label={f.label}
                    placeholder={f.placeholder}
                    value={valueOf(f.tag)}
                    changed={f.tag in edits}
                    deleted={dels.includes(f.tag)}
                    readOnly={ro}
                    zebra={i % 2 === 1}
                    onChange={(val) => setVal(f.tag, val)}
                    onMap={f.tag === GPS && !ro ? () => setMapOpen(true) : undefined}
                  />
                ))}
                {meta.summary.c2pa && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 10px', background: 'var(--bg-tertiary)', fontSize: 11.5 }}>
                    <span style={{ width: 130, flexShrink: 0, color: 'var(--text-secondary)' }}>C2PA / AI-метки</span>
                    <span style={{ color: '#ff6b6b', lineHeight: 1.45 }}>
                      есть — подписанный манифест происхождения. Он лежит отдельным блоком контейнера,
                      поэтому его нельзя править по полям. При сохранении изменений или «Стереть всё»
                      он удаляется целиком.
                    </span>
                  </div>
                )}
              </div>

              {!ro && (
                <>
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    <Chip active={pop === 'random'} onClick={() => setPop(pop === 'random' ? 'none' : 'random')}>🎲 Случайно</Chip>
                    <Chip active={pop === 'preset'} onClick={() => setPop(pop === 'preset' ? 'none' : 'preset')}>📌 Пресеты</Chip>
                    <Chip active={pop === 'field'} onClick={() => setPop(pop === 'field' ? 'none' : 'field')}>＋ Поле</Chip>
                    <Chip active={pop === 'clean'} onClick={() => setPop(pop === 'clean' ? 'none' : 'clean')}>🧹 Очистить</Chip>
                  </div>

                  {pop === 'random' && (
                    <Panel>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <button onClick={fillRandom} className="btn-primary" style={{ padding: '6px 14px', fontSize: 12.5 }}>Заполнить</button>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>значения попадут в поля, записи ещё не будет</span>
                      </div>
                      <RandomOptions value={rand} onChange={setRand} />
                    </Panel>
                  )}

                  {pop === 'preset' && (
                    <Panel>
                      <PresetBar presets={presets} persist={persist} current={currentFields} onApply={applyPreset} />
                    </Panel>
                  )}

                  {pop === 'field' && (
                    <Panel>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          list="meta-tags"
                          autoFocus
                          value={newTag}
                          onChange={(e) => setNewTag(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') addField(); }}
                          placeholder="Имя тега, напр. Artist"
                          style={{ ...input, flex: 1, maxWidth: 240 }}
                        />
                        <datalist id="meta-tags">{COMMON_TAGS.map((t) => <option key={t} value={t} />)}</datalist>
                        <button onClick={addField} className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12.5 }}>Добавить</button>
                      </div>
                    </Panel>
                  )}

                  {pop === 'clean' && (
                    <Panel>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button disabled={saving} onClick={() => stripAll('copy')} className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12.5 }}>
                          Копия без метаданных
                        </button>
                        <button
                          disabled={saving}
                          onClick={() => stripAll('overwrite')}
                          className="btn-secondary"
                          style={{ padding: '6px 14px', fontSize: 12.5, borderColor: 'rgba(248,113,113,0.5)', color: '#f87171' }}
                        >
                          Стереть всё в этом файле
                        </button>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.4 }}>
                        Убирает EXIF, GPS, XMP, C2PA/AI-метки и прочие поля.
                      </div>
                    </Panel>
                  )}
                </>
              )}

              <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  onClick={() => setAllOpen((o) => !o)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', background: 'var(--bg-secondary)', userSelect: 'none' }}
                >
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 9 }}>{allOpen ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>Все поля</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{allCount}</span>
                  <div style={{ flex: 1 }} />
                  {allOpen && (
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Поиск"
                      style={{ ...input, width: 150, padding: '3px 7px' }}
                    />
                  )}
                </div>

                {allOpen && (
                  <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10, alignItems: 'start' }}>
                    {allRows.map((g) => (
                      <div key={g.title} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '5px 9px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>{g.title}</div>
                        {g.rows.map((r, i) => (
                          <FieldRow
                            key={r.tag + i}
                            row={r}
                            zebra={i % 2 === 1}
                            readOnly={ro}
                            deleted={dels.includes(r.tag)}
                            changed={r.tag in edits}
                            value={edits[r.tag] ?? r.value}
                            onChange={(val) => setVal(r.tag, val)}
                            onDelete={() => toggleDelete(r.tag)}
                          />
                        ))}
                      </div>
                    ))}

                    {added.length > 0 && (
                      <div style={{ border: '1px solid var(--accent-green)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '5px 9px', fontSize: 11.5, fontWeight: 600, color: 'var(--accent-green)', background: 'var(--bg-secondary)' }}>Новые поля</div>
                        {added.map((tag, i) => (
                          <FieldRow
                            key={tag}
                            row={{ tag, label: tag, value: '', editable: true }}
                            zebra={i % 2 === 1}
                            readOnly={ro}
                            deleted={false}
                            changed
                            value={edits[tag] ?? ''}
                            onChange={(val) => setVal(tag, val)}
                            onDelete={() => {
                              setAdded((a) => a.filter((t) => t !== tag));
                              setEdits((e) => { const n = { ...e }; delete n[tag]; return n; });
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {allCount === 0 && added.length === 0 && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>
                        {q ? 'По запросу ничего нет.' : 'Других полей в файле нет.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {mapOpen && meta && (
        <LocationPicker
          value={valueOf(GPS)}
          onPick={(c) => { setMapOpen(false); setVal(GPS, c); }}
          onClose={() => setMapOpen(false)}
        />
      )}

      {tab === 'one' && meta && dirty && !ro && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Изменено: {Object.keys(edits).length}{dels.length ? ` · удалить: ${dels.length}` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <button disabled={saving} onClick={reset} className="btn-secondary" style={{ padding: '7px 14px', fontSize: 12.5 }}>Отменить</button>
          <button disabled={saving} onClick={() => save('saveAs')} className="btn-secondary" style={{ padding: '7px 14px', fontSize: 12.5 }}>Сохранить как…</button>
          <button disabled={saving} onClick={() => save('copy')} className="btn-secondary" style={{ padding: '7px 14px', fontSize: 12.5 }}>Копия</button>
          <button disabled={saving} onClick={() => save('overwrite')} className="btn-primary" style={{ padding: '7px 16px', fontSize: 13 }}>
            {saving ? 'Пишу…' : 'Записать в файл'}
          </button>
        </div>
      )}
    </div>
  );
}

function KeyRow({ label, value, placeholder, changed, deleted, readOnly, zebra, onChange, onMap }: {
  label: string; value: string; placeholder?: string; changed: boolean; deleted: boolean;
  readOnly: boolean; zebra: boolean; onChange: (v: string) => void; onMap?: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', background: zebra ? 'var(--bg-secondary)' : 'var(--bg-tertiary)' }}>
      <span style={{ width: 130, flexShrink: 0, fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      {readOnly ? (
        <span style={{ flex: 1, fontSize: 12.5, color: value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{value || '—'}</span>
      ) : (
        <input
          value={deleted ? '' : value}
          disabled={deleted}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '—'}
          style={{
            ...input,
            flex: 1,
            fontSize: 12.5,
            borderColor: changed ? 'var(--accent-green)' : 'transparent',
            background: changed ? 'rgba(74,222,128,0.08)' : 'transparent',
          }}
        />
      )}
      {onMap && <button onClick={onMap} title="Выбрать на карте" style={iconBtn}>🗺</button>}
    </div>
  );
}

function FieldRow({ row, zebra, value, changed, deleted, readOnly, onChange, onDelete }: {
  row: Row; zebra: boolean; value: string; changed: boolean; deleted: boolean; readOnly: boolean;
  onChange: (v: string) => void; onDelete: () => void;
}) {
  const editable = row.editable && !readOnly;
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '2px 8px', background: zebra ? 'var(--bg-secondary)' : 'var(--bg-tertiary)', fontSize: 11.5 }}>
      <span title={row.label} style={{ width: 120, flexShrink: 0, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
      {editable ? (
        <input
          value={deleted ? '' : value}
          disabled={deleted}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          style={{
            ...input,
            flex: 1,
            padding: '2px 5px',
            borderColor: deleted ? '#f87171' : changed ? 'var(--accent-green)' : 'transparent',
            background: deleted ? 'rgba(248,113,113,0.08)' : changed ? 'rgba(74,222,128,0.08)' : 'transparent',
            textDecoration: deleted ? 'line-through' : 'none',
          }}
        />
      ) : (
        <span title={row.value} style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }}>{row.value}</span>
      )}
      {editable && (
        <button onClick={onDelete} title={deleted ? 'Вернуть' : 'Удалить поле'} style={{ ...iconBtn, color: deleted ? '#4ade80' : 'var(--text-secondary)' }}>
          {deleted ? '↺' : '✕'}
        </button>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{children}</div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--accent-green)' : 'var(--border)'}`,
        background: active ? 'rgba(74,222,128,0.1)' : 'var(--bg-tertiary)',
        color: active ? 'var(--accent-green)' : 'var(--text-primary)',
      }}
    >
      {children}
    </button>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--accent-green)' : 'var(--border)'}`,
        background: active ? 'rgba(74,222,128,0.1)' : 'var(--bg-tertiary)',
        color: active ? 'var(--accent-green)' : 'var(--text-primary)',
      }}
    >
      {children}
    </button>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}

const input: React.CSSProperties = { padding: '4px 7px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none', minWidth: 0 };
const iconBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12.5, padding: '0 4px' };
