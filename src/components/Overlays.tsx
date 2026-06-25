import { useUIStore } from '../store/uiStore';
import Toast from './Toast';
import QueuePanel from './QueuePanel';
import HistoryPanel from './HistoryPanel';

// Глобальные оверлеи поверх любого экрана: тосты + плавающие мини-окна.
export default function Overlays() {
  const showQueue = useUIStore((s) => s.showQueue);
  const showHistory = useUIStore((s) => s.showHistory);
  return (
    <>
      {showHistory && <HistoryPanel />}
      {showQueue && <QueuePanel />}
      <Toast />
    </>
  );
}
