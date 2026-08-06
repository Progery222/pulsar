import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { showToast } from '../store/toastStore';
import { mediaUrl, fileName } from '../utils/media';

type Group = { title: string; rows: [string, string][] };
type Summary = { camera: string | null; gps: string | null; shotDate: string | null; c2pa: boolean; stripped: boolean };
type Meta = {
  file: string; name: string; sizeKB: number; verdict: 'ai' | 'camera' | 'unknown'; verdictText: string;
  summary: Summary; groups: Group[]; gps: { lat: number; lon: number } | null; error?: string;
};

const VERDICT: Record<Meta['verdict'], { label: string; bg: string; fg: string }> = {
  ai: { label: '🤖 Похоже на ИИ-генерацию', bg: 'rgba(255,86,86,0.15)', fg: '#ff6b6b' },
  camera: { label: '📷 Похоже на реальную съёмку', bg: 'rgba(74,222,128,0.15)', fg: '#4ade80' },
  unknown: { label: '❔ Не определить точно', bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
};

export default function MetadataApp() {
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(file?: string | null) {
    const f = file ?? (await window.electronAPI.metaPick());
    if (!f) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.metaRead(f);
      if (res.error) showToast('Ошибка чтения: ' + res.error);
      setMeta(res);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (f?.path) load(f.path);
  }

  const v = meta ? VERDICT[meta.verdict] : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Метаданные — инспектор</h2>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Только чтение: EXIF · GPS · C2PA · вердикт ИИ/реал</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => load()} style={btnPrimary}>Загрузить фото</button>
        <button onClick={() => setAppMode('select')} style={btnSecondary}>На главную</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
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
              <button onClick={() => load()} style={{ ...btnSecondary, marginTop: 8, width: '100%' }}>Другое фото</button>
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
              {meta.groups.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  Метаданных нет — файл очищен или формат без EXIF.
                </div>
              ) : meta.groups.map((g) => (
                <div key={g.title} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{g.title}</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {g.rows.map(([k, val], i) => (
                      <div key={k + i} style={{ display: 'flex', gap: 10, padding: '6px 10px', background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)', fontSize: 12 }}>
                        <span style={{ width: 200, flexShrink: 0, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{k}</span>
                        <span style={{ flex: 1, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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

const btnPrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
