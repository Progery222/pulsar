import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { parseCoords } from './geo';

// Выбор координат: поиск по названию места или клик по карте.
// Плитки тянутся из OpenStreetMap — без интернета карта будет серой, но поиск
// по встроенному списку городов и ручной ввод продолжают работать.

type Hit = { name: string; lat: number; lon: number };

// Leaflet по умолчанию грузит иконки маркера по относительным путям, которые
// в сборке ломаются. Рисуем маркер сами через divIcon — ассеты не нужны.
const PIN = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:var(--accent-green);border:2px solid #000;box-shadow:0 0 0 2px var(--accent-green)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export default function LocationPicker({
  value,
  onPick,
  onClose,
}: {
  value: string; // «широта, долгота» или пусто
  onPick: (coords: string) => void;
  onClose: () => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);

  const parsed = parseCoords(value);
  const [lat, setLat] = useState(parsed?.lat ?? 55.7558);
  const [lon, setLon] = useState(parsed?.lon ?? 37.6173);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);

  // Инициализация карты — один раз на монтирование.
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = L.map(mapRef.current, { attributionControl: true }).setView([lat, lon], parsed ? 13 : 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    marker.current = L.marker([lat, lon], { icon: PIN, draggable: true }).addTo(map);
    marker.current.on('dragend', () => {
      const p = marker.current!.getLatLng();
      setLat(p.lat);
      setLon(p.lng);
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      setLat(e.latlng.lat);
      setLon(e.latlng.lng);
    });
    mapObj.current = map;
    // Карта считает свой размер при создании; в модалке контейнер к этому моменту
    // ещё может быть нулевым — пересчитываем после первой отрисовки.
    setTimeout(() => map.invalidateSize(), 60);
    return () => {
      map.remove();
      mapObj.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Держим маркер и вид в согласии с введёнными значениями.
  useEffect(() => {
    if (!mapObj.current || !marker.current) return;
    marker.current.setLatLng([lat, lon]);
    mapObj.current.panTo([lat, lon], { animate: false });
  }, [lat, lon]);

  async function search(text?: string) {
    const q = (text ?? query).trim();
    if (q.length < 2) { setHits([]); return; }
    setSearching(true);
    try {
      setHits(await window.electronAPI.metaGeocode(q));
    } finally {
      setSearching(false);
    }
  }

  // Ищем сами через паузу после набора: жать Enter никто не догадывается,
  // а на каждую букву дёргать геокодер нельзя — он публичный и с лимитами.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { void search(q); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function choose(h: Hit) {
    setLat(h.lat);
    setLon(h.lon);
    setHits([]);
    mapObj.current?.setView([h.lat, h.lon], 12);
  }

  const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(860px, 94vw)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>Выбор места</strong>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btnSecondary}>Закрыть</button>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', position: 'relative' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
            placeholder="Город или адрес — «New York», «Казань», «Сочи, Роза Хутор»"
            style={{ ...input, flex: 1 }}
          />
          <button onClick={() => void search()} disabled={searching} style={btnPrimary}>{searching ? 'Ищу…' : 'Найти'}</button>

          {hits.length > 0 && (
            <div style={{ position: 'absolute', top: 46, left: 14, right: 120, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 5 }}>
              {hits.map((h, i) => (
                <div
                  key={i}
                  onClick={() => choose(h)}
                  style={{ padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                >
                  {h.name}
                  <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{h.lat.toFixed(4)}, {h.lon.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {query.trim().length >= 2 && !searching && hits.length === 0 && (
          <div style={{ padding: '0 14px 8px', fontSize: 11, color: 'var(--text-secondary)' }}>
            Ничего не нашлось. Проверь написание или укажи точку прямо на карте — без интернета
            поиск работает только по встроенному списку городов.
          </div>
        )}

        <div ref={mapRef} style={{ height: 380, background: '#111' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Кликни по карте или перетащи точку</span>
          <div style={{ flex: 1 }} />
          <input
            value={coords}
            onChange={(e) => {
              const p = parseCoords(e.target.value);
              if (p) { setLat(p.lat); setLon(p.lon); }
            }}
            style={{ ...input, width: 210, fontFamily: 'monospace' }}
          />
          <button onClick={() => onPick(coords)} style={btnPrimary}>Использовать</button>
        </div>
      </div>
    </div>
  );
}

const input: React.CSSProperties = { padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', minWidth: 0 };
const btnPrimary: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--accent-green)', color: 'var(--accent-fg)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer' };
