// Лёгкий диагностический HUD FPS/времени кадра для превью.
// Самодостаточен: сам рисует fixed-оверлей, не требует правок JSX.
// Переключение — Shift+F. Замеряет интервал между вызовами markFrame()
// (вызывается в начале каждой итерации цикла рендера превью).

let lastTs = 0;
let emaMs = 0; // экспоненциальное скользящее среднее времени кадра
let el: HTMLDivElement | null = null;
let visible = true;
let lastPaint = 0;
let keyBound = false;

function ensureEl(): void {
  if (el || typeof document === "undefined" || !document.body) return;
  el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,.72);" +
    "color:#c8ff00;font:11px/1.3 ui-monospace,Menlo,Consolas,monospace;" +
    "padding:3px 7px;border-radius:5px;pointer-events:none;white-space:pre;" +
    "letter-spacing:.2px";
  document.body.appendChild(el);
}

function bindKey(): void {
  if (keyBound || typeof window === "undefined") return;
  keyBound = true;
  window.addEventListener("keydown", (e) => {
    if (e.shiftKey && (e.code === "KeyF" || e.key === "F")) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      visible = !visible;
      if (el) el.style.display = visible ? "block" : "none";
    }
  });
}

export function markFrame(): void {
  bindKey();
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (lastTs > 0) {
    const dt = now - lastTs;
    if (dt > 0 && dt < 1000) emaMs = emaMs === 0 ? dt : emaMs * 0.85 + dt * 0.15;
  }
  lastTs = now;

  if (!visible) return;
  if (now - lastPaint < 250) return; // обновляем текст ~4 раза/сек
  lastPaint = now;
  ensureEl();
  if (el) {
    const fps = emaMs > 0 ? 1000 / emaMs : 0;
    el.textContent = `${fps.toFixed(0)} fps  ${emaMs.toFixed(1)} ms`;
    el.style.color = fps >= 50 ? "#c8ff00" : fps >= 25 ? "#ffd23f" : "#ff5c5c";
  }
}
