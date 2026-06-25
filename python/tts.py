#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pulsar TTS worker — генерация речи из текста.

Движок подключаемый. Дефолт — XTTS-v2 (многоязычный, вкл. русский, клонирование голоса).
Альтернативы: silero (рус, лёгкий), kokoro (англ, быстрый).

CLI:
    tts.py engines
    tts.py check
    tts.py synth --text-file <txt> --out <wav> --lang ru --engine xtts \
                 [--speaker-wav <ref.wav>] [--speed 1.0]

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
    "gtts": "Google TTS (онлайн, бесплатно, без ключа) — pip install gTTS",
    "xtts": "XTTS-v2 (многоязычный, клонирование) — pip install coqui-tts",
    "silero": "Silero (русский/английский, лёгкий) — pip install silero torch",
    "kokoro": "Kokoro (английский, быстрый) — pip install kokoro",
}

# Голос Edge по умолчанию для языка.
EDGE_DEFAULT = {
    "ru": "ru-RU-SvetlanaNeural", "en": "en-US-AriaNeural", "es": "es-ES-ElviraNeural",
    "de": "de-DE-KatjaNeural", "fr": "fr-FR-DeniseNeural",
}


def synth_edge(text, out, lang, speaker_wav, speed, voice=""):
    import asyncio
    import edge_tts
    v = voice or EDGE_DEFAULT.get(lang if lang != "auto" else "en", "en-US-AriaNeural")
    rate = f"{int(round((speed - 1) * 100)):+d}%"

    async def run():
        await edge_tts.Communicate(text, v, rate=rate).save(out)

    asyncio.run(run())
    return out


def synth_gtts(text, out, lang, speaker_wav, speed, voice=""):
    from gtts import gTTS  # online, free, без ключа
    code = lang if lang and lang != "auto" else "en"
    gTTS(text=text, lang=code).save(out)  # mp3
    return out


def synth_xtts(text, out, lang, speaker_wav, speed, voice=""):
    from TTS.api import TTS  # coqui-tts
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    kwargs = dict(text=text, file_path=out, language=(lang if lang != "auto" else "en"), speed=speed)
    # XTTS требует референс голоса; если не задан — берём встроенный сэмпл студии.
    if speaker_wav:
        kwargs["speaker_wav"] = speaker_wav
    else:
        kwargs["speaker"] = "Ana Florence"
    model.tts_to_file(**kwargs)
    return out


def synth_silero(text, out, lang, speaker_wav, speed, voice=""):
    import torch
    lang_map = {"ru": ("ru", "v4_ru", "xenia"), "en": ("en", "v3_en", "en_0")}
    code, repo, speaker = lang_map.get(lang if lang in lang_map else "ru")
    model, _ = torch.hub.load("snakers4/silero-models", "silero_tts", language=code, speaker=repo)
    audio = model.apply_tts(text=text, speaker=speaker, sample_rate=48000)
    import soundfile as sf
    sf.write(out, audio.numpy(), 48000)
    return out


def synth_kokoro(text, out, lang, speaker_wav, speed, voice=""):
    from kokoro import KPipeline
    import soundfile as sf
    import numpy as np
    pipe = KPipeline(lang_code="a")
    chunks = [audio for _, _, audio in pipe(text, voice="af_heart", speed=speed)]
    sf.write(out, np.concatenate(chunks), 24000)
    return out


SYNTH = {"edge": synth_edge, "gtts": synth_gtts, "xtts": synth_xtts, "silero": synth_silero, "kokoro": synth_kokoro}


def _engine_available(engine):
    import importlib.util as u
    mods = {"edge": "edge_tts", "gtts": "gtts", "xtts": "TTS", "silero": "torch", "kokoro": "kokoro"}
    name = mods.get(engine)
    return bool(name and u.find_spec(name) is not None)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("engines")
    sub.add_parser("check")
    s = sub.add_parser("synth")
    s.add_argument("--text-file", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--lang", default="auto")
    s.add_argument("--engine", default="xtts")
    s.add_argument("--speaker-wav", default="")
    s.add_argument("--voice", default="")
    s.add_argument("--speed", type=float, default=1.0)
    args = ap.parse_args()

    if args.cmd == "engines":
        _out({"ok": True, "engines": ENGINES})
        return

    if args.cmd == "check":
        _out({
            "ok": True,
            "python": sys.version.split()[0],
            "engines": {k: _engine_available(k) for k in ENGINES},
        })
        return

    if args.cmd == "synth":
        fn = SYNTH.get(args.engine)
        if not fn:
            _out({"error": f"Неизвестный движок: {args.engine}"})
            return
        try:
            with open(args.text_file, "r", encoding="utf-8") as f:
                text = f.read().strip()
            if not text:
                _out({"error": "Пустой текст"})
                return
            out = fn(text, args.out, args.lang, args.speaker_wav or "", args.speed, args.voice or "")
            _out({"ok": True, "out": out})
        except ImportError as e:
            _out({"error": f"Не установлен движок '{args.engine}'. {ENGINES.get(args.engine, '')}. Детали: {e}"})
        except Exception as e:  # noqa: BLE001
            _out({"error": str(e)})
        return

    _out({"error": "Команда не указана (engines|synth)"})


if __name__ == "__main__":
    main()
