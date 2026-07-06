import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import type {
  Track,
  TextClip,
  ShapeClip,
  SVGClip,
  StickerClip,
} from "@openreel/core";
import { Blend } from "lucide-react";
import { ClipComponent } from "./ClipComponent";
import { TextClipComponent } from "./TextClipComponent";
import { ShapeClipComponent } from "./ShapeClipComponent";
import { KeyframeTrack } from "./KeyframeTrack";
import { calculateSnap } from "./utils";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;

interface TrackLaneProps {
  track: Track;
  allTracks: Track[];
  pixelsPerSecond: number;
  selectedClipIds: string[];
  textClips: TextClip[];
  shapeClips: GraphicClipUnion[];
  trackHeights: Map<string, number>;
  timelineRef: React.RefObject<HTMLDivElement>;
  onSelectClip: (clipId: string, addToSelection: boolean) => void;
  onDropMedia: (trackId: string, mediaId: string, startTime: number) => void;
  onMoveClip: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void;
  onMoveTextClip: (clipId: string, newStartTime: number) => void;
  onSnapIndicator: (time: number | null) => void;
  onTrimClip?: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  onTrimTextClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  onTrimShapeClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  scrollX: number;
  trackHeight: number;
  onResizeTrack: (trackId: string, newHeight: number) => void;
  onKeyframeSelect?: (keyframeId: string, addToSelection: boolean) => void;
  onKeyframeMove?: (keyframeId: string, newTime: number) => void;
  onKeyframeDelete?: (keyframeId: string) => void;
  selectedKeyframeIds?: string[];
}

export const TrackLane: React.FC<TrackLaneProps> = ({
  track,
  allTracks,
  pixelsPerSecond,
  selectedClipIds,
  textClips,
  shapeClips,
  trackHeights,
  timelineRef,
  onSelectClip,
  onDropMedia,
  onMoveClip,
  onMoveTextClip,
  onSnapIndicator,
  onTrimClip,
  onTrimTextClip,
  onTrimShapeClip,
  scrollX,
  trackHeight,
  onResizeTrack,
  onKeyframeSelect,
  onKeyframeMove,
  onKeyframeDelete,
  selectedKeyframeIds = [],
}) => {
  const { isTrackExpanded, playheadPosition } = useTimelineStore();
  const isExpanded = isTrackExpanded(track.id);
  const { snapSettings } = useUIStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const laneRef = useRef<HTMLDivElement>(null);
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);

  const clipsWithKeyframes = useMemo(() => {
    return track.clips.filter((clip) => clip.keyframes && clip.keyframes.length > 0);
  }, [track.clips]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      // External OS file drop (e.g. from Windows Explorer)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const rect = laneRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left + scrollX;
        const rawTime = Math.max(0, x / pixelsPerSecond);
        const snapResult = calculateSnap(
          rawTime,
          "",
          allTracks,
          playheadPosition,
          snapSettings,
          pixelsPerSecond,
        );
        const { importMedia, addClip } = useProjectStore.getState();
        for (const file of Array.from(e.dataTransfer.files)) {
          try {
            const beforeIds = new Set(
              useProjectStore.getState().project.mediaLibrary.items.map(i => i.id)
            );
            const result = await importMedia(file);
            if (result.success) {
              const newItem = useProjectStore
                .getState()
                .project.mediaLibrary.items.find(i => !beforeIds.has(i.id));
              if (newItem) {
                await addClip(track.id, newItem.id, snapResult.time);
                toast.success(`Added to ${track.name}`, file.name);
              }
            }
          } catch (err) {
            console.error("[TrackLane] External file drop failed:", err);
          }
        }
        return;
      }

      // Internal drag from assets panel
      try {
        const rawData = e.dataTransfer.getData("application/json");
        if (!rawData) return;

        const data = JSON.parse(rawData);
        if (
          !data ||
          typeof data !== "object" ||
          typeof data.mediaId !== "string" ||
          !data.mediaId.trim()
        ) {
          return;
        }

        const rect = laneRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + scrollX;
          const rawTime = Math.max(0, x / pixelsPerSecond);
          const snapResult = calculateSnap(
            rawTime,
            "",
            allTracks,
            playheadPosition,
            snapSettings,
            pixelsPerSecond,
          );
          onDropMedia(track.id, data.mediaId, snapResult.time);
        }
      } catch {
        // Silently ignore parse errors
      }
    },
    [track.id, track.name, pixelsPerSecond, scrollX, onDropMedia],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStartY.current = e.clientY;
      resizeStartHeight.current = trackHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [trackHeight],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizeStartY.current;
      const newHeight = resizeStartHeight.current + deltaY;
      onResizeTrack(track.id, newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, track.id, onResizeTrack]);

  return (
    <div className="relative">
      <div
        ref={laneRef}
        style={{ height: trackHeight }}
        className={`border-b border-border/50 relative transition-colors ${
          isDragOver
            ? "bg-primary/10 border-primary/30"
            : "bg-background-secondary/20"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {track.clips
          .filter((clip) => !textClips.some((tc) => tc.id === clip.id))
          .filter((clip) => !shapeClips.some((sc) => sc.id === clip.id))
          .map((clip) => (
            <ClipComponent
              key={clip.id}
              clip={clip}
              track={track}
              allTracks={allTracks}
              pixelsPerSecond={pixelsPerSecond}
              isSelected={selectedClipIds.includes(clip.id)}
              trackHeights={trackHeights}
              timelineRef={timelineRef}
              onSelect={onSelectClip}
              onMoveClip={onMoveClip}
              onSnapIndicator={onSnapIndicator}
              onTrimClip={onTrimClip}
            />
          ))}
        {(track.transitions ?? []).map((tr) => {
          const clipA = track.clips.find((c) => c.id === tr.clipAId);
          const clipB = track.clips.find((c) => c.id === tr.clipBId);
          if (!clipA) return null;
          const clipAEnd = clipA.startTime + clipA.duration;
          const isOverlap = clipB ? clipB.startTime < clipAEnd - 0.0001 : false;
          // Зона перехлёста [clipB.start, clipAEnd]; иначе центр на стыке.
          const tStart =
            isOverlap && clipB
              ? clipB.startTime
              : clipAEnd - (tr.duration ?? 0.5) / 2;
          const tEnd =
            isOverlap && clipB ? clipAEnd : tStart + (tr.duration ?? 0.5);
          const left = tStart * pixelsPerSecond;
          const w = Math.max((tEnd - tStart) * pixelsPerSecond, 16);
          return (
            <div
              key={tr.id}
              className="absolute top-0 bottom-0 z-30 pointer-events-none flex items-start justify-center"
              style={{ left, width: w }}
            >
              <div
                className="absolute top-1 bottom-1 left-0 right-0 rounded-sm border border-primary/70"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(200,255,0,0.30) 0 3px, transparent 3px 6px)",
                }}
              />
              {clipB && (
                <div
                  className="pointer-events-auto absolute top-1 bottom-1 left-0 w-2 cursor-ew-resize rounded-l-sm bg-primary/50 hover:bg-primary/80"
                  title="Тянуть — изменить длину кроссфейда"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const startX = e.clientX;
                    const origBStart = clipB.startTime;
                    const maxDur = Math.min(clipA.duration, clipB.duration);
                    const snapshot = track.clips
                      .filter((c) => c.startTime >= clipB.startTime - 0.0001)
                      .map((c) => ({ id: c.id, start: c.startTime }));
                    const move = (ev: MouseEvent) => {
                      const dt = (ev.clientX - startX) / pixelsPerSecond;
                      let newBStart = origBStart + dt;
                      newBStart = Math.min(
                        clipAEnd - 0.1,
                        Math.max(clipAEnd - maxDur, newBStart),
                      );
                      const shift = newBStart - origBStart;
                      useProjectStore.setState((state) => ({
                        project: {
                          ...state.project,
                          timeline: {
                            ...state.project.timeline,
                            tracks: state.project.timeline.tracks.map((t) =>
                              t.id === track.id
                                ? {
                                    ...t,
                                    clips: t.clips.map((c) => {
                                      const snap = snapshot.find(
                                        (s) => s.id === c.id,
                                      );
                                      return snap
                                        ? {
                                            ...c,
                                            startTime: Math.max(
                                              0,
                                              snap.start + shift,
                                            ),
                                          }
                                        : c;
                                    }),
                                  }
                                : t,
                            ),
                          },
                          modifiedAt: Date.now(),
                        },
                      }));
                    };
                    const up = () => {
                      window.removeEventListener("mousemove", move);
                      window.removeEventListener("mouseup", up);
                    };
                    window.addEventListener("mousemove", move);
                    window.addEventListener("mouseup", up);
                  }}
                />
              )}
              <button
                type="button"
                className="pointer-events-auto relative mt-0.5 flex items-center justify-center rounded bg-background/85 px-1 py-0.5 text-primary hover:text-red-400 shadow"
                title={`Переход: ${tr.type} • ${(tr.duration ?? 0).toFixed(1)} c — клик, чтобы удалить`}
                onClick={(e) => {
                  e.stopPropagation();
                  useProjectStore.getState().removeClipTransition(tr.id);
                  toast.info("Переход удалён");
                }}
              >
                <Blend size={11} />
              </button>
            </div>
          );
        })}
        {textClips.map((textClip) => (
          <TextClipComponent
            key={textClip.id}
            textClip={textClip}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(textClip.id)}
            onSelect={onSelectClip}
            onTrim={onTrimTextClip}
            onMoveClip={onMoveTextClip}
          />
        ))}
        {shapeClips.map((shapeClip) => (
          <ShapeClipComponent
            key={shapeClip.id}
            shapeClip={shapeClip}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(shapeClip.id)}
            onSelect={onSelectClip}
            onTrim={onTrimShapeClip}
            onMoveClip={onMoveClip}
          />
        ))}
        {isDragOver && (
          <div className="absolute inset-0 border-2 border-dashed border-primary/50 rounded pointer-events-none flex items-center justify-center">
            <span className="text-xs text-primary bg-background/80 px-2 py-1 rounded">
              Drop to add clip
            </span>
          </div>
        )}
      </div>
      <div
        className={`absolute bottom-0 left-0 right-0 h-1 cursor-row-resize hover:bg-primary/50 transition-colors z-10 ${
          isResizing ? "bg-primary" : ""
        }`}
        onMouseDown={handleResizeStart}
      />
      {isExpanded && clipsWithKeyframes.length > 0 && (
        <div className="absolute left-0 right-0" style={{ top: trackHeight }}>
          {clipsWithKeyframes.map((clip) => (
            <div
              key={`keyframes-${clip.id}`}
              className="relative"
              style={{ left: clip.startTime * pixelsPerSecond }}
            >
              <KeyframeTrack
                clip={clip}
                pixelsPerSecond={pixelsPerSecond}
                onKeyframeSelect={onKeyframeSelect ?? (() => {})}
                onKeyframeMove={onKeyframeMove ?? (() => {})}
                onKeyframeDelete={onKeyframeDelete ?? (() => {})}
                selectedKeyframeIds={selectedKeyframeIds}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
