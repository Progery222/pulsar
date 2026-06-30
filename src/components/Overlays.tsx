import { useUIStore } from '../store/uiStore';
import Toast from './Toast';
import QueuePanel from './QueuePanel';
import HistoryPanel from './HistoryPanel';
import FirstRunSetup from './FirstRunSetup';
import UpdateBanner from './UpdateBanner';

// Глобальные оверлеи поверх любого экрана: тосты + плавающие мини-окна + мастер настройки.
export default function Overlays() {
  const showQueue = useUIStore((s) => s.showQueue);
  const showHistory = useUIStore((s) => s.showHistory);
  const showSetup = useUIStore((s) => s.showSetup);
  return (
    <>
      {showHistory && <HistoryPanel />}
      {showQueue && <QueuePanel />}
      {showSetup && <FirstRunSetup />}
      <UpdateBanner />
      <Toast />
    </>
  );
}
