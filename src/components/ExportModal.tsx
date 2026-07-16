import { useEffect, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { buildAndRender } from '../utils/ffmpegBuilder';
import { showToast } from '../store/toastStore';
import { PLATFORM_PRESETS } from '../data/platformPresets';
import { useQueueStore } from '../store/queueStore';
import UniqualizerPanel from './UniqualizerPanel';

type Quality = '720p' | '1080p' | '4k';

const QUALITIES: { key: Quality; label: string }[] = [
  { key: '720p', label: '720p (HD)' },
  { key: '1080p', label: '1080p (Full HD)' },
  { key: '4k', label: '4K (Ultra HD)' },
];

// ExportModal (§11).
export default function ExportModal() {
  const setShowExport = useUIStore((s) => s.setShowExport);
  const setIsExporting = useProjectStore((s) => s.setIsExporting);
  const setExportProgress = useProjectStore((s) => s.setExportProgress);

  const [quality, setQuality] = useState<Quality>('1080p');
  const [folder, setFolder] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState<string>('');

  useEffect(() => {
    window.electronAPI.getSetting('defaultOutputDir').then((d) => {
      if (d) setFolder(d as string);
    });
  }, []);

  function applyPreset(key: string) {
    setPresetKey(key);
    const p = PLATFORM_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setQuality(p.quality);
    const st = useProjectStore.getState();
    st.setFormat(p.format);
    if (p.maxDuration > 0 && st.duration > p.maxDuration) st.setDuration(p.maxDuration);
  }

  async function chooseFolder() {
    const f = await window.electronAPI.selectDirectory();
    if (f) setFolder(f);
  }

  async function exportVideo() {
    if (!folder) return;
    setShowExport(false);
    setIsExporting(true);
    setExportProgress(0);

    const sep = folder.includes('\\') ? '\\' : '/';
    const outputPath = `${folder}${sep}pulsar_${Date.now()}.mp4`;

    const queue = useQueueStore.getState();
    const jobId = `editor_${Date.now()}`;
    queue.addJobs([{ id: jobId, mode: 'editor', name: `Монтаж • ${quality}`, status: 'processing', percent: 0 }]);

    try {
      const ok = await buildAndRender(useProjectStore.getState(), outputPath, quality, (p) => {
        setExportProgress(p);
        queue.updateJob(jobId, { percent: p });
      });
      queue.updateJob(jobId, ok ? { status: 'done', percent: 100 } : { status: 'error' });
      if (ok) {
        const count = useProjectStore.getState().uniqualizerCount;
        window.electronAPI.historyAdd({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          mode: 'editor',
          title: `Монтаж • ${quality} • ${useProjectStore.getState().format}`,
          createdAt: Date.now(),
          outputDir: folder,
          files: Array.from({ length: Math.max(1, count) }, (_, i) => `pulsar_${i + 1}.mp4`),
          settings: null,
        });
        showToast(count > 1 ? `Сохранено ${count} видео!` : 'Видео сохранено!', {
          actionLabel: 'Открыть папку',
          onAction: () => window.electronAPI.openFolder(folder),
        });
      }
      // При отмене (ok === false) — тихо, без уведомления.
    } catch (err) {
      queue.updateJob(jobId, { status: 'error' });
      // §14: ошибка FFmpeg — диалоговое окно (с технической причиной для диагностики).
      const detail = err instanceof Error ? err.message : String(err);
      window.alert(
        'Ошибка при обработке видео. Попробуйте другой файл или проверьте, что видеофайл не повреждён.\n\n' +
          `Детали: ${detail}`
      );
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setShowExport(false)}
    >
      <div
        className="modal-panel flex w-[420px] flex-col rounded-card bg-bg-secondary p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-text-primary" style={{ fontSize: 18 }}>
            Экспорт видео
          </h2>
          <button className="text-text-secondary hover:text-text-primary" onClick={() => setShowExport(false)}>
            ✕
          </button>
        </div>

        {/* Пресет площадки */}
        <label className="mb-1 text-text-secondary" style={{ fontSize: 13 }}>
          Пресет площадки
        </label>
        <select
          value={presetKey}
          onChange={(e) => applyPreset(e.target.value)}
          className="mb-1 rounded-el bg-bg-tertiary px-3 py-2 text-text-primary"
        >
          <option value="">Свои настройки</option>
          {PLATFORM_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="mb-4 text-text-secondary" style={{ fontSize: 11 }}>
          {PLATFORM_PRESETS.find((p) => p.key === presetKey)?.note ??
            'Задаёт формат кадра, разрешение и длительность под площадку'}
        </div>

        {/* Качество */}
        <label className="mb-1 text-text-secondary" style={{ fontSize: 13 }}>
          Качество
        </label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as Quality)}
          className="mb-4 rounded-el bg-bg-tertiary px-3 py-2 text-text-primary"
        >
          {QUALITIES.map((q) => (
            <option key={q.key} value={q.key}>
              {q.label}
            </option>
          ))}
        </select>

        {/* Папка */}
        <button className="btn-secondary mb-2 px-4 py-2" onClick={chooseFolder}>
          Выбрать папку
        </button>
        <div className="mb-4 truncate text-text-secondary" style={{ fontSize: 12 }}>
          {folder ?? 'Папка не выбрана'}
        </div>

        {/* Секция уникализатора (§ТЗ) */}
        <UniqualizerPanel />

        <button className="btn-primary px-4 py-3" onClick={exportVideo} disabled={!folder}>
          Экспортировать
        </button>
      </div>
    </div>
  );
}
