import { useEffect } from 'react';
import { useProjectStore } from './store/projectStore';
import { useUIStore, type Tab } from './store/uiStore';
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
import Toast from './components/Toast';

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
      <Toast />
    </>
  );
}

export default App;
