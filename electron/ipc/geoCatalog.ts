import fs from 'node:fs';
import path from 'node:path';

/**
 * Офлайн-каталог городов мира: GeoNames cities15000 (все города с населением
 * от 15 тысяч, ~34 тысячи записей), собранный скриптом scripts/build-cities.py
 * в assets/geo/cities.json. Лицензия данных — CC BY 4.0 (assets/geo/LICENSE.txt).
 *
 * Зачем свой каталог, если есть Nominatim: он работает без сети, отвечает
 * мгновенно, не упирается в лимит запросов и знает русские названия — для
 * аудитории это «Ош» и «Бишкек», а не «Osh». Nominatim остаётся для адресов
 * и мелких населённых пунктов.
 *
 * Модуль не зависит от Electron — корень с ресурсами передаётся снаружи,
 * поэтому его можно проверить обычным node.
 */

export interface GeoCity {
  en: string;
  ru: string;
  lat: number;
  lon: number;
  cc: string;
  pop: number;
  capital: boolean;
  /** Разброс координат в градусах — примерно по площади города. */
  r: number;
}

type Row = [string, string, number, number, string, number, number];

let catalog: GeoCity[] | null = null;
let root = '';

export function configureGeoCatalog(resourcesRoot: string): void {
  root = resourcesRoot;
  catalog = null;
}

/**
 * Радиус разброса по населению: 15 тысяч — пара километров, миллионник —
 * десяток. Логарифм, потому что площадь города растёт куда медленнее населения.
 */
export function radiusFor(pop: number): number {
  const r = 0.015 + 0.03 * Math.log10(Math.max(15000, pop) / 15000);
  return Math.min(0.18, Math.max(0.02, Number(r.toFixed(3))));
}

export function loadCatalog(): GeoCity[] {
  if (catalog) return catalog;
  const file = path.join(root, 'assets', 'geo', 'cities.json');
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Row[];
    catalog = rows.map(([en, ru, lat, lon, cc, pop, capital]) => ({
      en, ru, lat, lon, cc, pop, capital: capital === 1, r: radiusFor(pop),
    }));
  } catch {
    // Файла нет (например, урезанная сборка) — работаем на встроенном списке.
    catalog = [];
  }
  return catalog;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Точное совпадение по русскому или английскому имени; из одноимённых — крупнейший. */
export function findCity(name: string): GeoCity | null {
  const q = norm(name);
  if (!q) return null;
  for (const c of loadCatalog()) {
    if (norm(c.ru) === q || norm(c.en) === q) return c;
  }
  return null;
}

/**
 * Поиск для подсказок: сначала совпадения по началу имени, потом по вхождению,
 * внутри группы — по населению. Каталог отсортирован по населению при сборке,
 * поэтому стабильная сортировка сохраняет этот порядок.
 */
export function searchCities(query: string, limit = 12): GeoCity[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const prefix: GeoCity[] = [];
  const inner: GeoCity[] = [];
  for (const c of loadCatalog()) {
    const ru = norm(c.ru);
    const en = norm(c.en);
    if (ru.startsWith(q) || en.startsWith(q)) prefix.push(c);
    else if (ru.includes(q) || en.includes(q)) inner.push(c);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...inner].slice(0, limit);
}

/** Как показывать город человеку: русское имя, если есть, и страна для однофамильцев. */
export const cityLabel = (c: GeoCity): string => `${c.ru || c.en}, ${c.cc}`;

/** Имена для выпадающего списка: столицы и города от полумиллиона. */
export function majorCityNames(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of loadCatalog()) {
    if (!c.capital && c.pop < 500000) continue;
    const name = c.ru || c.en;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
