#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Пакетный перевод текста (deep-translator / Google, бесплатно, без ключа).

CLI: translate.py --in <json-массив строк> --src auto --tgt ru
Вывод JSON: {"ok": true, "texts": [...]} либо {"error": "..."}.
"""
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--src", default="auto")
    ap.add_argument("--tgt", required=True)
    args = ap.parse_args()
    try:
        with open(args.infile, "r", encoding="utf-8") as f:
            texts = json.load(f)
        from deep_translator import GoogleTranslator
        tr = GoogleTranslator(source=args.src or "auto", target=args.tgt)
        out = []
        for t in texts:
            t = (t or "").strip()
            out.append(tr.translate(t) if t else "")
        sys.stdout.write(json.dumps({"ok": True, "texts": out}, ensure_ascii=False))
    except ImportError as e:
        sys.stdout.write(json.dumps({"error": f"Не установлен deep-translator (pip install deep-translator). {e}"}, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        sys.stdout.write(json.dumps({"error": str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
