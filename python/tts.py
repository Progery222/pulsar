#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pulsar TTS worker — генерация речи из текста (движок Edge TTS).

Edge TTS: естественные нейроголоса Microsoft, онлайн, бесплатно, без ключа.

CLI:
    tts.py engines
    tts.py check
    tts.py synth --text-file <txt> --out <mp3> --lang ru --voice ru-RU-SvetlanaNeural [--speed 1.0]

Вывод — JSON в stdout: {"ok": true, "out": "..."} либо {"error": "..."}.
"""
import argparse
import json
import sys


def _out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


ENGINES = {
    "edge": "Edge TTS (онлайн, бесплатно, без ключа, естественные нейроголоса) — pip install edge-tts",
}

EDGE_DEFAULT = {
    "ru": "ru-RU-SvetlanaNeural", "en": "en-US-AriaNeural", "es": "es-ES-ElviraNeural",
    "de": "de-DE-KatjaNeural", "fr": "fr-FR-DeniseNeural", "it": "it-IT-ElsaNeural",
    "pt": "pt-BR-FranciscaNeural", "pl": "pl-PL-ZofiaNeural", "uk": "uk-UA-PolinaNeural",
    "tr": "tr-TR-EmelNeural", "ja": "ja-JP-NanamiNeural", "ko": "ko-KR-SunHiNeural",
    "zh": "zh-CN-XiaoxiaoNeural", "ar": "ar-SA-ZariyahNeural", "hi": "hi-IN-SwaraNeural",
}


def synth_edge(text, out, lang, speed, voice=""):
    import asyncio
    import edge_tts
    v = voice or EDGE_DEFAULT.get(lang if lang != "auto" else "en", "en-US-AriaNeural")
    rate = f"{int(round((speed - 1) * 100)):+d}%"

    async def run():
        await edge_tts.Communicate(text, v, rate=rate).save(out)

    asyncio.run(run())
    return out


def _engine_available(engine):
    import importlib.util as u
    import os
    mod = {"edge": "edge_tts", "translate": "deep_translator", "download": "yt_dlp",
           "whisper": "faster_whisper"}.get(engine)
    if mod is None or u.find_spec(mod) is None:
        return False
    # Whisper считается готовым только когда скачана и модель (иначе распознавание не работает).
    if engine == "whisper":
        model = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "models", "faster-whisper-small", "model.bin")
        return os.path.exists(model)
    return True


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("engines")
    sub.add_parser("check")
    s = sub.add_parser("synth")
    s.add_argument("--text-file", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--lang", default="auto")
    s.add_argument("--engine", default="edge")
    s.add_argument("--voice", default="")
    s.add_argument("--speed", type=float, default=1.0)
    args = ap.parse_args()

    if args.cmd == "engines":
        _out({"ok": True, "engines": ENGINES})
        return

    if args.cmd == "check":
        _out({"ok": True, "python": sys.version.split()[0],
              "engines": {k: _engine_available(k) for k in ("edge", "translate", "download", "whisper")}})
        return

    if args.cmd == "synth":
        try:
            with open(args.text_file, "r", encoding="utf-8") as f:
                text = f.read().strip()
            if not text:
                _out({"error": "Пустой текст"})
                return
            out = synth_edge(text, args.out, args.lang, args.speed, args.voice or "")
            _out({"ok": True, "out": out})
        except ImportError as e:
            _out({"error": f"Не установлен edge-tts (pip install edge-tts). Детали: {e}"})
        except Exception as e:  # noqa: BLE001
            _out({"error": str(e)})
        return

    _out({"error": "Команда не указана (engines|synth)"})


if __name__ == "__main__":
    main()
