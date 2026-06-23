import { useProjectStore } from './store/projectStore';
import HomeScreen from './screens/HomeScreen';
import MediaPickerScreen from './screens/MediaPickerScreen';
import MusicPickerScreen from './screens/MusicPickerScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import EditorScreen from './screens/EditorScreen';

// Роутинг между 5 экранами через Zustand (поле currentScreen), без React Router.
function App() {
  const currentScreen = useProjectStore((state) => state.currentScreen);

  switch (currentScreen) {
    case 'home':
      return <HomeScreen />;
    case 'media':
      return <MediaPickerScreen />;
    case 'music':
      return <MusicPickerScreen />;
    case 'processing':
      return <ProcessingScreen />;
    case 'editor':
      return <EditorScreen />;
    default:
      return <HomeScreen />;
  }
}

export default App;
