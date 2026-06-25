#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Загрузка ctranslate2-модели faster-whisper напрямую с зеркала HuggingFace.

Скачивает файлы модели в python/models/faster-whisper-<model>/ в обход
huggingface_hub/api (которые в части сетей отдают 429/блокируются). С бэкоффом.
Прогресс печатается построчно в stdout для отображения в мастере установки.

CLI: download_whisper.py [--model small]
"""
import argparse
import os
import sys
import time
import urllib.request

# Источники модели в порядке приоритета (в обход HuggingFace, который в части
# сетей блокируется/троттлится). ModelScope (Alibaba CDN) — основной.
SOURCES = [
    "https://modelscope.cn/api/v1/models/pengzhendong/faster-whisper-{m}/repo?Revision=master&FilePath={f}",
    "https://hf-mirror.com/Systran/faster-whisper-{m}/resolve/main/{f}",
]
FILES = ["config.json", "tokenizer.json", "vocabulary.txt", "model.bin"]


def _p(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def download_one(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        last = 0
        with open(dest + ".part", "wb") as out:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if total and done - last >= (5 << 20):
                    last = done
                    _p("PROGRESS %.0f/%.0f MB" % (done / 1048576, total / 1048576))
    os.replace(dest + ".part", dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small")
    args = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(script_dir, "models", "faster-whisper-" + args.model)
    os.makedirs(outdir, exist_ok=True)

    for f in FILES:
        dest = os.path.join(outdir, f)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            _p("Уже скачано: %s" % f)
            continue
        ok = False
        for attempt in range(12):
            # На каждой попытке перебираем источники по порядку.
            for src in SOURCES:
                url = src.format(m=args.model, f=f)
                try:
                    _p("Скачиваю %s…" % f)
                    download_one(url, dest)
                    _p("Готово: %s (%d КБ)" % (f, os.path.getsize(dest) // 1024))
                    ok = True
                    break
                except Exception as e:  # noqa: BLE001
                    _p("Источник недоступен (%s): %s" % (url.split('/')[2], str(e)[:80]))
            if ok:
                break
            wait = min(60, 10 * (attempt + 1))
            _p("Повтор %s через %dс…" % (f, wait))
            time.sleep(wait)
        if not ok:
            _p("ERROR: не удалось скачать %s" % f)
            sys.exit(1)

    _p("MODEL_READY")


if __name__ == "__main__":
    main()
