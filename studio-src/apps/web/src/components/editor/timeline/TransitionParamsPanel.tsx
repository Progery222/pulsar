import React from "react";
import { X, Trash2 } from "lucide-react";
import type { Transition } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

interface Props {
  transition: Transition;
  duration: number; // текущая длина перехода (по перехлёсту), сек
  maxDuration: number;
  onClose: () => void;
  onRemove: () => void;
  onSetLength: (dur: number) => void;
}

const CURVES: { v: string; label: string }[] = [
  { v: "linear", label: "Линейно" },
  { v: "ease", label: "Плавно" },
  { v: "ease-in", label: "Замедл. в начале" },
  { v: "ease-out", label: "Замедл. в конце" },
];

const DIRS: { v: string; label: string }[] = [
  { v: "left", label: "◀ Влево" },
  { v: "right", label: "▶ Вправо" },
  { v: "up", label: "▲ Вверх" },
  { v: "down", label: "▼ Вниз" },
];

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-center justify-between gap-2 py-1">
    <span className="text-[10px] text-text-secondary shrink-0">{label}</span>
    <div className="flex-1 flex justify-end">{children}</div>
  </div>
);

export const TransitionParamsPanel: React.FC<Props> = ({
  transition,
  duration,
  maxDuration,
  onClose,
  onRemove,
  onSetLength,
}) => {
  const p = transition.params || {};
  const upd = (params: Record<string, unknown>) =>
    useProjectStore.getState().updateClipTransition(transition.id, { params });

  const num = (key: string, def: number) =>
    typeof p[key] === "number" ? (p[key] as number) : def;

  const slider = (
    key: string,
    min: number,
    max: number,
    step: number,
    def: number,
  ) => (
    <div className="flex items-center gap-2 w-[130px]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={num(key, def)}
        onChange={(e) => upd({ [key]: parseFloat(e.target.value) })}
        className="flex-1 accent-primary"
      />
      <span className="text-[10px] text-text-primary w-8 text-right tabular-nums">
        {num(key, def).toFixed(step < 1 ? 1 : 0)}
      </span>
    </div>
  );

  const type = transition.type as string;

  return (
    <div
      className="relative w-[230px] rounded-lg border border-border bg-background-secondary shadow-xl p-2.5 text-text-primary pointer-events-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold">Параметры перехода</span>
        <button
          type="button"
          className="text-text-secondary hover:text-text-primary"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <Row label="Длина, c">
        <div className="flex items-center gap-2 w-[130px]">
          <input
            type="range"
            min={0.1}
            max={Math.max(0.2, maxDuration)}
            step={0.05}
            value={duration}
            onChange={(e) => onSetLength(parseFloat(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-[10px] w-8 text-right tabular-nums">
            {duration.toFixed(1)}
          </span>
        </div>
      </Row>

      <Row label="Плавность">
        <select
          value={(p.curve as string) || "ease"}
          onChange={(e) => upd({ curve: e.target.value })}
          className="bg-background-tertiary border border-border rounded px-1.5 py-1 text-[10px]"
        >
          {CURVES.map((c) => (
            <option key={c.v} value={c.v}>
              {c.label}
            </option>
          ))}
        </select>
      </Row>

      {(type === "impactBlur" || type === "impactZoomBlur") && (
        <Row label="Размытие">{slider("maxBlur", 0, 80, 1, 40)}</Row>
      )}
      {type === "impactZoomBlur" && (
        <Row label="Наезд">{slider("zoom", 1.1, 2, 0.05, 1.4)}</Row>
      )}
      {type === "impactShake" && (
        <Row label="Интенсивность">{slider("intensity", 0, 1, 0.05, 0.6)}</Row>
      )}
      {type === "zoom" && (
        <Row label="Масштаб">{slider("scale", 1.2, 3, 0.1, 2)}</Row>
      )}
      {(type === "dipToBlack" || type === "dipToWhite") && (
        <Row label="Удержание">{slider("holdDuration", 0, 1, 0.05, 0.1)}</Row>
      )}
      {(type === "impactSlide" ||
        type === "slide" ||
        type === "push" ||
        type === "wipe") && (
        <Row label="Направление">
          <select
            value={(p.direction as string) || "left"}
            onChange={(e) => upd({ direction: e.target.value })}
            className="bg-background-tertiary border border-border rounded px-1.5 py-1 text-[10px]"
          >
            {DIRS.map((d) => (
              <option key={d.v} value={d.v}>
                {d.label}
              </option>
            ))}
          </select>
        </Row>
      )}
      {type === "wipe" && (
        <Row label="Мягкость">{slider("softness", 0, 1, 0.05, 0)}</Row>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="mt-2 w-full flex items-center justify-center gap-1.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 py-1 text-[11px]"
      >
        <Trash2 size={12} />
        Удалить переход
      </button>
    </div>
  );
};
