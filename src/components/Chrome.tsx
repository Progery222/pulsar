import type { ReactNode } from 'react';
import TopBar from './TopBar';

// Единая оболочка «программ»: верхняя шапка (TopBar) во всю ширину + область
// контента под ней. Контент занимает всю оставшуюся высоту, шапка не накрывает.
export default function Chrome({ children, frameKey }: { children: ReactNode; frameKey?: string | number }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <div key={frameKey} className="screen-fade" style={{ flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
