"""Собирает assets/geo/cities.json из GeoNames (CC BY 4.0).

Запуск: py -3 scripts/build-cities.py <cities15000.zip> [alternateNamesV2.zip]

Второй архив (~200 МБ, только для сборки, в репозиторий не кладём) даёт русские
названия с пометкой языка. Без него русские имена берутся эвристикой по алфавиту
и в подсказки лезут болгарские и сербские варианты («Њу Јорк», «Нью-Ёрк»).

Формат записи: [en, ru, lat, lon, cc, pop, capital] — массивы, а не объекты,
чтобы 34 тысячи городов уложились в пару мегабайт.
"""
import io, json, os, re, sys, zipfile

src = sys.argv[1]
alt_src = sys.argv[2] if len(sys.argv) > 2 else None

# Запасной вариант: только русский алфавит, иначе сербское и украинское
# написание не отличить от русского.
CYR = re.compile(r'^[А-Яа-яЁё][А-Яа-яЁё\s\-’ʼ.]+$')


def ru_fallback(alts: str) -> str:
    for a in alts.split(','):
        a = a.strip()
        if a and CYR.match(a) and len(a) <= 40:
            return a
    return ''


def load_ru_names(path: str) -> dict:
    """geonameid → русское имя из alternateNamesV2.

    Колонки: id, geonameid, язык, имя, предпочтительное, короткое, разговорное,
    историческое, from, to. Историческое («Верный» для Алматы) отбрасываем,
    предпочтительное берём в первую очередь.
    """
    best = {}
    with zipfile.ZipFile(path) as z:
        # В архиве два txt: список языков и сами имена — берём больший.
        name = max(z.infolist(), key=lambda i: i.file_size).filename
        for line in io.TextIOWrapper(z.open(name), encoding='utf-8'):
            f = line.rstrip('\n').split('\t')
            if len(f) < 8 or f[2] != 'ru':
                continue
            gid, nm, preferred, colloquial, historic = f[1], f[3], f[4] == '1', f[6] == '1', f[7] == '1'
            if historic or colloquial or not nm or len(nm) > 40:
                continue
            rank = (0 if preferred else 1, len(nm))
            if gid not in best or rank < best[gid][0]:
                best[gid] = (rank, nm)
    return {gid: nm for gid, (_, nm) in best.items()}


ru_by_id = load_ru_names(alt_src) if alt_src else {}

rows, tagged = [], 0
with zipfile.ZipFile(src) as z:
    name = [n for n in z.namelist() if n.endswith('.txt')][0]
    for line in io.TextIOWrapper(z.open(name), encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 15:
            continue
        gid, en, alts, lat, lon, fcode, cc, pop = f[0], f[1], f[3], f[4], f[5], f[7], f[8], f[14]
        try:
            lat, lon, pop = round(float(lat), 4), round(float(lon), 4), int(pop or 0)
        except ValueError:
            continue
        ru = ru_by_id.get(gid, '')
        if ru:
            tagged += 1
        else:
            ru = ru_fallback(alts)
        rows.append([en, ru, lat, lon, cc, pop, 1 if fcode == 'PPLC' else 0])

rows.sort(key=lambda r: -r[5])
out = 'assets/geo/cities.json'
with open(out, 'w', encoding='utf-8') as fh:
    json.dump(rows, fh, ensure_ascii=False, separators=(',', ':'))

print(f'городов: {len(rows)}, размер: {os.path.getsize(out) // 1024} КБ, '
      f'с русским именем: {sum(1 for r in rows if r[1])} (из них с пометкой языка: {tagged}), '
      f'столиц: {sum(r[6] for r in rows)}')
for want in ('Bishkek', 'Osh', 'Uzgen', 'Karakol', 'New York City', 'London', 'Almaty'):
    hit = next((r for r in rows if r[0] == want), None)
    print(' ', want, '→', hit[:6] if hit else 'НЕТ')
