import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { mediaUrl } from '../utils/media';
import { useProjectStore } from '../store/projectStore';

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
  const title = useProjectStore((s) => s.title);

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
              onError={(e) => {
                const v = e.currentTarget;
                console.error('[VideoPreview] не загрузилось видео', src, 'код:', v.error?.code, v.error?.message);
              }}
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
          {/* Живое превью заголовка (как в рендере) */}
          {title.text.trim() && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: 0,
                right: 0,
                textAlign: 'center',
                padding: '0 6%',
                ...(title.position === 'top'
                  ? { top: '10%' }
                  : title.position === 'center'
                    ? { top: '50%', transform: 'translateY(-50%)' }
                    : { top: '80%' }),
              }}
            >
              <span
                style={{
                  fontFamily: 'Montserrat, system-ui, sans-serif',
                  fontWeight: 800,
                  fontSize: (title.size / 1080) * box.h,
                  lineHeight: 1.1,
                  color: title.color,
                  ...(title.box
                    ? { background: 'rgba(0,0,0,0.4)', padding: `${(title.size / 1080) * box.h * 0.18}px ${(title.size / 1080) * box.h * 0.35}px`, borderRadius: 6, boxDecorationBreak: 'clone' as const, WebkitBoxDecorationBreak: 'clone' as const }
                    : { textShadow: '0 2px 8px rgba(0,0,0,0.6)' }),
                }}
              >
                {title.text}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-text-secondary">Нет клипов</div>
      )}
    </div>
  );
}
