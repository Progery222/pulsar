// Работа с координатами для модуля «Метаданные».

export interface Coords { lat: number; lon: number }

export function parseCoords(s: string): Coords | null {
  const m = String(s || '').trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const formatCoords = (c: Coords): string => `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`;

// Случайная точка в круге радиусом radiusKm вокруг базовой.
// Нужна, чтобы у пачки файлов не стояла одна и та же координата до шестого знака —
// это выглядит как машинная простановка. Точка берётся равномерно по площади
// (sqrt от случайного числа), иначе все попадания скучиваются у центра.
export function jitterCoords(base: Coords, radiusKm: number): Coords {
  const r = Math.max(0, radiusKm);
  if (r === 0) return base;

  const angle = Math.random() * 2 * Math.PI;
  const dist = r * Math.sqrt(Math.random());

  // 1° широты ≈ 111.32 км везде; у долготы шаг сжимается к полюсам на cos(широты).
  const dLat = dist / 111.32;
  const cos = Math.cos((base.lat * Math.PI) / 180);
  const dLon = Math.abs(cos) < 1e-6 ? 0 : dist / (111.32 * cos);

  const lat = base.lat + dLat * Math.sin(angle);
  const lon = base.lon + dLon * Math.cos(angle);

  return {
    lat: Math.max(-90, Math.min(90, lat)),
    // Переход через 180-й меридиан сворачиваем, чтобы не получить 181.
    lon: ((lon + 540) % 360) - 180,
  };
}
