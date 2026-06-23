import { useState, type DragEvent } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { MediaFile } from '../types';
import { fileName, formatTime, isVideoFile, mediaUrl } from '../utils/media';

// Миниатюра видео: первый кадр через <video>, без зависимости от FFmpeg.
function VideoThumb({
  file,
  selected,
  onToggle,
  onDuration,
}: {
  file: MediaFile;
  selected: boolean;
  onToggle: () => void;
  onDuration: (seconds: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="relative aspect-square w-full overflow-hidden bg-bg-tertiary focus:outline-none"
    >
      <video
        src={mediaUrl(file.path)}
        muted
        preload="metadata"
        className="h-full w-full object-cover"
        onLoadedMetadata={(e) => onDuration(e.currentTarget.duration)}
      />
      {selected && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-black"
            style={{ backgroundColor: 'var(--accent-green)' }}
          >
            ✓
          </span>
        </span>
      )}
      <span
        className="absolute bottom-1 right-1 rounded-el bg-black/60 px-1 text-white"
        style={{ fontSize: 11 }}
      >
        {formatTime(file.duration)}
      </span>
    </button>
  );
}

export default function MediaPickerScreen() {
  const storeFiles = useProjectStore((s) => s.mediaFiles);
  const storeOrder = useProjectStore((s) => s.mediaOrder);
  const setMediaFiles = useProjectStore((s) => s.setMediaFiles);
  const setScreen = useProjectStore((s) => s.setCurrentScreen);

  // pool — все добавленные файлы (сетка); selectedIds — выбранные в порядке (лента).
  const [pool, setPool] = useState<MediaFile[]>(storeFiles);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    storeOrder.length ? storeOrder : storeFiles.map((f) => f.id)
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function addPaths(paths: string[]) {
    const valid = paths.filter(isVideoFile);
    if (valid.length === 0) return;
    setPool((prev) => {
      const existing = new Set(prev.map((p) => p.id));
      const added = valid
        .filter((p) => !existing.has(p))
        .map<MediaFile>((p) => ({ id: p, path: p, name: fileName(p), duration: 0 }));
      return [...prev, ...added];
    });
    setSelectedIds((prev) => [...prev, ...valid.filter((p) => !prev.includes(p))]);
  }

  async function pickFromDialog() {
    const paths = await window.electronAPI.selectVideos();
    addPaths(paths);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => Boolean(p));
    addPaths(paths);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function removeSelected(id: string) {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }

  function setDuration(id: string, seconds: number) {
    setPool((prev) =>
      prev.map((f) => (f.id === id ? { ...f, duration: seconds } : f))
    );
  }

  function shuffle() {
    setSelectedIds((prev) => {
      const arr = [...prev];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
  }

  function restoreOrder() {
    // «По порядку» — порядок добавления (как в pool).
    setSelectedIds((prev) =>
      pool.map((f) => f.id).filter((id) => prev.includes(id))
    );
  }

  function reorder(from: number, to: number) {
    setSelectedIds((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr;
    });
  }

  function goNext() {
    if (selectedIds.length < 1) return;
    const byId = new Map(pool.map((f) => [f.id, f]));
    const selectedFiles = selectedIds
      .map((id) => byId.get(id))
      .filter((f): f is MediaFile => Boolean(f));
    setMediaFiles(selectedFiles);
    setScreen('music');
  }

  const canNext = selectedIds.length >= 1;

  return (
    <div
      className="flex h-full w-full flex-col bg-bg-primary"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Верхняя панель */}
      <div
        className="flex shrink-0 items-center justify-between bg-bg-secondary px-4"
        style={{ height: 56 }}
      >
        <button
          className="text-text-secondary hover:text-text-primary"
          onClick={() => setScreen('home')}
        >
          ✕ Отмена
        </button>
        <span
          className="font-semibold uppercase text-text-secondary"
          style={{ fontSize: 14 }}
        >
          Выбор видео
        </span>
        <button
          className="font-semibold"
          style={{ color: canNext ? 'var(--accent-green)' : 'var(--text-secondary)' }}
          disabled={!canNext}
          onClick={goNext}
        >
          Далее →
        </button>
      </div>

      {/* Основная область — сетка 4 колонки */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {pool.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-text-secondary">
            <p>Перетащите видео сюда или выберите файлы</p>
            <button className="btn-primary px-6 py-3" onClick={pickFromDialog}>
              Выбрать видео
            </button>
            <p style={{ fontSize: 12 }}>Поддерживаются .mp4, .mov, .avi</p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
            {pool.map((file) => (
              <VideoThumb
                key={file.id}
                file={file}
                selected={selectedIds.includes(file.id)}
                onToggle={() => toggleSelect(file.id)}
                onDuration={(sec) => setDuration(file.id, sec)}
              />
            ))}
            {/* Кнопка добавления ещё файлов */}
            <button
              className="flex aspect-square w-full items-center justify-center bg-bg-tertiary text-3xl text-text-secondary hover:text-text-primary"
              onClick={pickFromDialog}
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Нижняя лента выбранных клипов */}
      <div
        className="flex shrink-0 items-center gap-3 bg-bg-secondary px-3"
        style={{ height: 120 }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {selectedIds.map((id, index) => {
            const file = pool.find((f) => f.id === id);
            if (!file) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragIndex !== null && dragIndex !== index) reorder(dragIndex, index);
                  setDragIndex(null);
                }}
                className="relative shrink-0 cursor-grab"
                style={{ width: 80 }}
              >
                <div className="relative overflow-hidden rounded-el bg-bg-tertiary" style={{ width: 80, height: 80 }}>
                  <video src={mediaUrl(file.path)} muted preload="metadata" className="h-full w-full object-cover" />
                  <button
                    className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-black/70 text-white"
                    style={{ fontSize: 11 }}
                    onClick={() => removeSelected(id)}
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-0.5 text-center text-text-secondary" style={{ fontSize: 11 }}>
                  {index + 1}
                </div>
              </div>
            );
          })}
          {selectedIds.length === 0 && (
            <span className="text-text-secondary" style={{ fontSize: 13 }}>
              Нет выбранных клипов
            </span>
          )}
        </div>

        {/* Кнопки порядка */}
        <div className="flex shrink-0 flex-col gap-2">
          <button
            className="btn-secondary px-3 py-1.5"
            style={{ fontSize: 13 }}
            onClick={shuffle}
            disabled={selectedIds.length < 2}
          >
            ⤮ Перемешать
          </button>
          <button
            className="btn-secondary px-3 py-1.5"
            style={{ fontSize: 13 }}
            onClick={restoreOrder}
            disabled={selectedIds.length < 2}
          >
            ↕ По порядку
          </button>
        </div>
      </div>
    </div>
  );
}
