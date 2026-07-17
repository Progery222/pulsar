// Генерация аудиодорожки кликов (короткие «тики») через OfflineAudioContext → WAV.
// Подмешивается в экспорт, чтобы клики было слышно (как в Screen Studio).

function audioBufferToWav(buf: AudioBuffer): ArrayBuffer {
  const numCh = 1;
  const sr = buf.sampleRate;
  const samples = buf.getChannelData(0);
  const dataLen = samples.length * 2;
  const out = new ArrayBuffer(44 + dataLen);
  const view = new DataView(out);
  const wr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  wr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  wr(8, 'WAVE');
  wr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  wr(36, 'data');
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return out;
}

export async function makeClickTrackWav(timesSec: number[], durationSec: number): Promise<ArrayBuffer> {
  const sr = 44100;
  const length = Math.max(1, Math.ceil((durationSec + 0.2) * sr));
  const ctx = new OfflineAudioContext(1, length, sr);
  for (const t of timesSec) {
    if (t < 0 || t > durationSec) continue;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2100;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }
  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}
