#!/usr/bin/env python3
# AI-апскейл изображений через ONNX super-resolution (ESPCN, sub-pixel CNN).
# Реальная суперрезолюция (не интерполяция) на CPU, офлайн после установки.
# Режимы:
#   python upscale.py check              -> {"ok": true} если зависимости на месте
#   python upscale.py run <in> <out>     -> апскейл x3, пишет JSON-прогресс, финал {"ok":true,"out":...}
import sys
import os
import json
import urllib.request

# ONNX Model Zoo, sub-pixel CNN 2016 — вход 1x1x224x224 (Y-канал), выход 1x1x672x672 (x3).
MODEL_URL = "https://media.githubusercontent.com/media/onnx/models/main/validated/vision/super_resolution/sub_pixel_cnn_2016/model/super-resolution-10.onnx"
TILE = 224
SCALE = 3


def out(**k):
    print(json.dumps(k), flush=True)


def model_path():
    # В собранном приложении папка скрипта только для чтения — берём писчую папку из env.
    d = os.environ.get("UPSCALE_MODEL_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "super-resolution-10.onnx")


def ensure_model():
    p = model_path()
    if not os.path.exists(p) or os.path.getsize(p) < 1000:
        out(stage="download", percent=3)
        urllib.request.urlretrieve(MODEL_URL, p)
    return p


def do_check():
    try:
        import onnxruntime  # noqa: F401
        import numpy  # noqa: F401
        from PIL import Image  # noqa: F401
        print(json.dumps({"ok": True}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}))


def do_run(inp, outp):
    import numpy as np
    from PIL import Image
    import onnxruntime as ort

    mp = ensure_model()
    sess = ort.InferenceSession(mp, providers=["CPUExecutionProvider"])
    iname = sess.get_inputs()[0].name

    img = Image.open(inp).convert("RGB")
    W, H = img.size
    ycbcr = img.convert("YCbCr")
    y, cb, cr = ycbcr.split()
    ya = np.asarray(y).astype(np.float32) / 255.0

    out_y = np.zeros((H * SCALE, W * SCALE), dtype=np.float32)
    tiles_x = (W + TILE - 1) // TILE
    tiles_y = (H + TILE - 1) // TILE
    total = tiles_x * tiles_y
    done = 0
    for by in range(0, H, TILE):
        for bx in range(0, W, TILE):
            vh = min(TILE, H - by)
            vw = min(TILE, W - bx)
            block = np.zeros((TILE, TILE), dtype=np.float32)
            block[:vh, :vw] = ya[by:by + vh, bx:bx + vw]
            # реплицируем края в паддинг, чтобы не было чёрных полос
            if vw < TILE:
                block[:vh, vw:TILE] = block[:vh, vw - 1:vw]
            if vh < TILE:
                block[vh:TILE, :] = block[vh - 1:vh, :]
            res = sess.run(None, {iname: block[None, None, :, :]})[0][0, 0]
            oh = vh * SCALE
            ow = vw * SCALE
            out_y[by * SCALE:by * SCALE + oh, bx * SCALE:bx * SCALE + ow] = res[:oh, :ow]
            done += 1
            out(stage="upscale", percent=int(5 + done / max(1, total) * 85))

    out_y = np.clip(out_y * 255.0, 0, 255).astype(np.uint8)
    y2 = Image.fromarray(out_y, mode="L")
    cb2 = cb.resize((W * SCALE, H * SCALE), Image.BICUBIC)
    cr2 = cr.resize((W * SCALE, H * SCALE), Image.BICUBIC)
    result = Image.merge("YCbCr", [y2, cb2, cr2]).convert("RGB")
    result.save(outp)
    print(json.dumps({"ok": True, "out": outp, "scale": SCALE}))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "no mode"}))
        return
    mode = sys.argv[1]
    try:
        if mode == "check":
            do_check()
        elif mode == "run":
            do_run(sys.argv[2], sys.argv[3])
        else:
            print(json.dumps({"ok": False, "error": "unknown mode"}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
