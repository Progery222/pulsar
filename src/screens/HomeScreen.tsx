import { useProjectStore } from '../store/projectStore';

// HomeScreen (§5.1 ТЗ).
export default function HomeScreen() {
  const setScreen = useProjectStore((s) => s.setCurrentScreen);
  const hasProject = useProjectStore((s) => s.mediaFiles.length > 0);
  const hasClips = useProjectStore((s) => s.generatedClips.length > 0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-bg-primary">
      <h1
        className="font-semibold text-accent-green"
        style={{ fontSize: 36, lineHeight: 1.1 }}
      >
        Pulsar
      </h1>
      <p className="mt-3 text-text-secondary" style={{ fontSize: 16 }}>
        Создавай видео в ритм музыки
      </p>

      <button
        className="btn-primary mt-10"
        style={{ width: 240, height: 56, borderRadius: 28, fontSize: 18 }}
        onClick={() => setScreen('media')}
      >
        Начать
      </button>

      {hasProject && (
        <button
          className="btn-secondary mt-4"
          style={{ width: 240, height: 48, borderRadius: 24, fontSize: 15 }}
          onClick={() => setScreen(hasClips ? 'editor' : 'media')}
        >
          Продолжить проект
        </button>
      )}
    </div>
  );
}
