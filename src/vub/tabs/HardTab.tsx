import { useVubStore } from '../store';
import { Checkbox } from '../components/ui';
import { mediaUrl } from '../../utils/media';
import type { VubHard } from '../types';

// Превью «до/после» в assets/previews/hard. Эффекты во времени — анимированные GIF,
// пространственный warp — статичный PNG. Путь относительный (резолвится в main).
const PREVIEW_EXT: Record<string, string> = { drift: 'gif', warp: 'gif', frameBlend: 'gif', fpsInterp: 'gif' };
const previewPath = (key: string) => `assets/previews/hard/${key}.${PREVIEW_EXT[key]}`;

// Вкладка «Жёсткие фильтры (анти-детект)». Каждый фильтр нелинейно меняет кадр/спектр —
// детектить заметно труднее косметики. У каждого показан реальный пример ffmpeg.
const HARD: { key: keyof VubHard; label: string; level: string; desc: string; example: string }[] = [
  {
    key: 'drift',
    label: 'Дрейф кадра',
    level: 'почти незаметно',
    desc: 'Кадр непрерывно «плывёт»: лёгкий зум даёт запас, а область кадрирования едет по синусу во времени. Перцептивный хеш не закрепляется ни на одном кадре.',
    example: "scale=iw*1.08:ih*1.08,crop=iw/1.08:ih/1.08:x='(in_w-out_w)/2+3*sin(2*PI*t/3.5)':y='(in_h-out_h)/2+3*cos(2*PI*t/4)'",
  },
  {
    key: 'warp',
    label: 'Дисторсия линзы',
    level: 'чуть заметно по краям',
    desc: 'Нелинейно смещает каждый пиксель (эффект мягкой «линзы»). Один из самых сильных сломов перцептивного хеша — геометрия пикселей меняется неравномерно.',
    example: 'scale=iw*1.06:ih*1.06,lenscorrection=k1=0.05:k2=0.02,crop=iw/1.06:ih/1.06',
  },
  {
    key: 'frameBlend',
    label: 'Смешение кадров',
    level: 'заметно на резком движении',
    desc: 'Каждый кадр = смешение с соседним → лёгкий смаз. Покадровый хеш становится другим, плюс рушит сравнение по ключевым кадрам.',
    example: 'tmix=frames=2',
  },
  {
    key: 'fpsInterp',
    label: 'Интерполяция fps',
    level: 'тяжёлый рендер',
    desc: 'Пересчитывает кадры в другой fps с досинтезом промежуточных. Меняет временной отпечаток сильнее всего, но рендер заметно медленнее.',
    example: 'minterpolate=fps=48:mi_mode=blend',
  },
  {
    key: 'audioFx',
    label: 'Аудио: vibrato + эхо',
    level: 'слышно на слух',
    desc: 'Модуляция высоты (vibrato) + короткое эхо. Сдвигает тембр и временную структуру звука → ломает акустический отпечаток сильнее простого pitch-сдвига.',
    example: 'vibrato=f=5:d=0.3,aecho=0.8:0.85:40:0.18',
  },
];

export default function HardTab() {
  const hard = useVubStore((s) => s.hard);
  const setHard = useVubStore((s) => s.setHard);

  return (
    <div>
      <h2 className="font-semibold" style={{ fontSize: 20, marginBottom: 8 }}>
        Жёсткие фильтры (анти-детект)
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
        Меняют каждый кадр/спектр <b>нелинейно</b> — TikTok детектит такое заметно труднее, чем
        яркость/зеркало. Цена — заметнее на глаз/слух и тяжелее по CPU. Совет: включай по <b>1–2</b>,
        а не все сразу. Под каждым — реальная команда ffmpeg, которая применяется (значения
        рандомизируются на каждую копию).
      </p>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
        В превью: слева — оригинал, справа — с фильтром (анимация показывает эффект во времени).
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, alignItems: 'start' }}>
        {HARD.map(({ key, label, level, desc, example }) => {
          const on = hard[key];
          return (
            <div
              key={key}
              style={{
                background: 'var(--bg-secondary)',
                border: `1.5px solid ${on ? 'var(--accent-green)' : 'var(--border)'}`,
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Checkbox checked={on} onChange={(v) => setHard({ [key]: v })} label={label} />
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{level}</span>
              </div>

              {PREVIEW_EXT[key] ? (
                <img
                  src={mediaUrl(previewPath(key))}
                  alt={`${label} превью`}
                  style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '16/7',
                    borderRadius: 6,
                    border: '1px dashed var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    color: 'var(--text-secondary)',
                  }}
                >
                  🔊
                </div>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>{desc}</p>

              <details>
                <summary style={{ fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>команда ffmpeg</summary>
                <code
                  style={{
                    display: 'block',
                    fontSize: 10.5,
                    fontFamily: 'monospace',
                    color: 'var(--accent-green)',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    marginTop: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    lineHeight: 1.5,
                  }}
                >
                  {example}
                </code>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
