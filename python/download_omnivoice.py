#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Загрузка весов OmniVoice (k2-fsa/OmniVoice, ~2.5 ГБ) в python/models/omnivoice/.

Перебирает зеркала HuggingFace (hf-mirror.com → huggingface.co) с бэкоффом:
в части сетей huggingface.co блокируется/троттлится. Докачка поддерживается
самим huggingface_hub. Прогресс печатается построчно (stdout/stderr) для
отображения в мастере установки.

CLI: download_omnivoice.py
"""
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

REPO = "k2-fsa/OmniVoice"
ENDPOINTS = ["https://hf-mirror.com", "https://huggingface.co"]
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "models", "omnivoice")


def _p(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def _ready():
    return os.path.exists(os.path.join(OUT_DIR, "model.safetensors")) and os.path.exists(
        os.path.join(OUT_DIR, "config.json")
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    if _ready():
        _p("Модель OmniVoice уже скачана.")
        _p("MODEL_READY")
        return

    # Прогресс-бары tqdm нужны: из них мастер берёт проценты.
    os.environ.pop("HF_HUB_DISABLE_PROGRESS_BARS", None)
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        _p("ERROR: не установлен huggingface_hub (pip install huggingface_hub)")
        sys.exit(1)

    for attempt in range(8):
        for ep in ENDPOINTS:
            host = ep.split("//", 1)[1]
            try:
                _p("Скачиваю модель OmniVoice (~2.5 ГБ) с %s…" % host)
                try:
                    snapshot_download(repo_id=REPO, local_dir=OUT_DIR, endpoint=ep, max_workers=4)
                except TypeError:
                    # Старый huggingface_hub без параметра endpoint — через переменную окружения.
                    os.environ["HF_ENDPOINT"] = ep
                    snapshot_download(repo_id=REPO, local_dir=OUT_DIR, max_workers=4)
                if _ready():
                    _p("Готово: модель OmniVoice сохранена в %s" % OUT_DIR)
                    _p("MODEL_READY")
                    return
                _p("Загрузка завершилась, но файлы модели не найдены — повтор.")
            except Exception as e:  # noqa: BLE001
                _p("Источник недоступен (%s): %s" % (host, str(e)[:120]))
        wait = min(60, 10 * (attempt + 1))
        _p("Повтор через %dс…" % wait)
        time.sleep(wait)

    _p("ERROR: не удалось скачать модель OmniVoice")
    sys.exit(1)


if __name__ == "__main__":
    main()
