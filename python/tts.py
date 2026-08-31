#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pulsar TTS worker — генерация речи из текста.

Движки:
    omnivoice — OmniVoice (k2-fsa), офлайн: клонирование голоса по референсу 3–10 с,
                voice design по описанию («female, low pitch»), 646 языков.
                Нужен PyTorch; на NVIDIA GPU — секунды, на CPU — медленно.
    edge      — Edge TTS: нейроголоса Microsoft, онлайн, бесплатно, без ключа.

CLI:
    tts.py engines
    tts.py check
    tts.py synth --text-file <txt> --out <wav|mp3> --lang ru [--engine omnivoice|edge]
                 [--voice <edge-voice | design:<описание> | clone:<путь к аудио>>] [--speed 1.0]
                 [--ref-audio <wav>] [--ref-text-file <txt>]
    tts.py synth --jobs-file <json> ...   # пакет [{"text": "...", "out": "..."}] одной загрузкой модели

Вывод — JSON последней строкой stdout: {"ok": true, "out": "..."} либо {"error": "..."}.
Прогресс пакета — в stderr: PROGRESS i/n.
"""
import argparse
import json
import os
import re
import sys

# Windows: stdout в кодировке консоли (cp1251) бьёт кириллицу — форсируем UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

_REAL_STDOUT = sys.stdout


def _out(obj):
    _REAL_STDOUT.write("\n" + json.dumps(obj, ensure_ascii=False) + "\n")
    _REAL_STDOUT.flush()


def _progress(i, n):
    sys.stderr.write(f"PROGRESS {i}/{n}\n")
    sys.stderr.flush()


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
OMNI_DIR = os.path.join(MODELS_DIR, "omnivoice")
OMNI_REPO = "k2-fsa/OmniVoice"
OMNI_SR = 24000

ENGINES = {
    "omnivoice": "OmniVoice (офлайн, клонирование голоса, 646 языков) — pip install omnivoice",
    "edge": "Edge TTS (онлайн, бесплатно, без ключа, естественные нейроголоса) — pip install edge-tts",
}

EDGE_DEFAULT = {
    "ru": "ru-RU-SvetlanaNeural", "en": "en-US-AriaNeural", "es": "es-ES-ElviraNeural",
    "de": "de-DE-KatjaNeural", "fr": "fr-FR-DeniseNeural", "it": "it-IT-ElsaNeural",
    "pt": "pt-BR-FranciscaNeural", "pl": "pl-PL-ZofiaNeural", "uk": "uk-UA-PolinaNeural",
    "tr": "tr-TR-EmelNeural", "ja": "ja-JP-NanamiNeural", "ko": "ko-KR-SunHiNeural",
    "zh": "zh-CN-XiaoxiaoNeural", "ar": "ar-SA-ZariyahNeural", "hi": "hi-IN-SwaraNeural",
}


# ── Edge TTS ─────────────────────────────────────────────────────────────────

def synth_edge(text, out, lang, speed, voice=""):
    import asyncio
    import edge_tts
    v = voice or EDGE_DEFAULT.get(lang if lang != "auto" else "en", "en-US-AriaNeural")
    rate = f"{int(round((speed - 1) * 100)):+d}%"

    async def run():
        await edge_tts.Communicate(text, v, rate=rate).save(out)

    asyncio.run(run())
    return out


# ── OmniVoice ────────────────────────────────────────────────────────────────

def _omni_model_ready():
    return os.path.exists(os.path.join(OMNI_DIR, "model.safetensors"))


def _split_text(text, max_chars=350):
    """Режем длинный текст по предложениям (модель лучше держит ≤ ~350 символов за проход)."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_chars:
        return [text]
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    chunks, cur = [], ""
    for s in sentences:
        # Слишком длинное предложение — дробим по запятым/пробелам.
        parts = [s]
        if len(s) > max_chars:
            parts, buf = [], ""
            for w in re.split(r"(?<=[,;:])\s+|\s+", s):
                cand = f"{buf} {w}".strip()
                if buf and len(cand) > max_chars:
                    parts.append(buf)
                    buf = w
                else:
                    buf = cand
            if buf:
                parts.append(buf)
        for p in parts:
            cand = f"{cur} {p}".strip()
            if cur and len(cand) > max_chars:
                chunks.append(cur)
                cur = p
            else:
                cur = cand
    if cur:
        chunks.append(cur)
    return chunks or [text]


def _transcribe_local(path):
    """Текст референса через локальный faster-whisper (если установлен) — чтобы OmniVoice
    не тянул свой whisper-large-v3-turbo (1.5 ГБ) ради одной фразы."""
    try:
        from faster_whisper import WhisperModel
        local = os.path.join(MODELS_DIR, "faster-whisper-small")
        ref = local if os.path.exists(os.path.join(local, "model.bin")) else "small"
        model = WhisperModel(ref, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(path)
        text = " ".join((s.text or "").strip() for s in segments).strip()
        return text or None
    except Exception:  # noqa: BLE001
        return None


class OmniSynth:
    """Одна загрузка модели на процесс; голос фиксируется на весь пакет."""

    def __init__(self, ref_audio=None, ref_text=None, instruct=None):
        import torch
        from omnivoice import OmniVoice

        cuda = bool(torch.cuda.is_available())
        self.device = "cuda:0" if cuda else "cpu"
        self.num_step = 32 if cuda else 16  # на CPU меньше шагов — в 2 раза быстрее
        need_asr = bool(ref_audio) and not ref_text
        if need_asr:
            ref_text = _transcribe_local(ref_audio)
            need_asr = not ref_text
        kw = {"device_map": self.device, "dtype": torch.float16 if cuda else torch.float32}
        if need_asr:
            kw["load_asr"] = True
            kw["asr_device"] = self.device
        model_ref = OMNI_DIR if _omni_model_ready() else OMNI_REPO
        self.model = OmniVoice.from_pretrained(model_ref, **kw)
        self.instruct = instruct or None
        self.prompt = None
        if ref_audio:
            self.prompt = self.model.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text or None)

    def _generate(self, text, lang, speed):
        kw = {"text": text, "num_step": self.num_step}
        if speed and abs(speed - 1.0) > 0.01:
            kw["speed"] = float(speed)
        if self.prompt is not None:
            kw["voice_clone_prompt"] = self.prompt
        elif self.instruct:
            kw["instruct"] = self.instruct
        if lang and lang != "auto":
            try:
                return self.model.generate(language=lang, **kw)[0]
            except Exception:  # noqa: BLE001 — код языка не распознан, пусть определит сама
                pass
        return self.model.generate(**kw)[0]

    def _pin_voice(self, audio, text):
        """Первая порция становится референсом для остальных — голос не «плывёт» между фразами."""
        import soundfile as sf
        import tempfile
        fd, tmp = tempfile.mkstemp(prefix="pulsar_omni_ref_", suffix=".wav")
        os.close(fd)
        sf.write(tmp, audio, OMNI_SR)
        try:
            self.prompt = self.model.create_voice_clone_prompt(ref_audio=tmp, ref_text=text)
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass

    def synth(self, text, out, lang, speed):
        import numpy as np
        import soundfile as sf

        pieces = []
        gap = np.zeros(int(OMNI_SR * 0.25), dtype=np.float32)
        for chunk in _split_text(text):
            audio = np.asarray(self._generate(chunk, lang, speed), dtype=np.float32).reshape(-1)
            if self.prompt is None:
                self._pin_voice(audio, chunk)
            if pieces:
                pieces.append(gap)
            pieces.append(audio)
        wave = np.concatenate(pieces) if pieces else gap
        try:
            sf.write(out, wave, OMNI_SR)
        except Exception:  # noqa: BLE001 — формат по расширению не поддержан (напр. mp3): пишем WAV
            sf.write(out, wave, OMNI_SR, format="WAV")
        return out


# ── Проверка окружения ───────────────────────────────────────────────────────

def _engine_available(engine):
    import importlib.util as u
    mod = {"edge": "edge_tts", "translate": "deep_translator", "download": "yt_dlp",
           "whisper": "faster_whisper", "omnivoice": "omnivoice"}.get(engine)
    if mod is None or u.find_spec(mod) is None:
        return False
    # Whisper/OmniVoice считаются готовыми только когда скачана и модель.
    if engine == "whisper":
        return os.path.exists(os.path.join(MODELS_DIR, "faster-whisper-small", "model.bin"))
    if engine == "omnivoice":
        return _omni_model_ready()
    return True


def _cuda_available():
    import importlib.util as u
    if u.find_spec("torch") is None:
        return None
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return None


# ── CLI ──────────────────────────────────────────────────────────────────────

def _parse_voice(voice):
    """voice → (edge_voice, ref_audio, instruct). Для OmniVoice: 'clone:<путь>' | 'design:<описание>'."""
    if voice.startswith("clone:"):
        return "", voice[6:], None
    if voice.startswith("design:"):
        return "", None, voice[7:].strip() or None
    return voice, None, None


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("engines")
    sub.add_parser("check")
    s = sub.add_parser("synth")
    s.add_argument("--text-file")
    s.add_argument("--out")
    s.add_argument("--jobs-file")
    s.add_argument("--lang", default="auto")
    s.add_argument("--engine", default="omnivoice")
    s.add_argument("--voice", default="")
    s.add_argument("--speed", type=float, default=1.0)
    s.add_argument("--ref-audio", default="")
    s.add_argument("--ref-text-file", default="")
    args = ap.parse_args()

    if args.cmd == "engines":
        _out({"ok": True, "engines": ENGINES})
        return

    if args.cmd == "check":
        _out({"ok": True, "python": sys.version.split()[0],
              "engines": {k: _engine_available(k) for k in ("omnivoice", "edge", "translate", "download", "whisper")},
              "cuda": _cuda_available()})
        return

    if args.cmd == "synth":
        # Библиотеки любят печатать в stdout — уводим его в stderr, JSON пишем в настоящий stdout.
        sys.stdout = sys.stderr
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
        try:
            if args.jobs_file:
                with open(args.jobs_file, "r", encoding="utf-8") as f:
                    jobs = json.load(f)
            elif args.text_file and args.out:
                with open(args.text_file, "r", encoding="utf-8") as f:
                    jobs = [{"text": f.read(), "out": args.out}]
            else:
                _out({"error": "Нужны --text-file и --out либо --jobs-file"})
                return
            jobs = [j for j in jobs if (j.get("text") or "").strip()]
            if not jobs:
                _out({"error": "Пустой текст"})
                return

            edge_voice, ref_audio, instruct = _parse_voice(args.voice or "")
            if args.ref_audio:
                ref_audio = args.ref_audio
            ref_text = ""
            if args.ref_text_file:
                with open(args.ref_text_file, "r", encoding="utf-8") as f:
                    ref_text = f.read().strip()

            n = len(jobs)
            if args.engine == "edge":
                for i, j in enumerate(jobs):
                    _progress(i, n)
                    synth_edge(j["text"].strip(), j["out"], args.lang, args.speed, edge_voice)
            elif args.engine == "omnivoice":
                synth = OmniSynth(ref_audio=ref_audio, ref_text=ref_text, instruct=instruct)
                for i, j in enumerate(jobs):
                    _progress(i, n)
                    synth.synth(j["text"].strip(), j["out"], args.lang, args.speed)
            else:
                _out({"error": f"Неизвестный движок: {args.engine}"})
                return
            _progress(n, n)
            _out({"ok": True, "out": jobs[-1]["out"], "count": n})
        except ImportError as e:
            pkg = "edge-tts" if args.engine == "edge" else "omnivoice (PyTorch + модель)"
            _out({"error": f"Не установлен {pkg}. Установите в «Настройки → Компоненты». Детали: {e}"})
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "out of memory" in msg.lower():
                msg = "Не хватило видеопамяти (CUDA OOM). Закройте другие GPU-программы или выберите Edge TTS. " + msg
            _out({"error": msg})
        return

    _out({"error": "Команда не указана (engines|check|synth)"})


if __name__ == "__main__":
    main()
