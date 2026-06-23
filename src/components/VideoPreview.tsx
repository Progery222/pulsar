import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { mediaUrl } from '../utils/media';

type Format = '9:16' | '1:1' | '16:9';

const RATIO_NUM: Record<Format, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '16:9': 16 / 9,
};

// VideoPreview: один <video> на каждый исходный файл (мгновенное переключение без
// чёрных кадров), точный best-fit размер под формат, слои вспышки и fade.
export default function VideoPreview({
  videosRef,
  sources,
  activeSource,
  flashRef,
  fadeRef,
  splitCanvasRef,
  format,
  hasClips,
}: {
  videosRef: MutableRefObject<Map<string, HTMLVideoElement>>;
  sources: string[];
  activeSource: string | null;
  flashRef: MutableRefObject<HTMLDivElement | null>;
  fadeRef: MutableRefObject<HTMLDivElement | null>;
  splitCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  format: Format;
  hasClips: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ratio = RATIO_NUM[format];

  // Best-fit прямоугольник заданного соотношения внутри контейнера.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      let w: number;
      let h: number;
      if (W / H > ratio) {
        h = H;
        w = H * ratio;
      } else {
        w = W;
        h = W / ratio;
      }
      setBox({ w, h });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center"
      style={{ background: 'var(--bg-primary)' }}
    >
      {hasClips ? (
        <div className="relative overflow-hidden" style={{ width: box.w, height: box.h }}>
          {sources.map((src) => (
            <video
              key={src}
              ref={(el) => {
                if (el) videosRef.current.set(src, el);
                else videosRef.current.delete(src);
              }}
              src={mediaUrl(src)}
              playsInline
              preload="auto"
              className="absolute inset-0 h-full w-full object-contain"
              style={{
                background: '#000000',
                opacity: src === activeSource ? 1 : 0,
                willChange: 'transform, filter',
              }}
            />
          ))}
          {/* Canvas для Split-эффекта (рисуется только во время эффекта) */}
          <canvas
            ref={splitCanvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ opacity: 0 }}
          />
          {/* Слой вспышки (Flash / Fast Cut) */}
          <div
            ref={flashRef}
            className="pointer-events-none absolute inset-0 bg-white"
            style={{ opacity: 0 }}
          />
          {/* Слой fade in/out */}
          <div
            ref={fadeRef}
            className="pointer-events-none absolute inset-0 bg-black"
            style={{ opacity: 0 }}
          />
        </div>
      ) : (
        <div className="text-text-secondary">Нет клипов</div>
      )}
    </div>
  );
}
