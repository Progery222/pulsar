import { useRef, useState } from 'react';
import { useVubStore, type WatermarkZone } from '../store';
import { mediaUrl } from '../../utils/media';

// Готовые эмодзи-водяные знаки (PNG в assets/emoji, путь относительный — резолвится в main).
const EMOJI_PRESETS = [
  'fire', 'heart', 'heart_eyes', 'joy', 'eyes', 'check', 'thumbsup', 'hundred',
  'thinking', 'cool', 'party', 'point_down', 'star', 'scream', 'mind_blown', 'skull',
];
const emojiPath = (name: string) => `assets/emoji/${name}.png`;

// Вкладка 4: Водяной знак (§4.5 ТЗ).
export default function WatermarkTab() {
  const watermark = useVubStore((s) => s.watermark);
  const setWatermark = useVubStore((s) => s.setWatermark);
  const areaRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<WatermarkZone | null>(null);

  async function pickFile() {
    const file = await window.electronAPI.selectWatermark();
    if (file) setWatermark({ file });
  }

  function onPointerDown(e: React.PointerEvent) {
    const area = areaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;
    const move = (ev: PointerEvent) => {
      const cx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const cy = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      setDraft({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft((d) => {
        if (d && d.w > 0.02 && d.h > 0.02) setWatermark({ zones: [...watermark.zones, d] });
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const zoneBox = (z: WatermarkZone, dashed: boolean, key: React.Key) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        left: `${z.x * 100}%`,
        top: `${z.y * 100}%`,
        width: `${z.w * 100}%`,
        height: `${z.h * 100}%`,
        border: `2px dashed var(--accent-green)`,
        background: dashed ? 'transparent' : 'rgba(204,255,0,0.08)',
        pointerEvents: 'none',
      }}
    />
  );

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Водяной знак
      </h2>

      <p style={{ marginTop: 0, marginBottom: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
        Готовые эмодзи (нажми, чтобы выбрать):
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8, maxWidth: 460, marginBottom: 16 }}>
        {EMOJI_PRESETS.map((name) => {
          const p = emojiPath(name);
          const active = watermark.file === p;
          return (
            <button
              key={name}
              onClick={() => setWatermark({ file: p })}
              title={name}
              style={{
                aspectRatio: '1',
                padding: 6,
                background: active ? 'rgba(204,255,0,0.12)' : 'var(--bg-tertiary)',
                border: `2px solid ${active ? 'var(--accent-green)' : 'var(--border)'}`,
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img src={mediaUrl(p)} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </button>
          );
        })}
      </div>

      <button
        onClick={pickFile}
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
      >
        Или загрузить свой файл (PNG, GIF, MP4)
      </button>
      {watermark.file && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{watermark.file}</p>
      )}

      <p style={{ marginTop: 20, marginBottom: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
        Нарисуйте зоны допустимого размещения:
      </p>
      <div
        ref={areaRef}
        onPointerDown={onPointerDown}
        style={{
          position: 'relative',
          width: 270,
          height: 480,
          maxWidth: '100%',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'crosshair',
          overflow: 'hidden',
        }}
      >
        {watermark.zones.map((z, i) => zoneBox(z, false, i))}
        {draft && zoneBox(draft, true, 'draft')}
      </div>

      {watermark.zones.length > 0 && (
        <button
          onClick={() => setWatermark({ zones: [] })}
          style={{ marginTop: 12, background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
        >
          Очистить зоны ({watermark.zones.length})
        </button>
      )}
    </div>
  );
}
