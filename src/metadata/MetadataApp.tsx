import { useMemo, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { mediaUrl, fileName } from '../utils/media';

type Row = { tag: string; label: string; value: string; editable: boolean };
type Group = { title: string; rows: Row[] };
type Summary = { camera: string | null; gps: string | null; shotDate: string | null; c2pa: boolean; stripped: boolean };
type Meta = {
  file: string; name: string; sizeKB: number; verdict: 'ai' | 'camera' | 'unknown'; verdictText: string;
  summary: Summary; groups: Group[]; gps: { lat: number; lon: number } | null; writable: boolean; error?: string;
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
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dels, setDels] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  const dirty = Object.keys(edits).length > 0 || dels.length > 0;

  const original = useMemo(() => {
    const m = new Map<string, string>();
    meta?.groups.forEach((g) => g.rows.forEach((r) => m.set(r.tag, r.value)));
    return m;
  }, [meta]);

  function reset() { setEdits({}); setDels([]); setAdded([]); setNewTag(''); }

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

  async function save(mode: 'overwrite' | 'copy', stripAll = false) {
    if (!meta) return;
    setSaving(true);
    try {
      const res = await window.electronAPI.metaWrite({ file: meta.file, edits, deletes: dels, stripAll, mode });
      if (res.error) { showToast('Не сохранено: ' + res.error); return; }
      setMeta(res);
      reset();
      showToast(mode === 'copy' ? 'Сохранена копия: ' + res.name : 'Метаданные записаны в файл');
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
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>EXIF · GPS · C2PA · вердикт ИИ/реал · правка любого поля</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => load()} style={btnPrimary}>Загрузить фото</button>
        <button onClick={() => setAppMode('select')} style={btnSecondary}>На главную</button>
      </div>

      <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
        {!meta ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => load()}
            style={{ height: '100%', minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: '2px dashed var(--border)', borderRadius: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 40 }}>🖼️</div>
            <div style={{ fontSize: 14 }}>{loading ? 'Читаю…' : 'Перетащи фото сюда или нажми, чтобы выбрать'}</div>
            <div style={{ fontSize: 11.5 }}>JPG · PNG · HEIC · WEBP · TIFF…</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Превью + вердикт */}
            <div style={{ width: 280, flexShrink: 0 }}>
              <div style={{ background: '#000', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 12 }}>
                <img src={mediaUrl(meta.file)} alt="" style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
              </div>
              {v && (
                <div style={{ background: v.bg, color: v.fg, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {v.label}
                  <div style={{ fontSize: 11, fontWeight: 400, marginTop: 4, color: v.fg, opacity: 0.9 }}>{meta.verdictText}</div>
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{fileName(meta.name)} · {meta.sizeKB} КБ</div>
              {meta.gps && (
                <button onClick={() => window.electronAPI.metaOpenMap(meta.gps!.lat, meta.gps!.lon)} style={{ ...btnSecondary, marginTop: 10, width: '100%' }}>
                  📍 Открыть на карте
                </button>
              )}
              <button onClick={() => window.electronAPI.metaReveal(meta.file)} style={{ ...btnSecondary, marginTop: 8, width: '100%' }}>📂 Показать файл в папке</button>
              <button onClick={() => load()} style={{ ...btnSecondary, marginTop: 8, width: '100%' }}>Другое фото</button>

              {!ro && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>Полная очистка</div>
                  <button disabled={saving} onClick={() => stripAll('copy')} style={{ ...btnSecondary, width: '100%' }}>🧹 Копия без метаданных</button>
                  <button disabled={saving} onClick={() => stripAll('overwrite')} style={{ ...btnDanger, marginTop: 8, width: '100%' }}>🧨 Стереть всё в этом файле</button>
                </div>
              )}
            </div>

            {/* Метаданные */}
            <div style={{ flex: 1, minWidth: 320 }}>
              {/* Итог по ключевым полям — сразу видно, что есть, а чего нет */}
              <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <Fact label="📱 Камера / телефон" value={meta.summary.camera} />
                <Fact label="📍 GPS (гео)" value={meta.summary.gps} />
                <Fact label="🕑 Дата съёмки" value={meta.summary.shotDate} />
                <Fact label="🔏 C2PA / AI-метки" value={meta.summary.c2pa ? 'есть' : null} okText="есть" />
              </div>
              {meta.summary.stripped && (
                <div style={{ marginBottom: 16, background: 'rgba(250,204,21,0.12)', color: '#facc15', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, lineHeight: 1.4 }}>
                  Камеры, GPS и даты в файле нет. Скорее всего EXIF <b>вырезан при пересылке</b> (Telegram/WhatsApp/Instagram и т.п. чистят метаданные). Чтобы увидеть телефон и гео — открой оригинал прямо с устройства, без сжатия.
                </div>
              )}
              {ro && (
                <div style={{ marginBottom: 16, background: 'rgba(148,163,184,0.12)', color: 'var(--text-secondary)', borderRadius: 8, padding: '9px 12px', fontSize: 11.5 }}>
                  В этот формат запись метаданных не поддерживается — доступен только просмотр.
                </div>
              )}

              {meta.groups.map((g) => (
                <div key={g.title} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{g.title}</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
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
                  </div>
                </div>
              ))}

              {/* Добавленные вручную поля */}
              {added.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Новые поля</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
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
                  </div>
                </div>
              )}

              {!ro && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    list="meta-tags"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addField(); }}
                    placeholder="Имя тега, напр. Artist"
                    style={{ ...inputBase, width: 240 }}
                  />
                  <datalist id="meta-tags">{COMMON_TAGS.map((t) => <option key={t} value={t} />)}</datalist>
                  <button onClick={addField} style={btnSecondary}>＋ Добавить поле</button>
                </div>
              )}

              {isEmpty && (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  Метаданных в файле нет — можно заполнить поля выше и записать свои.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Панель сохранения — появляется, как только что-то изменено */}
      {meta && dirty && !ro && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Изменено полей: {Object.keys(edits).length}{dels.length ? ` · удалить: ${dels.length}` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <button disabled={saving} onClick={reset} style={btnSecondary}>Отменить правки</button>
          <button disabled={saving} onClick={() => save('copy')} style={btnSecondary}>Сохранить копию</button>
          <button disabled={saving} onClick={() => save('overwrite')} style={btnPrimary}>{saving ? 'Пишу…' : 'Записать в файл'}</button>
        </div>
      )}
    </div>
  );
}

function FieldRow({ row, i, value, changed, deleted, readOnly, onChange, onDelete }: {
  row: Row; i: number; value: string; changed: boolean; deleted: boolean; readOnly: boolean;
  onChange: (v: string) => void; onDelete: () => void;
}) {
  const editable = row.editable && !readOnly;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 10px', background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)', fontSize: 12 }}>
      <span style={{ width: 200, flexShrink: 0, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{row.label}</span>
      {editable ? (
        <input
          value={deleted ? '' : value}
          disabled={deleted}
          onChange={(e) => onChange(e.target.value)}
          placeholder={PLACEHOLDER[row.tag] ?? '— пусто —'}
          style={{
            ...inputBase,
            flex: 1,
            borderColor: deleted ? '#f87171' : changed ? 'var(--accent-green)' : 'transparent',
            background: deleted ? 'rgba(248,113,113,0.08)' : changed ? 'rgba(74,222,128,0.08)' : 'transparent',
            textDecoration: deleted ? 'line-through' : 'none',
          }}
        />
      ) : (
        <span style={{ flex: 1, color: 'var(--text-primary)', wordBreak: 'break-word', opacity: readOnly ? 1 : 0.75 }}>{row.value}</span>
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

function Fact({ label, value, okText }: { label: string; value: string | null; okText?: string }) {
  const has = !!value;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 170, flexShrink: 0, fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: has ? (okText ? '#4ade80' : 'var(--text-primary)') : '#f87171', wordBreak: 'break-word' }}>
        {has ? value : '— нет в файле'}
      </span>
    </div>
  );
}

const inputBase: React.CSSProperties = { padding: '4px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none', minWidth: 0 };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { ...btnSecondary, border: '1px solid rgba(248,113,113,0.5)', color: '#f87171' };
