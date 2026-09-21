import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { randomTags, readMeta, writeMeta } from './ipc/metadata';
import { findCity } from './ipc/geoCatalog';

/**
 * Проверка собранного приложения «Метаданные» — то, что на Windows не проверить:
 * запускается ли exiftool (perl) и ffmpeg из распакованного asar, находится ли
 * каталог городов в resources и открывается ли окно с интерфейсом.
 *
 * Каждый файл папки: случайные теги → запись в копию → чтение копии → тег на месте.
 * Результат — строками в stdout, итог — булево.
 */
export async function runSmoke(dir: string, openWindow: () => BrowserWindow): Promise<boolean> {
  let ok = true;
  const report = (pass: boolean, what: string, detail = ''): void => {
    if (!pass) ok = false;
    console.log(`${pass ? 'OK  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  };

  const city = findCity('Бишкек');
  report(!!city, 'каталог городов', city ? `${city.ru} ${city.lat},${city.lon}` : 'не найден в resources/assets/geo');

  const files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !n.includes('_meta')).map((n) => path.join(dir, n)) : [];
  report(files.length > 0, 'тестовые файлы', `${files.length} в ${dir || '(папка не задана)'}`);

  for (const file of files) {
    const name = path.basename(file);
    try {
      const before = await readMeta(file);
      if (before.error) { report(false, name, `чтение: ${before.error}`); continue; }
      const edits = randomTags({ device: true, shot: true, gps: true, date: true }, before.kind);
      // Проверяем по полю, которое у этого вида файлов пишется всегда.
      const probe = before.kind === 'audio' ? 'Title' : 'Model';
      if (before.kind === 'audio') edits.Title = 'Smoke Test';
      const after = await writeMeta({ file, edits, deletes: [], mode: 'copy' });
      if (after.error) { report(false, name, `запись: ${after.error}`); continue; }
      const got = after.groups.flatMap((g) => g.rows).find((r) => r.tag === probe)?.value;
      report(got === edits[probe], name, `${before.kind}: ${probe}=${got ?? 'нет'} (ждали ${edits[probe]}) → ${path.basename(after.file)}`);
    } catch (err) {
      report(false, name, (err as Error).stack ?? String(err));
    }
  }

  // Интерфейс: bundle грузится, preload отдаёт API, экран рисуется.
  try {
    const w = openWindow();
    await new Promise<void>((resolve, reject) => {
      w.webContents.once('did-finish-load', () => resolve());
      w.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`${code} ${desc}`)));
    });
    await new Promise((r) => setTimeout(r, 1500));
    const text: string = await w.webContents.executeJavaScript('document.body.innerText');
    const api: boolean = await w.webContents.executeJavaScript("typeof window.electronAPI?.metaRead === 'function'");
    report(text.includes('Метаданные') && text.includes('Один файл') && api, 'окно', `API ${api ? 'есть' : 'нет'}, текст: ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
    // Превью файла в окне идёт через media:// — та же адресация, что в utils/media.ts.
    if (files[0]) {
      const url = `media:///${encodeURIComponent(files[0])}`;
      const status: number = await w.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}).then((r) => r.status)`);
      report(status === 200, 'превью media://', `${path.basename(files[0])}: HTTP ${status}`);
    }
  } catch (err) {
    report(false, 'окно', String(err));
  }

  console.log(ok ? 'SMOKE PASSED' : 'SMOKE FAILED');
  return ok;
}
