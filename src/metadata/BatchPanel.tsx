import { useEffect, useRef, useState } from 'react';
import { showToast } from '../store/toastStore';
import { mediaUrl } from '../utils/media';
import { RandomOptions, DEFAULT_RAND, type RandOpts } from './RandomPanel';

type Target = 'overwrite' | 'copy' | 'folder';
type ValuesMode = 'same' | 'random';
type Pair = { tag: string; value: string };

const GPS_KEY = '__gps';
const LABEL: Record<string, string> = { [GPS_KEY]: 'Координаты (широта, долгота)' };
const VID_RE = /\.(mp4|mov|m4v|3gp|3g2|mkv|webm|avi|mpg|mpeg|wmv|flv|m2ts|ts)$/i;
const isVideo = (f: string) => VID_RE.test(f);
// В MKV/WEBM/AVI exiftool писать не умеет — предупреждаем до запуска, а не в отчёте.
const NOT_WRITABLE_RE = /\.(mkv|webm|avi|mpg|mpeg|wmv|flv|m2ts|ts|gif)$/i;

// Пакетный режим: набрал пачку фото → применил ко всем одинаковые или у каждого свои случайные метаданные.
export default function BatchPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [valuesMode, setValuesMode] = useState<ValuesMode>('random');
  const [rand, setRand] = useState<RandOpts>(DEFAULT_RAND);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [stripAll, setStripAll] = useState(true);
  const [target, setTarget] = useState<Target>('copy');
  const [outDir, setOutDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0, name: '' });
  const [report, setReport] = useState<{ ok: number; failed: { name: string; error: string }[]; dir: string | null; canceled: boolean } | null>(null);
  const offRef = useRef<(() => void) | null>(null);

  useEffect(() => () => offRef.current?.(), []);

  const add = (list: string[]) => setFiles((f) => [...new Set([...f, ...list])]);

  async function addFiles() { add(await window.electronAPI.metaPickMany()); }
  async function addFolder() {
    const dir = await window.electronAPI.metaPickFolder();
    if (!dir) return;
    const found = await window.electronAPI.metaScanFolder(dir);
    if (!found.length) { showToast('В папке нет изображений'); return; }
    add(found);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const list = Array.from(e.dataTransfer.files).map((f) => window.electronAPI.getPathForFile(f)).filter(Boolean);
    if (list.length) add(list);
  }

  async function rollSame() {
    // Набор тегов зависит от типа: у видео нет выдержки/ISO, зато даты дублируются в дорожки.
    const allVideo = files.length > 0 && files.every(isVideo);
    const gen = await window.electronAPI.metaRandom(rand, allVideo ? 'video' : 'image');
    // Сгенерённое можно править руками перед запуском — это просто заготовка.
    setPairs(Object.entries(gen).map(([tag, value]) => ({ tag, value })));
  }

  async function chooseDir() {
    const d = await window.electronAPI.metaPickFolder();
    if (d) { setOutDir(d); setTarget('folder'); }
  }

  async function run() {
    if (!files.length) { showToast('Сначала добавь фото'); return; }
    if (target === 'folder' && !outDir) { showToast('Выбери папку назначения'); return; }
    if (valuesMode === 'same' && !pairs.length && !stripAll) { showToast('Нечего применять: задай поля или включи очистку'); return; }
    if (valuesMode === 'random' && !rand.device && !rand.shot && !rand.gps && !rand.date && !stripAll) { showToast('Отметь, что рандомить'); return; }
    if (target === 'overwrite' && !window.confirm(`Метаданные будут переписаны прямо в ${files.length} файл(ах). Отменить будет нельзя. Продолжить?`)) return;

    setRunning(true);
    setReport(null);
    setProg({ done: 0, total: files.length, name: '' });
    offRef.current = window.electronAPI.onMetaBatchProgress(setProg);
    try {
      const edits: Record<string, string> = {};
      for (const p of pairs) if (p.tag.trim()) edits[p.tag.trim()] = p.value;
      const res = await window.electronAPI.metaBatch({
        files, valuesMode, edits, deletes: [], stripAll, rand, target, outDir: outDir ?? undefined,
      });
      setReport(res);
      showToast(res.canceled ? `Остановлено, обработано ${res.ok}` : `Готово: ${res.ok} из ${files.length}`);
    } finally {
      offRef.current?.();
      offRef.current = null;
      setRunning(false);
    }
  }

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const videoCount = files.filter(isVideo).length;
  const skipCount = files.filter((f) => NOT_WRITABLE_RE.test(f)).length;

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Список файлов */}
      <div style={{ width: 320, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={addFiles} style={btnSecondary}>＋ Фото</button>
          <button onClick={addFolder} style={btnSecondary}>📁 Папка</button>
          {files.length > 0 && <button onClick={() => setFiles([])} style={btnSecondary}>Очистить</button>}
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 460, overflowY: 'auto' }}>
          {files.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
              Перетащи сюда фото, видео или папку —<br />или добавь кнопками выше
            </div>
          ) : files.map((f, i) => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)' }}>
              {isVideo(f) ? (
                <video src={mediaUrl(f)} muted preload="metadata" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 5, background: '#000', flexShrink: 0 }} />
              ) : (
                <img src={mediaUrl(f)} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 5, background: '#000', flexShrink: 0 }} />
              )}
              <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{f}</span>
              <button onClick={() => setFiles((x) => x.filter((y) => y !== f))} style={xBtn}>✕</button>
            </div>
          ))}
        </div>
        {files.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 6 }}>
            Файлов: {files.length}{videoCount ? ` · из них видео: ${videoCount}` : ''}
          </div>
        )}
        {skipCount > 0 && (
          <div style={{ marginTop: 6, background: 'rgba(250,204,21,0.12)', color: '#facc15', borderRadius: 7, padding: '6px 9px', fontSize: 11 }}>
            {skipCount} файл(ов) в формате без поддержки записи (MKV/WEBM/AVI/GIF) — их только читать, в отчёте будут отмечены пропущенными.
          </div>
        )}
        {videoCount > 0 && (
          <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-secondary)' }}>
            Видео exiftool перезаписывает целиком — на крупных файлах секунды-десятки секунд на штуку.
          </div>
        )}
      </div>

      {/* Настройки */}
      <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Section title="Что записываем">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Seg active={valuesMode === 'random'} onClick={() => setValuesMode('random')}>🎲 У каждого свои случайные</Seg>
            <Seg active={valuesMode === 'same'} onClick={() => setValuesMode('same')}>📋 Одинаковые для всех</Seg>
          </div>
          <RandomOptions value={rand} onChange={setRand} />
          {valuesMode === 'same' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button onClick={rollSame} style={btnSecondary}>🎲 Сгенерировать один набор</button>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>значения ниже уйдут во все фото — можно править руками</span>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {pairs.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', background: i % 2 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)' }}>
                    <input
                      value={LABEL[p.tag] ?? p.tag}
                      readOnly={!!LABEL[p.tag]}
                      onChange={(e) => setPairs((x) => x.map((y, j) => (j === i ? { ...y, tag: e.target.value } : y)))}
                      style={{ ...inputBase, width: 190, flexShrink: 0, color: 'var(--text-secondary)' }}
                    />
                    <input
                      value={p.value}
                      onChange={(e) => setPairs((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))}
                      style={{ ...inputBase, flex: 1 }}
                    />
                    <button onClick={() => setPairs((x) => x.filter((_, j) => j !== i))} style={xBtn}>✕</button>
                  </div>
                ))}
                <div style={{ padding: '5px 8px' }}>
                  <button onClick={() => setPairs((x) => [...x, { tag: '', value: '' }])} style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11.5 }}>＋ Поле</button>
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section title="Куда сохраняем">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Seg active={target === 'copy'} onClick={() => setTarget('copy')}>Копии рядом (_meta)</Seg>
            <Seg active={target === 'folder'} onClick={() => (outDir ? setTarget('folder') : chooseDir())}>В отдельную папку</Seg>
            <Seg active={target === 'overwrite'} onClick={() => setTarget('overwrite')} danger>Перезаписать оригиналы</Seg>
          </div>
          {target === 'folder' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <button onClick={chooseDir} style={{ ...btnSecondary, padding: '5px 10px', fontSize: 11.5 }}>Выбрать…</button>
              <span style={{ fontSize: 11.5, color: outDir ? 'var(--text-primary)' : '#f87171' }}>{outDir || 'папка не выбрана'}</span>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={stripAll} onChange={(e) => setStripAll(e.target.checked)} style={{ accentColor: 'var(--accent-green)' }} />
            Сначала стереть все старые метаданные
          </label>
        </Section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={run} disabled={running || !files.length} style={{ ...btnPrimary, opacity: running || !files.length ? 0.5 : 1 }}>
            {running ? `Обрабатываю ${prog.done}/${prog.total}…` : `Применить к ${files.length} фото`}
          </button>
          {running && <button onClick={() => window.electronAPI.metaBatchCancel()} style={btnSecondary}>Остановить</button>}
        </div>

        {running && (
          <div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-green)', transition: 'width .15s' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5 }}>{prog.name}</div>
          </div>
        )}

        {report && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 12 }}>
            <div style={{ color: '#4ade80', fontWeight: 600 }}>Обработано: {report.ok}{report.canceled ? ' (остановлено)' : ''}</div>
            {report.dir && (
              <button onClick={() => window.electronAPI.metaReveal(report.dir!)} style={{ ...btnSecondary, marginTop: 8, padding: '5px 10px', fontSize: 11.5 }}>📂 Открыть папку</button>
            )}
            {report.failed.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: '#f87171', fontWeight: 600, marginBottom: 4 }}>Ошибки: {report.failed.length}</div>
                <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {report.failed.map((f, i) => <div key={i}>{f.name || '—'}: {f.error}</div>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Seg({ active, onClick, children, danger }: { active: boolean; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  const color = danger ? '#f87171' : 'var(--accent-green)';
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? (danger ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.12)') : 'var(--bg-tertiary)',
        color: active ? color : 'var(--text-primary)',
      }}
    >
      {children}
    </button>
  );
}

const inputBase: React.CSSProperties = { padding: '4px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 12, outline: 'none', minWidth: 0 };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--accent-green)', color: '#04120c', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '7px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, cursor: 'pointer' };
const xBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, padding: '0 4px' };
