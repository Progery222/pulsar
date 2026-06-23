import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUIStore } from '../store/uiStore';
import { buildAndRender } from '../utils/ffmpegBuilder';
import { showToast } from '../store/toastStore';
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

    try {
      const ok = await buildAndRender(useProjectStore.getState(), outputPath, quality, (p) =>
        setExportProgress(p)
      );
      if (ok) {
        const count = useProjectStore.getState().uniqualizerCount;
        showToast(count > 1 ? `Сохранено ${count} видео!` : 'Видео сохранено!', {
          actionLabel: 'Открыть папку',
          onAction: () => window.electronAPI.openFolder(folder),
        });
      }
      // При отмене (ok === false) — тихо, без уведомления.
    } catch {
      // §14: ошибка FFmpeg — диалоговое окно.
      window.alert(
        'Ошибка при обработке видео. Попробуйте другой файл или проверьте, что видеофайл не повреждён.'
      );
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setShowExport(false)}
    >
      <div
        className="flex w-[420px] flex-col rounded-card bg-bg-secondary p-5"
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
