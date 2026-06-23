# python/beat_detect.py
import sys
import json
import librosa


def analyze_audio(audio_path):
    y, sr = librosa.load(audio_path, sr=None)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr).tolist()
    duration = librosa.get_duration(y=y, sr=sr)
    return {
        "tempo": float(tempo),
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
