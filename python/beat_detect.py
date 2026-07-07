# python/beat_detect.py
import sys
import json
import librosa
import numpy as np


def analyze_audio(audio_path):
    # sr=22050 (стандарт librosa для beat tracking): заметно быстрее загрузки на
    # нативной частоте и стабильнее по детекту, чем sr=None.
    # res_type=kaiser_fast — быстрый ресемплинг (для бит-детекта качества хватает).
    y, sr = librosa.load(audio_path, sr=22050, mono=True, res_type="kaiser_fast")
    duration = float(librosa.get_duration(y=y, sr=sr))

    # librosa>=0.10 возвращает tempo как np.ndarray — приводим к скаляру.
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0]) if tempo is not None else 0.0
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    onset_frames = librosa.onset.onset_detect(y=y, sr=sr)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr).tolist()

    # Гарантируем непустую бит-сетку: если beat_track не нашёл биты, строим
    # сетку из темпа, иначе опираемся на онсеты, иначе равномерно по 0.5 c.
    if not beat_times:
        if tempo and tempo > 0:
            step = 60.0 / tempo
            beat_times = [round(t, 3) for t in np.arange(0.0, duration, step).tolist()]
        elif onset_times:
            beat_times = onset_times
        else:
            beat_times = [round(t, 3) for t in np.arange(0.0, duration, 0.5).tolist()]

    return {
        "tempo": tempo,
        "beat_times": beat_times,
        "onset_times": onset_times,
        "duration": duration,
    }


def _serve():
    # Постоянный воркер: импорт librosa уже выполнен, разово прогреваем numba-JIT,
    # затем в цикле читаем построчно запросы {"id":..,"path":..} из stdin и
    # отвечаем строкой JSON в stdout. Убирает ~10с повторного импорта на каждый анализ.
    try:
        librosa.beat.beat_track(y=np.zeros(22050, dtype="float32"), sr=22050)
    except Exception:
        pass
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            res = analyze_audio(req["path"])
        except Exception as e:
            res = {"error": str(e)}
        res["id"] = rid
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        _serve()
    else:
        try:
            result = analyze_audio(sys.argv[1])
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
