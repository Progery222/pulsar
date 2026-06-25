import { useEffect, useState } from 'react';
import { useProjectStore } from './store/projectStore';
import { useUIStore, type Tab } from './store/uiStore';
import { useQueueStore, type JobStatus } from './store/queueStore';
import { initHistory, undo } from './utils/history';
import { shuffleMontage, regenerateMontage } from './utils/regenerate';
import { fileName, isVideoFile } from './utils/media';
import { showToast } from './store/toastStore';
import type { MediaFile } from './types';
import HomeScreen from './screens/HomeScreen';
import MediaPickerScreen from './screens/MediaPickerScreen';
import MusicPickerScreen from './screens/MusicPickerScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import EditorScreen from './screens/EditorScreen';
import ModeSelector from './screens/ModeSelector';
import VubApp from './vub/VubApp';
import CleanerApp from './cleaner/CleanerApp';
import TtsApp from './tts/TtsApp';
import DubApp from './dub/DubApp';
import SettingsScreen from './screens/SettingsScreen';
import TopBar from './components/TopBar';
import Overlays from './components/Overlays';
import IntroOverlay, { introAlreadyPlayed } from './components/IntroOverlay';

// Ctrl+O: добавление медиафайлов через диалог.
async function addMediaViaDialog() {
  const paths = await window.electronAPI.selectVideos();
  const valid = paths.filter(isVideoFile);
  if (paths.length > valid.length) {
    showToast('Формат файла не поддерживается. Используйте MP4, MOV, AVI для видео и MP3, WAV для аудио.');
  }
  if (valid.length === 0) return;
  const s = useProjectStore.getState();
  const existing = new Set(s.mediaFiles.map((f) => f.id));
  const added = valid
    .filter((p) => !existing.has(p))
    .map<MediaFile>((p) => ({ id: p, path: p, name: fileName(p), duration: 0 }));
  s.setMediaFiles([...s.mediaFiles, ...added]);
  if (s.currentScreen === 'editor') regenerateMontage();
}

function App() {
  const currentScreen = useProjectStore((state) => state.currentScreen);
  const appMode = useUIStore((state) => state.appMode);
  const [showIntro, setShowIntro] = useState(!introAlreadyPlayed());

  // Горячие клавиши (§13).
  useEffect(() => {
    initHistory();
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const screen = useProjectStore.getState().currentScreen;
      const ui = useUIStore.getState();
      const key = e.key.toLowerCase();

      if (e.ctrlKey && key === 's') {
        e.preventDefault();
        if (screen === 'editor') ui.setShowExport(true);
        return;
      }
      if (e.ctrlKey && key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey && key === 'n') {
        e.preventDefault();
        if (window.confirm('Начать новый проект? Текущий прогресс будет потерян.')) {
          useProjectStore.getState().setCurrentScreen('home');
        }
        return;
      }
      if (e.ctrlKey && key === 'o') {
        e.preventDefault();
        if (screen === 'editor' || screen === 'media') addMediaViaDialog();
        return;
      }
      if (e.ctrlKey && key === 'r') {
        e.preventDefault();
        if (screen === 'editor') shuffleMontage();
        return;
      }
      if (!typing && e.code === 'Space') {
        e.preventDefault();
        ui.playToggle?.();
        return;
      }
      if (!typing && (e.key === '1' || e.key === '2' || e.key === '3')) {
        const map: Record<string, Tab> = { '1': 'tools', '2': 'edit', '3': 'filters' };
        ui.setActiveTab(map[e.key]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Первый запуск: показать мастер установки движков.
  useEffect(() => {
    window.electronAPI.getSetting('firstRunDone').then((done) => {
      if (!done) useUIStore.getState().setShowSetup(true);
    });
  }, []);

  // Глобальные слушатели прогресса для очереди (живут поверх всех режимов —
  // прогресс не теряется при переключении вкладок/режимов).
  useEffect(() => {
    const update = useQueueStore.getState().updateJob;
    const offVub = window.electronAPI.onVubProgress((p) =>
      update(p.id, { status: p.status, percent: p.percent, error: p.error })
    );
    const offCleaner = window.electronAPI.onCleanerProgress((p) =>
      update(p.id, { status: p.status as JobStatus, percent: p.percent })
    );
    return () => {
      offVub();
      offCleaner();
    };
  }, []);

  // Стартовый экран выбора режима (§3 ТЗ VUB).
  if (appMode === 'select') {
    return (
      <>
        {/* Меню рендерится сразу — интро лежит поверх и плавно открывает уже готовый экран
            (без чёрного разрыва между концом интро и монтированием меню). */}
        <div className="screen-fade">
          <ModeSelector />
        </div>
        {showIntro && <IntroOverlay onDone={() => setShowIntro(false)} />}
        <Overlays />
      </>
    );
  }

  // Модуль Уникализатор (§4 ТЗ VUB).
  if (appMode === 'vub') {
    return (
      <>
        <div className="screen-fade">
          <VubApp />
        </div>
        <TopBar />
        <Overlays />
      </>
    );
  }

  // Модуль «Замена титров» (детект чужих титров/вотермарков + перекрытие).
  if (appMode === 'cleaner') {
    return (
      <>
        <div className="screen-fade">
          <CleanerApp />
        </div>
        <TopBar />
        <Overlays />
      </>
    );
  }

  // Озвучка (TTS).
  if (appMode === 'tts') {
    return (
      <>
        <div className="screen-fade">
          <TtsApp />
        </div>
        <TopBar />
        <Overlays />
      </>
    );
  }

  // Дубляж.
  if (appMode === 'dub') {
    return (
      <>
        <div className="screen-fade">
          <DubApp />
        </div>
        <TopBar />
        <Overlays />
      </>
    );
  }

  // Настройки приложения.
  if (appMode === 'settings') {
    return (
      <>
        <div className="screen-fade">
          <SettingsScreen />
        </div>
        <TopBar />
        <Overlays />
      </>
    );
  }

  let screen;
  switch (currentScreen) {
    case 'home':
      screen = <HomeScreen />;
      break;
    case 'media':
      screen = <MediaPickerScreen />;
      break;
    case 'music':
      screen = <MusicPickerScreen />;
      break;
    case 'processing':
      screen = <ProcessingScreen />;
      break;
    case 'editor':
      screen = <EditorScreen />;
      break;
    default:
      screen = <HomeScreen />;
  }

  return (
    <>
      <div key={currentScreen} className="screen-fade">
        {screen}
      </div>
      <TopBar />
      <Overlays />
    </>
  );
}

export default App;
