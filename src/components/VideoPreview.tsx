import { type RefObject } from 'react';

type Format = '9:16' | '1:1' | '16:9';

const RATIO: Record<Format, string> = {
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
};

// VideoPreview (§5.5 + Блок 2): реальное проигрывание монтажа. Фильтры и эффекты
// применяются императивно к самому <video> (filter/transform) из EditorScreen,
// вспышка (Flash/Fast Cut) — через белый оверлей flashRef.
export default function VideoPreview({
  videoRef,
  flashRef,
  format,
  hasClips,
  onEnded,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  flashRef: RefObject<HTMLDivElement>;
  format: Format;
  hasClips: boolean;
  onEnded: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: '#000000' }}>
      <div
        className="relative h-full max-w-full overflow-hidden"
        style={{ aspectRatio: RATIO[format] }}
      >
        {hasClips ? (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              style={{ background: '#000000', willChange: 'transform, filter' }}
              playsInline
              preload="auto"
              onEnded={onEnded}
            />
            <div
              ref={flashRef}
              className="pointer-events-none absolute inset-0 bg-white"
              style={{ opacity: 0 }}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-secondary">
            Нет клипов
          </div>
        )}
      </div>
    </div>
  );
}
