# python/beat_detect.py
import sys
import json
import librosa
import numpy as np


def analyze_audio(audio_path):
    # sr=22050 (стандарт librosa для beat tracking): заметно быстрее загрузки на
    # нативной частоте и стабильнее по детекту, чем sr=None.
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
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


if __name__ == "__main__":
    try:
        result = analyze_audio(sys.argv[1])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
