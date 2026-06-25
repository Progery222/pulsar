#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pulsar — офлайн-распознавание речи через faster-whisper (без интернета к ASR-облаку).

Используется как альтернатива AssemblyAI (например, когда облако недоступно из сети).
Модель скачивается один раз с HuggingFace (или зеркала через переменную HF_ENDPOINT).

CLI:
    whisper_asr.py <audio_or_video> [--language auto|ru|en|…] [--model small]

Вывод — JSON в stdout:
    {"ok": true, "language": "en", "words": [{"text": "...", "start": <ms>, "end": <ms>}, …]}
либо {"error": "..."}.
"""
import argparse
import json
import os
import sys


def _out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--model", default="small")
    args = ap.parse_args()
    try:
        from faster_whisper import WhisperModel

        # Если рядом со скриптом лежит локальная папка модели — используем её
        # (без обращения к HuggingFace; нужно при блокировках/троттлинге сети).
        script_dir = os.path.dirname(os.path.abspath(__file__))
        local_dir = os.path.join(script_dir, "models", "faster-whisper-" + args.model)
        model_ref = args.model
        if os.path.isdir(local_dir) and os.path.exists(os.path.join(local_dir, "model.bin")):
            model_ref = local_dir

        # CPU + int8: работает без видеокарты, модель компактная.
        model = WhisperModel(model_ref, device="cpu", compute_type="int8")
        lang = None if args.language in ("auto", "", None) else args.language
        segments, info = model.transcribe(args.audio, language=lang, word_timestamps=True)

        words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    t = (w.word or "").strip()
                    if t:
                        words.append({"text": t, "start": int(w.start * 1000), "end": int(w.end * 1000)})
            else:
                t = (seg.text or "").strip()
                if t:
                    words.append({"text": t, "start": int(seg.start * 1000), "end": int(seg.end * 1000)})

        _out({"ok": True, "language": getattr(info, "language", "unknown"), "words": words})
    except ImportError as e:
        _out({"error": f"Не установлен faster-whisper (pip install faster-whisper). {e}"})
    except Exception as e:  # noqa: BLE001
        _out({"error": str(e)})


if __name__ == "__main__":
    main()
