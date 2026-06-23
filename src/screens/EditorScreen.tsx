import { useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { generateClips } from '../utils/videoSlicer';
import { applyEffects } from '../utils/effectsEngine';
import VideoPreview from '../components/VideoPreview';
import Timeline from '../components/Timeline';
import ToolsPanel from '../components/ToolsPanel';
import EditPanel from '../components/EditPanel';
import FiltersPanel from '../components/FiltersPanel';

type Tab = 'tools' | 'edit' | 'filters';

export default function EditorScreen() {
  const format = useProjectStore((s) => s.format);
  const clips = useProjectStore((s) => s.generatedClips);
  const setScreen = useProjectStore((s) => s.setCurrentScreen);

  const [activeTab, setActiveTab] = useState<Tab>('tools');
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrub, setScrub] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const totalDuration = useMemo(
    () => clips.reduce((s, c) => s + c.duration, 0) || 1,
    [clips]
  );

  // Маркеры эффектов на таймлайне: абсолютные времена слотов / общая длительность.
  const markers = useMemo(() => {
    const times: number[] = [];
    let acc = 0;
    for (const c of clips) {
      for (const slot of c.effectSlots) times.push(slot.time);
      acc += c.duration;
    }
    void acc;
    return times.map((t) => Math.max(0, Math.min(1, t / totalDuration)));
  }, [clips, totalDuration]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }

  function goHome() {
    if (window.confirm('Вернуться на главную? Прогресс будет потерян.')) {
      setScreen('home');
    }
  }

  function changeTrack() {
    setScreen('music');
  }

  // Иконка Shuffle (§5.5): повторная генерация монтажа с теми же настройками.
  function shuffleMontage() {
    const s = useProjectStore.getState();
    if (!s.beatData) return;
    const order = [...(s.mediaOrder.length ? s.mediaOrder : s.mediaFiles.map((f) => f.id))];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const newClips = generateClips(s.beatData, s.mediaFiles, s.mood, s.duration, s.segmentStart, order);
    const withEffects = applyEffects(newClips, s.activeEffects, s.beatData.beat_times);
    s.setGeneratedClips(withEffects);
  }

  function onScrub(v: number) {
    setScrub(v);
    const video = videoRef.current;
    if (video && video.duration) video.currentTime = v * video.duration;
  }

  const firstClip = clips[0];

  return (
    <div className="flex h-full w-full flex-col bg-bg-primary">
      {/* Зона A — Верхняя панель */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-4"
        style={{ height: 52 }}
      >
        <button
          className="flex h-9 w-9 items-center justify-center rounded-el text-text-primary hover:bg-bg-tertiary"
          title="На главную"
          onClick={goHome}
        >
          ⌂
        </button>
        <span className="font-semibold text-accent-green" style={{ fontSize: 20 }}>
          Beatleap
        </span>
        <button
          className="btn-primary"
          style={{ width: 120, height: 36, borderRadius: 18, fontSize: 14 }}
          onClick={() => {
            /* ExportModal открывается на Шаге 10 */
          }}
        >
          Сохранить
        </button>
      </div>

      {/* Тело: зона B (60%) + зона C (40%) */}
      <div className="flex min-h-0 flex-1">
        {/* Зона B — Preview + Timeline */}
        <div className="flex min-h-0 flex-col" style={{ width: '60%' }}>
          <div className="min-h-0 flex-1 p-4">
            <VideoPreview
              videoRef={videoRef}
              format={format}
              firstClipSrc={firstClip?.sourceFile}
              firstClipStart={firstClip?.startTime}
            />
          </div>

          {/* Элементы управления */}
          <div className="flex shrink-0 items-center justify-center gap-6 py-3">
            <button
              className="flex items-center justify-center rounded-full bg-bg-tertiary text-text-primary"
              style={{ width: 40, height: 40 }}
              onClick={togglePlay}
              title="Play / Pause"
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              className="flex items-center justify-center rounded-full text-text-primary hover:bg-bg-tertiary"
              style={{ width: 36, height: 36 }}
              onClick={changeTrack}
              title="Сменить трек"
            >
              ♪
            </button>
            <button
              className="flex items-center justify-center rounded-full text-text-primary hover:bg-bg-tertiary"
              style={{ width: 36, height: 36 }}
              onClick={shuffleMontage}
              title="Перемешать монтаж"
            >
              ⤮
            </button>
          </div>

          {/* Timeline */}
          <div className="shrink-0 px-4 pb-4">
            <Timeline value={scrub} markers={markers} onChange={onScrub} />
          </div>
        </div>

        {/* Зона C — Правая панель */}
        <div className="flex min-h-0 flex-col bg-bg-secondary" style={{ width: '40%' }}>
          {/* Вкладки */}
          <div className="flex shrink-0 border-b border-border" style={{ height: 44 }}>
            {(['tools', 'edit', 'filters'] as Tab[]).map((tab) => {
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  className="flex-1 font-semibold uppercase"
                  style={{
                    fontSize: 13,
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderBottom: active ? '2px solid var(--accent-green)' : '2px solid transparent',
                  }}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Содержимое вкладки */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'tools' && <ToolsPanel />}
            {activeTab === 'edit' && <EditPanel />}
            {activeTab === 'filters' && <FiltersPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
