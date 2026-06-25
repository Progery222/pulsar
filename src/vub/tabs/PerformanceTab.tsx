import { useEffect, useState } from 'react';
import { useVubStore, type FileProgress } from '../store';
import { Slider } from '../components/ui';
import { outFileName } from '../naming';
import { showToast } from '../../store/toastStore';

const cores = navigator.hardwareConcurrency || 4;

// Вкладка 8: Производительность и Сохранение (§4.9 ТЗ).
export default function PerformanceTab() {
  const {
    threads, setThreads, variations, setVariations, namePattern, setNamePattern,
    outputDir, setOutputDir,
    videos, params, effects, watermark, text, template, cleanMetadata, titles,
    isProcessing, setIsProcessing, progress, setProgress, updateProgress,
  } = useVubStore();

  useEffect(() => {
    const off = window.electronAPI.onVubProgress((p) => updateProgress(p.id, p));
    return off;
  }, [updateProgress]);

  useEffect(() => {
    const off = window.electronAPI.onVubWarning((msg) => showToast(msg));
    return off;
  }, []);

  const [gpuMode, setGpuModeState] = useState<'auto' | 'gpu' | 'cpu'>('auto');
  useEffect(() => {
    window.electronAPI.getGpuMode().then(setGpuModeState);
  }, []);
  function changeGpuMode(m: 'auto' | 'gpu' | 'cpu') {
    setGpuModeState(m);
    window.electronAPI.setGpuMode(m);
  }
  const GPU_LABELS: Record<'auto' | 'gpu' | 'cpu', string> = {
    auto: 'Авто',
    gpu: 'GPU',
    cpu: 'CPU',
  };

  async function pickFolder() {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setOutputDir(dir);
  }

  async function start() {
    if (!videos.length || !outputDir || isProcessing) return;
    // Строки прогресса показывают будущие имена файлов (та же схема, что в main).
    const totalFiles = videos.length * variations;
    const initial: FileProgress[] = [];
    let g = 0;
    for (const v of videos) {
      const base = v.name.replace(/\.[^.]+$/, '');
      for (let i = 0; i < variations; i++) {
        initial.push({
          id: variations > 1 ? `${v.id}#${i}` : v.id,
          name: outFileName({
            baseName: base,
            variationIndex: i,
            variationTotal: variations,
            globalIndex: g,
            totalFiles,
            pattern: namePattern,
          }),
          status: 'queued',
          percent: 0,
        });
        g++;
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
        titles,
        threads,
        variations,
        namePattern,
        outputDir,
      });
      window.electronAPI.historyAdd({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        mode: 'vub',
        title: `Уникализатор • ${videos.length} видео × ${variations}`,
        createdAt: Date.now(),
        outputDir,
        files: initial.map((p) => p.name),
        settings: null,
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

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Кодирование (GPU-ускорение)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['auto', 'gpu', 'cpu'] as const).map((m) => (
            <button
              key={m}
              onClick={() => changeGpuMode(m)}
              style={{
                flex: 1,
                background: gpuMode === m ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                color: gpuMode === m ? '#0D0D0D' : 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 0',
                fontSize: 13,
                fontWeight: gpuMode === m ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {GPU_LABELS[m]}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          Авто — использовать видеокарту (NVIDIA/Intel/AMD) при наличии, иначе CPU. GPU ускоряет рендер в разы.
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Имя файлов</div>
        <input
          type="text"
          value={namePattern}
          onChange={(e) => setNamePattern(e.target.value)}
          placeholder="пусто = имя оригинала + _unique"
          style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
        />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
          {namePattern.trim()
            ? videos.length * variations > 1
              ? `Файлы: ${namePattern.trim()}_1.mp4, ${namePattern.trim()}_2.mp4 …`
              : `Файл: ${namePattern.trim()}.mp4`
            : 'По умолчанию используется имя исходного видео.'}
        </p>
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
                <td style={{ padding: '8px 0', maxWidth: 280 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  {p.status === 'error' && p.error && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', whiteSpace: 'normal', marginTop: 2 }} title={p.error}>
                      {p.error}
                    </div>
                  )}
                </td>
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
