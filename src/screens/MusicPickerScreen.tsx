import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { Track } from '../types';
import { fileName, formatTime, mediaUrl } from '../utils/media';
import { analyzeBeat } from '../utils/beatDetection';
import tracksData from '../data/tracks.json';

const TRACKS = tracksData as Track[];

const CATEGORIES = [
  'FEATURED',
  'POP',
  'RAP',
  'CINEMATIC',
  'SPORT',
  'TRAVEL',
  'ACOUSTIC',
  'FUNK',
  'HOUSE',
] as const;

// Цвет-заглушка обложки по категории (реальные обложки добавляются в assets/covers).
const COVER_COLORS: Record<string, string> = {
  POP: '#FF6B9D',
  RAP: '#5C5C5C',
  CINEMATIC: '#3A5BA0',
  SPORT: '#FF6B35',
  TRAVEL: '#1FB6A6',
  ACOUSTIC: '#B5894F',
  FUNK: '#C44FC4',
  HOUSE: '#4F6BFF',
  FILES: '#252525',
};

function Cover({ track, size }: { track: Track; size: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: COVER_COLORS[track.category] ?? '#252525',
        fontSize: size * 0.4,
      }}
    >
      {track.title.charAt(0)}
    </div>
  );
}

export default function MusicPickerScreen() {
  const selectedTrack = useProjectStore((s) => s.selectedTrack);
  const setSelectedTrack = useProjectStore((s) => s.setSelectedTrack);
  const setScreen = useProjectStore((s) => s.setCurrentScreen);

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('FEATURED');
  const [source, setSource] = useState<'beatleap' | 'files'>('beatleap');
  const [fileTracks, setFileTracks] = useState<Track[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Останавливаем превью при уходе с экрана.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function playPreview(track: Track) {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = mediaUrl(track.file);
    audio.currentTime = 0;
    audio.onended = () => setPlayingId(null);
    audio.play().then(() => setPlayingId(track.id)).catch(() => setPlayingId(null));
  }

  function stopPreview() {
    audioRef.current?.pause();
    setPlayingId(null);
  }

  function onTrackClick(track: Track) {
    if (selectedTrack?.id === track.id) {
      // Тот же трек — переключить воспроизведение.
      if (playingId === track.id) stopPreview();
      else playPreview(track);
      return;
    }
    setSelectedTrack(track);
    playPreview(track);
  }

  async function openFilesDialog() {
    setSource('files');
    const path = await window.electronAPI.selectAudio();
    if (!path) return;
    const track: Track = {
      id: `file:${path}`,
      title: fileName(path),
      artist: 'Локальный файл',
      duration: 0,
      category: 'FILES',
      file: path,
    };
    setFileTracks((prev) =>
      prev.some((t) => t.id === track.id) ? prev : [...prev, track]
    );
    setSelectedTrack(track);
  }

  // Предварительный анализ выбранного трека в фоне — к моменту «Далее» бит уже
  // посчитан и лежит в кэше, окно синхронизации не висит.
  useEffect(() => {
    if (!selectedTrack) return;
    const t = setTimeout(() => {
      void analyzeBeat(selectedTrack.file, selectedTrack.duration ?? 0);
    }, 800);
    return () => clearTimeout(t);
  }, [selectedTrack]);

  function goNext() {
    stopPreview();
    setScreen('processing');
  }

  const listTracks =
    source === 'files'
      ? fileTracks
      : category === 'FEATURED'
        ? TRACKS
        : TRACKS.filter((t) => t.category === category);

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary">
      {/* Верхняя панель */}
      <div
        className="flex shrink-0 items-center justify-between bg-bg-secondary px-4"
        style={{ height: 56 }}
      >
        <button
          className="text-text-secondary hover:text-text-primary"
          onClick={() => {
            stopPreview();
            setScreen('media');
          }}
        >
          ← Назад
        </button>
        <span className="font-semibold uppercase text-text-secondary" style={{ fontSize: 14 }}>
          Выбор музыки
        </span>
        <button
          className="font-semibold"
          style={{ color: 'var(--accent-green)' }}
          onClick={goNext}
        >
          {selectedTrack ? 'Далее →' : 'Без музыки →'}
        </button>
      </div>

      {/* Табы категорий (только для встроенной библиотеки) */}
      {source === 'beatleap' && (
        <div className="flex shrink-0 gap-5 overflow-x-auto border-b border-border px-4 py-3">
          {CATEGORIES.map((cat) => {
            const active = cat === category;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className="whitespace-nowrap pb-1 font-semibold"
                style={{
                  fontSize: 13,
                  color: active ? 'var(--accent-green)' : 'var(--text-secondary)',
                  borderBottom: active ? '2px solid var(--accent-green)' : '2px solid transparent',
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* Список треков */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {listTracks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-secondary">
            {source === 'files' ? 'Нет загруженных файлов' : 'Нет треков в категории'}
          </div>
        ) : (
          listTracks.map((track) => {
            const isSelected = selectedTrack?.id === track.id;
            const isPlaying = playingId === track.id;
            return (
              <button
                key={track.id}
                onClick={() => onTrackClick(track)}
                className="flex w-full items-center gap-3 border-b border-border px-4 text-left hover:bg-bg-secondary"
                style={{ height: 72 }}
              >
                <div className="relative">
                  <Cover track={track} size={48} />
                  <span className="absolute inset-0 flex items-center justify-center text-white">
                    {isPlaying ? '⏸' : '▶'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-text-primary" style={{ fontSize: 15 }}>
                    {track.title}
                  </div>
                  <div className="truncate text-text-secondary" style={{ fontSize: 13 }}>
                    {track.artist}
                  </div>
                </div>
                <span className="text-text-secondary" style={{ fontSize: 13 }}>
                  {track.duration > 0 ? formatTime(track.duration) : '—'}
                </span>
                {/* Синяя точка выбранного трека */}
                <span
                  className="ml-2 h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: isSelected ? '#4F6BFF' : 'transparent' }}
                />
              </button>
            );
          })
        )}
      </div>

      {/* Нижние вкладки источников */}
      <div className="flex shrink-0 border-t border-border bg-bg-secondary">
        <button
          className="flex-1 py-3 font-semibold"
          style={{
            fontSize: 13,
            color: source === 'beatleap' ? 'var(--accent-green)' : 'var(--text-secondary)',
          }}
          onClick={() => setSource('beatleap')}
        >
          PULSAR
        </button>
        <button
          className="flex-1 py-3 font-semibold"
          style={{
            fontSize: 13,
            color: source === 'files' ? 'var(--accent-green)' : 'var(--text-secondary)',
          }}
          onClick={openFilesDialog}
        >
          ФАЙЛЫ
        </button>
      </div>
    </div>
  );
}
