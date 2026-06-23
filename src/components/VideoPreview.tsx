import { type RefObject } from 'react';
import { mediaUrl } from '../utils/media';

type Format = '9:16' | '1:1' | '16:9';

const RATIO: Record<Format, string> = {
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
};

// VideoPreview (§5.5): HTML5 <video>, соотношение сторон из format, фон #000000,
// первый кадр первого клипа как превью.
export default function VideoPreview({
  videoRef,
  format,
  firstClipSrc,
  firstClipStart,
}: {
  videoRef: RefObject<HTMLVideoElement>;
  format: Format;
  firstClipSrc?: string;
  firstClipStart?: number;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: '#000000' }}>
      <div className="relative h-full max-w-full" style={{ aspectRatio: RATIO[format] }}>
        {firstClipSrc ? (
          <video
            ref={videoRef}
            src={mediaUrl(firstClipSrc)}
            className="h-full w-full object-contain"
            style={{ background: '#000000' }}
            muted
            preload="metadata"
            onLoadedMetadata={(e) => {
              if (firstClipStart) e.currentTarget.currentTime = firstClipStart;
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-secondary">
            Нет клипов
          </div>
        )}
      </div>
    </div>
  );
}
