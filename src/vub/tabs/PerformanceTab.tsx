import { useEffect } from 'react';
import { useVubStore, type FileProgress } from '../store';
import { Slider } from '../components/ui';

const cores = navigator.hardwareConcurrency || 4;

// Вкладка 8: Производительность и Сохранение (§4.9 ТЗ).
export default function PerformanceTab() {
  const {
    threads, setThreads, variations, setVariations, outputDir, setOutputDir,
    videos, params, effects, watermark, text, template, cleanMetadata,
    isProcessing, setIsProcessing, progress, setProgress, updateProgress,
  } = useVubStore();

  useEffect(() => {
    const off = window.electronAPI.onVubProgress((p) => updateProgress(p.id, p));
    return off;
  }, [updateProgress]);

  async function pickFolder() {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setOutputDir(dir);
  }

  async function start() {
    if (!videos.length || !outputDir || isProcessing) return;
    // Разворачиваем строки прогресса: каждое видео -> N вариаций (id совпадает со схемой в main).
    const initial: FileProgress[] = [];
    for (const v of videos) {
      const base = v.name.replace(/\.[^.]+$/, '');
      for (let i = 0; i < variations; i++) {
        initial.push({
          id: variations > 1 ? `${v.id}#${i}` : v.id,
          name: variations > 1 ? `${base} — вариация ${i + 1}` : v.name,
          status: 'queued',
          percent: 0,
        });
      }
    }
    setProgress(initial);
    setIsProcessing(true);
    try {
      await window.electronAPI.processVub({
        videos,
        params,
        effects,
        watermark,
        text,
        template,
        cleanMetadata,
        threads,
        variations,
        outputDir,
      });
    } finally {
      setIsProcessing(false);
    }
  }

  function cancel() {
    window.electronAPI.cancelVub();
    setIsProcessing(false);
  }

  const statusLabel: Record<FileProgress['status'], string> = {
    queued: 'В очереди',
    processing: 'Обработка',
    done: 'Готово',
    error: 'Ошибка',
  };

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 16 }}>
        Производительность и Сохранение
      </h2>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>Вариаций на видео</span>
          <input
            type="number"
            min={1}
            max={100}
            value={variations}
            onChange={(e) => setVariations(Number(e.target.value))}
            style={{ width: 80, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4, padding: '4px 8px', fontSize: 13, textAlign: 'center' }}
          />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
          Каждая вариация получает свои случайные значения из заданных диапазонов.
          {videos.length > 0 && ` Будет создано ${videos.length * variations} файлов.`}
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>Количество потоков (параллельно)</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{threads} / {cores}</span>
        </div>
        <Slider min={1} max={cores} value={threads} onChange={setThreads} />
      </div>

      <button
        onClick={pickFolder}
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
      >
        Папка сохранения
      </button>
      {outputDir && <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>{outputDir}</p>}

      <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
        <button
          onClick={start}
          disabled={!videos.length || !outputDir || isProcessing}
          className="btn-primary"
          style={{ padding: '10px 24px', fontSize: 14, opacity: !videos.length || !outputDir || isProcessing ? 0.4 : 1 }}
        >
          {isProcessing ? 'Обработка…' : 'Запустить обработку'}
        </button>
        {isProcessing && (
          <button
            onClick={cancel}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}
          >
            Отмена
          </button>
        )}
      </div>

      {progress.length > 0 && (
        <table style={{ marginTop: 24, width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
              <th style={{ padding: '8px 0', fontWeight: 600 }}>Имя файла</th>
              <th style={{ padding: '8px 0', fontWeight: 600, width: 120 }}>Статус</th>
              <th style={{ padding: '8px 0', fontWeight: 600, width: 180 }}>Прогресс</th>
            </tr>
          </thead>
          <tbody>
            {progress.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{p.name}</td>
                <td style={{ padding: '8px 0', color: p.status === 'error' ? 'var(--danger)' : p.status === 'done' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  {statusLabel[p.status]}
                </td>
                <td style={{ padding: '8px 0' }}>
                  <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${p.percent}%`, background: 'var(--accent-green)', transition: 'width 0.2s ease' }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
