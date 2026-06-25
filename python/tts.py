#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pulsar TTS worker — генерация речи из текста.

Движок подключаемый. Дефолт — edge (живые нейроголоса, онлайн, бесплатно).
Альтернативы: xtts (клонирование, оффлайн), silero (рус, лёгкий), gptsovits (через сервер).

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
    "xtts": "XTTS-v2 (многоязычный, клонирование) — pip install coqui-tts",
    "silero": "Silero (русский/английский, лёгкий) — pip install silero torch",
    "gptsovits": "GPT-SoVITS (топ рус-клонирование, через локальный сервер)",
}

# Голос Edge по умолчанию для языка.
EDGE_DEFAULT = {
    "ru": "ru-RU-SvetlanaNeural", "en": "en-US-AriaNeural", "es": "es-ES-ElviraNeural",
    "de": "de-DE-KatjaNeural", "fr": "fr-FR-DeniseNeural",
}


def synth_edge(text, out, lang, speaker_wav, speed, voice="", **kw):
    import asyncio
    import edge_tts
    v = voice or EDGE_DEFAULT.get(lang if lang != "auto" else "en", "en-US-AriaNeural")
    rate = f"{int(round((speed - 1) * 100)):+d}%"

    async def run():
        await edge_tts.Communicate(text, v, rate=rate).save(out)

    asyncio.run(run())
    return out


def synth_xtts(text, out, lang, speaker_wav, speed, voice="", **kw):
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


def synth_silero(text, out, lang, speaker_wav, speed, voice="", **kw):
    import torch
    lang_map = {"ru": ("ru", "v4_ru", "xenia"), "en": ("en", "v3_en", "en_0")}
    code, repo, speaker = lang_map.get(lang if lang in lang_map else "ru")
    model, _ = torch.hub.load("snakers4/silero-models", "silero_tts", language=code, speaker=repo)
    audio = model.apply_tts(text=text, speaker=speaker, sample_rate=48000)
    import soundfile as sf
    sf.write(out, audio.numpy(), 48000)
    return out


def synth_gptsovits(text, out, lang, speaker_wav, speed, voice="", prompt_text="", api_url="http://127.0.0.1:9880", **kw):
    # Обращаемся к локальному API GPT-SoVITS (api.py). Требуется запущенный сервер + референс-аудио.
    import urllib.request
    import urllib.parse
    code = lang if lang and lang != "auto" else "ru"
    if not speaker_wav:
        raise RuntimeError("GPT-SoVITS требует референс-аудио (образец голоса)")
    params = {
        "refer_wav_path": speaker_wav,
        "prompt_text": prompt_text,
        "prompt_language": code,
        "text": text,
        "text_language": code,
    }
    url = (api_url or "http://127.0.0.1:9880").rstrip("/") + "/?" + urllib.parse.urlencode(params)
    try:
        data = urllib.request.urlopen(url, timeout=600).read()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"Сервер GPT-SoVITS недоступен ({api_url}). Запустите его api.py. {e}")
    with open(out, "wb") as f:
        f.write(data)
    return out


SYNTH = {"edge": synth_edge, "xtts": synth_xtts, "silero": synth_silero, "gptsovits": synth_gptsovits}


def _engine_available(engine):
    import importlib.util as u
    mods = {"edge": "edge_tts", "xtts": "TTS", "silero": "torch"}
    if engine == "gptsovits":
        return True  # внешний сервер — наличие проверяется при запросе
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
    s.add_argument("--engine", default="edge")
    s.add_argument("--speaker-wav", default="")
    s.add_argument("--voice", default="")
    s.add_argument("--prompt-text", default="")
    s.add_argument("--api-url", default="")
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
            out = fn(
                text, args.out, args.lang, args.speaker_wav or "", args.speed, args.voice or "",
                prompt_text=args.prompt_text or "", api_url=args.api_url or "",
            )
            _out({"ok": True, "out": out})
        except ImportError as e:
            _out({"error": f"Не установлен движок '{args.engine}'. {ENGINES.get(args.engine, '')}. Детали: {e}"})
        except Exception as e:  # noqa: BLE001
            _out({"error": str(e)})
        return

    _out({"error": "Команда не указана (engines|synth)"})


if __name__ == "__main__":
    main()
