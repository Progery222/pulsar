// Пружинное сглаживание камеры зума. Переписано с нуля (демпфированная пружина,
// полу-неявный Эйлер с субшагами) — без зависимости `motion`, идея из OpenScreen
// (MIT): motionSmoothing.ts / zoomSpring.ts.

export interface SpringState {
  value: number;
  velocity: number;
  initialized: boolean;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

export function createSpring(initial = 0): SpringState {
  return { value: initial, velocity: 0, initialized: false };
}

function clampDt(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 1000 / 60;
  return Math.min(80, Math.max(1, ms));
}

export function stepSpring(state: SpringState, target: number, deltaMs: number, cfg: SpringConfig): number {
  const dtMs = clampDt(deltaMs);
  if (!state.initialized || !Number.isFinite(state.value)) {
    state.value = target;
    state.velocity = 0;
    state.initialized = true;
    return state.value;
  }
  const dt = dtMs / 1000;
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const force = -cfg.stiffness * (state.value - target) - cfg.damping * state.velocity;
    const accel = force / cfg.mass;
    state.velocity += accel * h;
    state.value += state.velocity * h;
  }
  return state.value;
}

// Конфиг зум-пружины (из OpenScreen getZoomSpringConfig).
export const ZOOM_SPRING: SpringConfig = { stiffness: 320, damping: 40, mass: 0.92 };

export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomSpringState {
  scale: SpringState;
  x: SpringState;
  y: SpringState;
}

export function createZoomSpring(): ZoomSpringState {
  return { scale: createSpring(1), x: createSpring(0), y: createSpring(0) };
}

export function resetZoomSpring(s: ZoomSpringState, t: ZoomTransform): void {
  for (const [ax, v] of [
    [s.scale, t.scale],
    [s.x, t.x],
    [s.y, t.y],
  ] as const) {
    ax.value = v;
    ax.velocity = 0;
    ax.initialized = true;
  }
}

// Шаг одной оси с клампом «перелёта» цели (target движется каждый кадр).
function stepAxis(axis: SpringState, target: number, dtMs: number): number {
  const before = axis.initialized ? axis.value : target;
  const after = stepSpring(axis, target, dtMs, ZOOM_SPRING);
  const crossed = (before <= target && after > target) || (before >= target && after < target);
  if (crossed) {
    axis.value = target;
    axis.velocity = 0;
    return target;
  }
  return after;
}

export function stepZoomSpring(state: ZoomSpringState, target: ZoomTransform, deltaMs: number): ZoomTransform {
  return {
    scale: stepAxis(state.scale, target.scale, deltaMs),
    x: stepAxis(state.x, target.x, deltaMs),
    y: stepAxis(state.y, target.y, deltaMs),
  };
}
