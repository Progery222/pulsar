"""Собирает assets/geo/cities.json из GeoNames cities15000 (CC BY 4.0).

Запуск: py -3 scripts/build-cities.py <путь к cities15000.zip>
Формат записи: [en, ru, lat, lon, cc, pop, capital] — массивы, а не объекты,
чтобы 30 тысяч городов уложились в мегабайт.
"""
import io, json, re, sys, zipfile

src = sys.argv[1]
CYR = re.compile(r'^[\u0400-\u04FF][\u0400-\u04FF\s\-’ʼ.]+$')

def ru_name(alts: str) -> str:
    # В cities15000 альтернативные имена без пометки языка; берём первое
    # кириллическое — для СНГ это русское, для остального мира почти всегда тоже.
    for a in alts.split(','):
        a = a.strip()
        if a and CYR.match(a) and len(a) <= 40:
            return a
    return ''

rows = []
with zipfile.ZipFile(src) as z:
    name = [n for n in z.namelist() if n.endswith('.txt')][0]
    for line in io.TextIOWrapper(z.open(name), encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 15: continue
        en, ascii_, alts, lat, lon, fcode, cc, pop = f[1], f[2], f[3], f[4], f[5], f[7], f[8], f[14]
        try:
            lat, lon, pop = round(float(lat), 4), round(float(lon), 4), int(pop or 0)
        except ValueError:
            continue
        rows.append([en, ru_name(alts), lat, lon, cc, pop, 1 if fcode == 'PPLC' else 0])

rows.sort(key=lambda r: -r[5])
out = 'assets/geo/cities.json'
with open(out, 'w', encoding='utf-8') as fh:
    json.dump(rows, fh, ensure_ascii=False, separators=(',', ':'))
import os
print(f'городов: {len(rows)}, размер: {os.path.getsize(out)//1024} КБ, с русским именем: {sum(1 for r in rows if r[1])}, столиц: {sum(r[6] for r in rows)}')
for want in ('Bishkek', 'Osh', 'Jalal-Abad', 'Uzgen', 'Karakol'):
    hit = next((r for r in rows if r[0] == want), None)
    print(' ', want, '→', hit[:6] if hit else 'НЕТ')
