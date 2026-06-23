import { type RefObject, type SyntheticEvent } from 'react';

type Format = '9:16' | '1:1' | '16:9';

const RATIO: Record<Format, string> = {
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
};

// VideoPreview (§5.5 + Блок 1/2): HTML5 <video> с реальным проигрыванием монтажа,
// CSS-фильтром (превью FILTERS) и текстовым оверлеем эффекта (превью EDIT).
// Источник/позиция управляются императивно из EditorScreen.
export default function VideoPreview({
  videoRef,
  format,
  filterCss,
  overlayLabel,
  hasClips,
  onTimeUpdate,
  onEnded,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  format: Format;
  filterCss: string;
  overlayLabel: string | null;
  hasClips: boolean;
  onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => void;
  onEnded: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: '#000000' }}>
      <div className="relative h-full max-w-full" style={{ aspectRatio: RATIO[format] }}>
        {hasClips ? (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              style={{ background: '#000000', filter: filterCss }}
              muted
              playsInline
              preload="auto"
              onTimeUpdate={onTimeUpdate}
              onEnded={onEnded}
            />
            {overlayLabel && (
              <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
                <span
                  className="rounded-card px-4 py-2 font-semibold uppercase"
                  style={{
                    fontSize: 18,
                    color: '#000',
                    backgroundColor: 'var(--accent-green)',
                  }}
                >
                  {overlayLabel}
                </span>
              </div>
            )}
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
