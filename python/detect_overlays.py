"""Детектор статичных оверлеев (водяные знаки, вшитые титры) во видео.
Метод: на динамичном видео статичный оверлей имеет низкую временную дисперсию,
окружённую высокой. Находим такие «острова» с краями -> bounding boxes.
Вывод: JSON в stdout. Координаты нормированы 0..1.
Зависимости: opencv-python(-headless), numpy.
"""
import sys
import json

try:
    import cv2
    import numpy as np
except Exception as e:  # noqa
    print(json.dumps({"error": f"deps: {e}"}))
    sys.exit(0)


def detect(path: str, samples: int = 40, proc_w: int = 480):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {"error": "cannot open video"}
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = total / fps if fps else 0
    if total <= 0 or W == 0:
        cap.release()
        return {"error": "empty video"}

    idxs = np.linspace(0, total - 1, min(samples, total)).astype(int)
    scale = proc_w / W
    ph = max(1, int(H * scale))
    frames = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, fr = cap.read()
        if not ok:
            continue
        g = cv2.cvtColor(cv2.resize(fr, (proc_w, ph)), cv2.COLOR_BGR2GRAY)
        frames.append(g.astype(np.float32))
    cap.release()
    if len(frames) < 5:
        return {"error": "not enough frames", "width": W, "height": H, "duration": duration}

    stack = np.stack(frames, axis=0)
    std_map = stack.std(axis=0)            # временная дисперсия
    median = np.median(stack, axis=0).astype(np.uint8)
    motion = float(std_map.mean())

    # Маска «статичных» зон: ниже порога дисперсии.
    static = (std_map < max(5.0, np.percentile(std_map, 25))).astype(np.uint8) * 255
    # Края на медианном кадре (структура оверлея).
    edges = cv2.Canny(median, 60, 160)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    cand = cv2.bitwise_and(static, edges)
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((9, 25), np.uint8))
    cand = cv2.dilate(cand, np.ones((5, 15), np.uint8), iterations=1)

    contours, _ = cv2.findContours(cand, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_total = proc_w * ph
    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        a = w * h
        if a < area_total * 0.002 or a > area_total * 0.35:
            continue
        if w < 12 or h < 8:
            continue
        # уверенность: насколько зона статична относительно общего движения
        roi = std_map[y:y + h, x:x + w]
        conf = float(max(0.0, min(1.0, (motion - roi.mean()) / (motion + 1e-3))))
        boxes.append({
            "x": round(x / proc_w, 4),
            "y": round(y / ph, 4),
            "w": round(w / proc_w, 4),
            "h": round(h / ph, 4),
            "kind": "static",
            "conf": round(conf, 3),
        })

    boxes.sort(key=lambda b: -b["conf"])
    return {
        "width": W,
        "height": H,
        "duration": round(duration, 3),
        "motion": round(motion, 2),
        "boxes": boxes[:12],
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: detect_overlays.py <video>"}))
        sys.exit(0)
    print(json.dumps(detect(sys.argv[1])))
