import React from "react";
import {
  Copy,
  Layers,
  Trash2,
  Scissors,
  Music,
  Sparkles,
  Volume2,
  Film,
  Image,
  ArrowLeftToLine,
  Blend,
} from "lucide-react";
import type { Clip, Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import { toast } from "../../../stores/notification-store";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuLabel,
} from "@openreel/ui";

interface ClipContextMenuProps {
  clip: Clip;
  track: Track;
  onClose?: () => void;
}

export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({
  clip,
  track,
  onClose,
}) => {
  const {
    copyClips,
    duplicateClip,
    removeClip,
    rippleDeleteClip,
    splitClip,
    separateAudio,
    getMediaItem,
    copyEffects,
    pasteEffects,
    copiedEffects,
    closeGapBeforeClip,
    addClipTransition,
  } = useProjectStore();
  const { playheadPosition } = useTimelineStore();

  const neighbors = React.useMemo(() => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const idx = sorted.findIndex((c) => c.id === clip.id);
    return {
      prev: idx > 0 ? sorted[idx - 1] : null,
      next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [track.clips, clip.id]);

  const applyCrossfade = (clipA: Clip, clipB: Clip) => {
    const bridge = getTransitionBridge();
    const settings = useProjectStore.getState().project.settings;
    bridge.initialize(settings.width, settings.height);
    const a = { ...clipA, trackId: track.id };
    const b = { ...clipB, trackId: track.id };
    const dur = Math.min(0.5, clipA.duration / 2, clipB.duration / 2);
    const result = bridge.createTransition(
      a,
      b,
      "crossfade",
      dur,
      bridge.getDefaultParams("crossfade"),
    );
    if (result.success && result.transitionId) {
      const t = bridge.getTransition(result.transitionId);
      if (t) {
        addClipTransition(t);
        toast.success("Кроссфейд добавлен", `${dur.toFixed(1)} c на стыке`);
        onClose?.();
        return;
      }
    }
    toast.error("Кроссфейд", result.error || "Не удалось добавить переход");
    onClose?.();
  };

  const isPlayheadOnClip =
    playheadPosition >= clip.startTime &&
    playheadPosition <= clip.startTime + clip.duration;

  const hasGapBeforeClip = React.useMemo(() => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const idx = sorted.findIndex((c) => c.id === clip.id);
    if (idx < 0) return false;
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const target = prev ? prev.startTime + prev.duration : 0;
    return clip.startTime - target > 0.0001;
  }, [track.clips, clip.id, clip.startTime]);

  const mediaItem = getMediaItem(clip.mediaId);
  const isVideo = track.type === "video";
  const isAudio = track.type === "audio";
  const isImage = track.type === "image";
  const isVideoWithAudio =
    isVideo &&
    mediaItem?.type === "video" &&
    mediaItem?.metadata?.channels &&
    mediaItem.metadata.channels > 0;

  const hasEffects = clip.effects && clip.effects.length > 0;
  const hasCopiedEffects = copiedEffects && copiedEffects.length > 0;

  const handleCopy = () => {
    copyClips([clip.id]);
    onClose?.();
  };

  const handleDuplicate = async () => {
    await duplicateClip(clip.id);
    onClose?.();
  };

  const handleDelete = async () => {
    await removeClip(clip.id);
    onClose?.();
  };

  const handleRippleDelete = async () => {
    await rippleDeleteClip(clip.id);
    onClose?.();
  };

  const handleSplit = async () => {
    if (isPlayheadOnClip) {
      await splitClip(clip.id, playheadPosition);
    }
    onClose?.();
  };

  const handleCloseGap = async () => {
    await closeGapBeforeClip(clip.id);
    onClose?.();
  };

  const handleSeparateAudio = async () => {
    await separateAudio(clip.id);
    onClose?.();
  };

  const handleCopyEffects = () => {
    copyEffects(clip.id);
    onClose?.();
  };

  const handlePasteEffects = async () => {
    await pasteEffects(clip.id);
    onClose?.();
  };

  const getClipTypeLabel = () => {
    if (isVideo) return "Video Clip";
    if (isAudio) return "Audio Clip";
    if (isImage) return "Image Clip";
    return "Clip";
  };

  const getClipTypeIcon = () => {
    if (isVideo) return <Film className="mr-2 h-3 w-3 text-primary" />;
    if (isAudio) return <Volume2 className="mr-2 h-3 w-3 text-blue-400" />;
    if (isImage) return <Image className="mr-2 h-3 w-3 text-purple-400" />;
    return null;
  };

  return (
    <ContextMenuContent className="min-w-[220px]">
      <ContextMenuLabel className="flex items-center text-[10px] text-text-muted">
        {getClipTypeIcon()}
        {getClipTypeLabel()}
      </ContextMenuLabel>
      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleCopy}>
        <Copy className="mr-2 h-4 w-4" />
        Copy Clip
        <ContextMenuShortcut>⌘C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDuplicate}>
        <Layers className="mr-2 h-4 w-4" />
        Duplicate
        <ContextMenuShortcut>⌘D</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleSplit} disabled={!isPlayheadOnClip}>
        <Scissors className="mr-2 h-4 w-4" />
        Split at Playhead
        <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleCloseGap} disabled={!hasGapBeforeClip}>
        <ArrowLeftToLine className="mr-2 h-4 w-4" />
        Close Gap to Previous
      </ContextMenuItem>

      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => neighbors.next && applyCrossfade(clip, neighbors.next)}
        disabled={!neighbors.next}
      >
        <Blend className="mr-2 h-4 w-4" />
        Кроссфейд со следующим
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => neighbors.prev && applyCrossfade(neighbors.prev, clip)}
        disabled={!neighbors.prev}
      >
        <Blend className="mr-2 h-4 w-4" />
        Кроссфейд с предыдущим
      </ContextMenuItem>

      {(isVideo || isImage) && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Sparkles className="mr-2 h-4 w-4" />
              Effects
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={handleCopyEffects} disabled={!hasEffects}>
                Copy Effects
              </ContextMenuItem>
              <ContextMenuItem onClick={handlePasteEffects} disabled={!hasCopiedEffects}>
                Paste Effects
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}

      {isVideoWithAudio && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleSeparateAudio}>
            <Music className="mr-2 h-4 w-4" />
            Separate Audio
          </ContextMenuItem>
        </>
      )}

      {isAudio && (
        <>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Volume2 className="mr-2 h-4 w-4" />
              Audio
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={handleCopyEffects} disabled={!hasEffects}>
                Copy Audio Effects
              </ContextMenuItem>
              <ContextMenuItem onClick={handlePasteEffects} disabled={!hasCopiedEffects}>
                Paste Audio Effects
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}

      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleRippleDelete} className="text-red-400">
        <Trash2 className="mr-2 h-4 w-4" />
        Ripple Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleDelete} className="text-red-400">
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
};
