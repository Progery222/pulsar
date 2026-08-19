import React, { useCallback, useMemo } from "react";
import { useProjectStore } from "../../../stores/project-store";
import type { VideoEffectType } from "../../../bridges/effects-bridge";
import { LabeledSlider } from "@openreel/ui";

// Резкость и зерно технически живут в общем списке видеоэффектов (вкладка Effects),
// но искать их идут в цветокор. Здесь они вынесены сюда — правки уходят в те же
// самые эффекты, поэтому обе вкладки всегда показывают одно и то же состояние.
//
// Ползунок на нуле = эффекта нет в клипе (а не «есть, но нулевой») — иначе список
// эффектов зарастал бы пустышками от каждого касания.

interface DetailSectionProps {
  clipId: string;
}

const RANGES: Record<string, { max: number; unit?: string }> = {
  sharpen: { max: 200, unit: "%" },
  grain: { max: 100 },
};

export const DetailSection: React.FC<DetailSectionProps> = ({ clipId }) => {
  const {
    getVideoEffects,
    addVideoEffect,
    updateVideoEffect,
    removeVideoEffect,
    toggleVideoEffect,
  } = useProjectStore();

  // Тот же приём, что в VideoEffectsSection: эффекты не в сторе напрямую,
  // поэтому перечитываем их по отметке времени изменения проекта.
  const modifiedAt = useProjectStore((state) => state.project.modifiedAt);
  const effects = useMemo(
    () => getVideoEffects(clipId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clipId, getVideoEffects, modifiedAt],
  );

  const find = useCallback(
    (type: VideoEffectType) => effects.find((e) => e.type === type),
    [effects],
  );

  const valueOf = useCallback(
    (type: VideoEffectType) => {
      const fx = find(type);
      if (!fx || !fx.enabled) return 0;
      return Number(fx.params.amount) || 0;
    },
    [find],
  );

  const setValue = useCallback(
    (type: VideoEffectType, v: number) => {
      const fx = find(type);
      if (v <= 0) {
        if (fx) removeVideoEffect(clipId, fx.id);
        return;
      }
      if (!fx) {
        addVideoEffect(clipId, type, { amount: v });
        return;
      }
      // Эффект мог быть выключен «глазом» на вкладке Effects — вернём его в работу.
      if (!fx.enabled) toggleVideoEffect(clipId, fx.id, true);
      updateVideoEffect(clipId, fx.id, { amount: v });
    },
    [clipId, find, addVideoEffect, updateVideoEffect, removeVideoEffect, toggleVideoEffect],
  );

  return (
    <div className="space-y-3">
      <LabeledSlider
        label="Sharpen"
        value={valueOf("sharpen")}
        onChange={(v: number) => setValue("sharpen", v)}
        min={0}
        max={RANGES.sharpen.max}
        unit={RANGES.sharpen.unit}
      />
      <LabeledSlider
        label="Grain"
        value={valueOf("grain")}
        onChange={(v: number) => setValue("grain", v)}
        min={0}
        max={RANGES.grain.max}
      />
      <p className="text-[11px] leading-snug text-muted-foreground">
        Radius and size are fine-tuned in Video Effects on the Effects tab — these are the same effects.
      </p>
    </div>
  );
};
