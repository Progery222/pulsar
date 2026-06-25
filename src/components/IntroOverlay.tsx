import { useEffect, useState } from 'react';

// Интро проигрывается один раз за запуск приложения.
let introPlayed = false;
export function introAlreadyPlayed() {
  return introPlayed;
}

// Звук «пульсара»: мягкий свелл + два пульса (Web Audio, без внешних файлов).
function playIntroSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    // Нарастающий низкий свелл.
    const swell = ctx.createOscillator();
    const sg = ctx.createGain();
    swell.type = 'sine';
    swell.frequency.setValueAtTime(110, now);
    swell.frequency.exponentialRampToValueAtTime(440, now + 1.6);
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.22, now + 0.8);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    swell.connect(sg).connect(ctx.destination);
    swell.start(now);
    swell.stop(now + 2.3);

    // Два чистых пульса в такт логотипу.
    [0.7, 1.25].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(880, now + t);
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.18, now + t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(now + t);
      o.stop(now + t + 0.4);
    });

    setTimeout(() => ctx.close().catch(() => {}), 2600);
  } catch {
    /* звук недоступен — анимация всё равно идёт */
  }
}

export default function IntroOverlay({ onDone }: { onDone: () => void }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    introPlayed = true;
    playIntroSound();
    const t = setTimeout(() => {
      setHidden(true);
      onDone();
    }, 2900);
    return () => clearTimeout(t);
  }, [onDone]);

  if (hidden) return null;

  // Клик — пропустить интро.
  return (
    <div
      className="pulsar-intro"
      onClick={() => {
        setHidden(true);
        onDone();
      }}
      title="Нажмите, чтобы пропустить"
    >
      <div className="pulsar-intro-logo">Pulsar</div>
    </div>
  );
}
