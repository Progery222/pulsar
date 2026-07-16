// Смешивание нескольких аудио-потоков (системный звук + микрофон) в один трек через
// WebAudio — MediaRecorder пишет только один аудиотрек, поэтому источники надо свести.
export function mixAudioTracks(streams: MediaStream[]): { track: MediaStreamTrack; ctx: AudioContext } | null {
  const withAudio = streams.filter((s) => s.getAudioTracks().length > 0);
  if (withAudio.length === 0) return null;

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const s of withAudio) {
    const src = ctx.createMediaStreamSource(s);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain).connect(dest);
  }
  return { track: dest.stream.getAudioTracks()[0], ctx };
}
