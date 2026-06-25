"""Детектор оверлеев во видео для режима «Замена титров».
- Титры/текст: модель EAST (cv2.dnn) — находит текст на кадрах независимо от движения.
- Водяные знаки/статика: временная дисперсия кадров (для динамичных видео).
Аргументы: <video> [do_titles 0/1] [do_watermarks 0/1] [east_model_path]
Вывод: JSON в stdout, координаты нормированы 0..1.
"""
import sys
import json
import math

try:
    import cv2
    import numpy as np
except Exception as e:  # noqa
    print(json.dumps({"error": f"deps: {e}"}))
    sys.exit(0)


def sample_frames(cap, total, n):
    idxs = np.linspace(0, total - 1, min(n, total)).astype(int)
    out = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, fr = cap.read()
        if ok:
            out.append(fr)
    return out


# ---- EAST: детекция текста ----
def east_decode(scores, geometry, thr):
    dets, confs = [], []
    h, w = scores.shape[2], scores.shape[3]
    for y in range(h):
        s = scores[0][0][y]
        d0, d1, d2, d3 = geometry[0][0][y], geometry[0][1][y], geometry[0][2][y], geometry[0][3][y]
        ang = geometry[0][4][y]
        for x in range(w):
            sc = s[x]
            if sc < thr:
                continue
            ox, oy = x * 4.0, y * 4.0
            a = ang[x]
            cos, sin = math.cos(a), math.sin(a)
            bh = d0[x] + d2[x]
            bw = d1[x] + d3[x]
            ex = ox + cos * d1[x] + sin * d2[x]
            ey = oy - sin * d1[x] + cos * d2[x]
            cx, cy = ex - 0.5 * bw, ey - 0.5 * bh  # центр бокса
            dets.append(((cx, cy), (bw, bh), -a * 180.0 / math.pi))
            confs.append(float(sc))
    return dets, confs


def east_boxes(frame, net, det_w, thr=0.5):
    H, W = frame.shape[:2]
    nw = max(32, (int(det_w) // 32) * 32)
    nh = max(32, int(round(H * nw / W / 32)) * 32)
    blob = cv2.dnn.blobFromImage(frame, 1.0, (nw, nh), (123.68, 116.78, 103.94), True, False)
    net.setInput(blob)
    scores, geometry = net.forward(["feature_fusion/Conv_7/Sigmoid", "feature_fusion/concat_3"])
    dets, confs = east_decode(scores, geometry, thr)
    if not dets:
        return []
    idxs = cv2.dnn.NMSBoxesRotated(dets, confs, thr, 0.4)
    rW, rH = W / float(nw), H / float(nh)
    boxes = []
    for i in np.array(idxs).flatten():
        box = cv2.boxPoints(dets[int(i)])
        xs = [p[0] * rW for p in box]
        ys = [p[1] * rH for p in box]
        x0, x1 = max(0, min(xs)), min(W, max(xs))
        y0, y1 = max(0, min(ys)), min(H, max(ys))
        if x1 - x0 > 6 and y1 - y0 > 6:
            boxes.append([x0, y0, x1, y1, confs[int(i)]])
    return boxes


def iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


# Слияние боксов в строки (титр горизонтальный): объединяем по вертикальному
# перекрытию + малому горизонтальному зазору. conf = доля кадров, где зона есть.
def merge_lines(boxes, W, frame_count):
    items = [[b[0], b[1], b[2], b[3], {b[4]}] for b in boxes]  # x0,y0,x1,y1,{frame_ids}
    changed = True
    while changed:
        changed = False
        out = []
        for it in items:
            merged = False
            for o in out:
                vo = min(it[3], o[3]) - max(it[1], o[1])
                minh = max(1.0, min(it[3] - it[1], o[3] - o[1]))
                gap = max(it[0], o[0]) - min(it[2], o[2])
                if vo > 0.4 * minh and gap < 0.28 * W:
                    o[0] = min(o[0], it[0]); o[1] = min(o[1], it[1])
                    o[2] = max(o[2], it[2]); o[3] = max(o[3], it[3])
                    o[4] |= it[4]
                    merged = True
                    changed = True
                    break
            if not merged:
                out.append(it)
        items = out
    return [(it[0], it[1], it[2], it[3], len(it[4]) / max(1, frame_count)) for it in items]


def detect_watermarks(frames, proc_w=480):
    H, W = frames[0].shape[:2]
    scale = proc_w / W
    ph = max(1, int(H * scale))
    g = [cv2.cvtColor(cv2.resize(f, (proc_w, ph)), cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]
    stack = np.stack(g, 0)
    std_map = stack.std(0)
    motion = float(std_map.mean())
    if motion < 4.0:  # слишком статично — метод не работает, пропускаем
        return [], motion
    median = np.median(stack, 0).astype(np.uint8)
    static = (std_map < max(5.0, np.percentile(std_map, 25))).astype(np.uint8) * 255
    edges = cv2.dilate(cv2.Canny(median, 60, 160), np.ones((3, 3), np.uint8))
    cand = cv2.bitwise_and(static, edges)
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((9, 25), np.uint8))
    cand = cv2.dilate(cand, np.ones((5, 15), np.uint8))
    cnts, _ = cv2.findContours(cand, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = proc_w * ph
    res = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w * h < area * 0.002 or w * h > area * 0.35 or w < 12 or h < 8:
            continue
        roi = std_map[y:y + h, x:x + w]
        conf = float(max(0.0, min(1.0, (motion - roi.mean()) / (motion + 1e-3))))
        res.append([x / proc_w, y / ph, (x + w) / proc_w, (y + h) / ph, conf])
    return res, motion


# Временная дисперсия региона по кадрам: высокая = меняющийся текст (субтитр),
# низкая = статичный текст (надпись на одежде, логотип).
def region_std(frames, x0, y0, x1, y1):
    x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), int(x1), int(y1)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return 0.0
    crops = []
    for f in frames:
        c = f[y0:y1, x0:x1]
        if c.size == 0:
            continue
        crops.append(cv2.cvtColor(cv2.resize(c, (48, 24)), cv2.COLOR_BGR2GRAY).astype(np.float32))
    if len(crops) < 3:
        return 0.0
    return float(np.stack(crops, 0).std(0).mean())


def detect(path, do_titles, do_watermarks, model, dynamic_only=False):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {"error": "cannot open video"}
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    if total <= 0 or W == 0:
        cap.release()
        return {"error": "empty video"}
    frames = sample_frames(cap, total, 16)
    cap.release()
    if len(frames) < 3:
        return {"error": "not enough frames"}

    boxes = []
    motion = 0.0

    if do_titles and model:
        try:
            net = cv2.dnn.readNet(model)
            native = max(320, min(960, (W // 32) * 32))
            scales = sorted(set([320, native]))  # мелкий масштаб ловит крупный текст
            all_t = []
            for fi, f in enumerate(frames):
                for dw in scales:
                    for bx in east_boxes(f, net, dw, thr=0.4):
                        all_t.append([bx[0], bx[1], bx[2], bx[3], fi])
            for (x0, y0, x1, y1, frac) in merge_lines(all_t, W, len(frames)):
                bw, bh = x1 - x0, y1 - y0
                # Отбрасываем мелочь-шум.
                if bw < W * 0.05 or bh < H * 0.012:
                    continue
                # Только меняющийся текст (субтитры): выкидываем статичные надписи/лого.
                if dynamic_only and region_std(frames, x0, y0, x1, y1) < 12.0:
                    continue
                pw, ph = bw * 0.06, bh * 0.25
                nx = max(0.0, x0 - pw)
                ny = max(0.0, y0 - ph)
                boxes.append({
                    "x": round(float(nx) / W, 4),
                    "y": round(float(ny) / H, 4),
                    "w": round(float(min(W, x1 + pw) - nx) / W, 4),
                    "h": round(float(min(H, y1 + ph) - ny) / H, 4),
                    "kind": "text",
                    "conf": round(float(min(1.0, 0.4 + frac)), 3),
                })
        except Exception as e:  # noqa
            return {"error": f"east: {e}", "width": W, "height": H}

    if do_watermarks:
        wm, motion = detect_watermarks(frames)
        for (x0, y0, x1, y1, conf) in wm:
            boxes.append({"x": round(x0, 4), "y": round(y0, 4), "w": round(x1 - x0, 4), "h": round(y1 - y0, 4), "kind": "static", "conf": round(conf, 3)})

    boxes.sort(key=lambda b: -b["conf"])
    return {"width": W, "height": H, "duration": round(total / fps, 3), "motion": round(motion, 2), "boxes": boxes[:20]}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: detect_overlays.py <video> [titles] [wm] [model]"}))
        sys.exit(0)
    v = sys.argv[1]
    t = sys.argv[2] != "0" if len(sys.argv) > 2 else True
    w = sys.argv[3] != "0" if len(sys.argv) > 3 else True
    m = sys.argv[4] if len(sys.argv) > 4 else ""
    dyn = sys.argv[5] != "0" if len(sys.argv) > 5 else False
    print(json.dumps(detect(v, t, w, m, dyn)))
