#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pulsar Funnel — мультимодальный анализ видео через Gemini Flash API.

Модель одновременно считывает видеоряд, аудиодорожку и текст на экране и
классифицирует ролик по одной из пяти веток обработки модуля «Воронка».

CLI:
    gemini_analyzer.py <video> --api-key <KEY> [--model gemini-2.5-flash]

Вывод — JSON в stdout:
    {"ok": true, "branch": 1-5, "has_voice": bool, "has_subtitles": bool,
     "has_text_overlay": bool, "language": "ru/en/...", "text_content": "...",
     "confidence": 0.0-1.0}
либо {"error": "..."}.

Ветки:
    1 — нет субтитров, нет голоса (только уникализация);
    2 — есть субтитры + есть голос;
    3 — нет субтитров + есть голос;
    4 — есть текстовая плашка + нет голоса;
    5 — есть текстовая плашка + есть голос.
"""
import argparse
import json
import sys
import time

# Модель Gemini Flash по умолчанию (мультимодальный режим: видео+аудио+текст).
DEFAULT_MODEL = "gemini-2.5-flash"

PROMPT = """Ты — классификатор коротких вертикальных видео для конвейера обработки.
Проанализируй видео мультимодально: видеоряд, аудиодорожку и текст на экране.

Определи три признака:
1. has_voice — есть ли в аудио человеческая речь (voice). Музыка/тишина без речи = false.
2. has_subtitles — есть ли «выжженные» субтитры: динамически меняющийся текст,
   синхронизированный с речью (обычно внизу кадра, идёт фразами).
3. has_text_overlay — есть ли статические/полустатические текстовые плашки,
   заголовки или CTA, которые НЕ являются субтитрами.

На основе признаков выбери ветку (branch):
- branch 1: has_subtitles=false и has_voice=false (нет текста-субтитров, нет голоса).
- branch 2: has_subtitles=true и has_voice=true.
- branch 3: has_subtitles=false, has_voice=true, has_text_overlay=false.
- branch 4: has_text_overlay=true и has_voice=false.
- branch 5: has_text_overlay=true и has_voice=true.
Если одновременно есть и субтитры, и плашка — приоритет плашки определяет ветки 4/5
только при наличии явной статической плашки; иначе используй ветки 2/3.

Также верни:
- language — основной язык речи или текста (ISO-639-1: ru/en/es/fr/pt/tr/…), либо "unknown".
- text_content — распознанный текст плашки (если есть), иначе пустая строка.
- confidence — уверенность классификации от 0.0 до 1.0.

Ответь СТРОГО одним JSON-объектом без markdown, по схеме:
{"branch": <1-5>, "has_voice": <bool>, "has_subtitles": <bool>,
 "has_text_overlay": <bool>, "language": "<code>", "text_content": "<str>",
 "confidence": <float>}"""


def _out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def _derive_branch(d):
    """Подстраховка: вычислить ветку из признаков, если модель её не вернула/ошиблась."""
    voice = bool(d.get("has_voice"))
    subs = bool(d.get("has_subtitles"))
    plate = bool(d.get("has_text_overlay"))
    if plate and voice:
        return 5
    if plate and not voice:
        return 4
    if subs and voice:
        return 2
    if not subs and voice:
        return 3
    return 1


def analyze(video, api_key, model_name):
    import google.generativeai as genai

    genai.configure(api_key=api_key)

    # Загрузка видеофайла в Gemini Files API и ожидание активации.
    uploaded = genai.upload_file(path=video)
    deadline = time.time() + 180
    while getattr(uploaded.state, "name", "") == "PROCESSING":
        if time.time() > deadline:
            raise RuntimeError("Превышено время обработки видео на стороне Gemini")
        time.sleep(2)
        uploaded = genai.get_file(uploaded.name)
    if getattr(uploaded.state, "name", "") == "FAILED":
        raise RuntimeError("Gemini не смог обработать видеофайл")

    model = genai.GenerativeModel(model_name)
    resp = model.generate_content(
        [uploaded, PROMPT],
        generation_config={"response_mime_type": "application/json", "temperature": 0.1},
    )
    try:
        genai.delete_file(uploaded.name)
    except Exception:  # noqa: BLE001
        pass

    raw = (resp.text or "").strip()
    # На случай, если модель обернула JSON в ```json … ```.
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{"): raw.rfind("}") + 1]
    data = json.loads(raw)

    branch = data.get("branch")
    if branch not in (1, 2, 3, 4, 5):
        branch = _derive_branch(data)
    return {
        "ok": True,
        "branch": int(branch),
        "has_voice": bool(data.get("has_voice", False)),
        "has_subtitles": bool(data.get("has_subtitles", False)),
        "has_text_overlay": bool(data.get("has_text_overlay", False)),
        "language": str(data.get("language", "unknown") or "unknown"),
        "text_content": str(data.get("text_content", "") or ""),
        "confidence": float(data.get("confidence", 0.0) or 0.0),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--api-key", required=True)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()
    try:
        _out(analyze(args.video, args.api_key, args.model))
    except ImportError as e:
        _out({"error": f"Не установлен google-generativeai (pip install google-generativeai). {e}"})
    except Exception as e:  # noqa: BLE001
        _out({"error": str(e)})


if __name__ == "__main__":
    main()
