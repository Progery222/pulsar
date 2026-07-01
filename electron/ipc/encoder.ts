import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

// Путь к встроенному ffmpeg (распаковка из asar в упакованном приложении).
const ffmpegBin = (ffmpegStatic as unknown as string)?.replace('app.asar', 'app.asar.unpacked');

// Режим выбора энкодера: auto — детект GPU с откатом на CPU; gpu — принудительно GPU
// (но при провале детекта откатываемся на CPU); cpu — всегда libx264.
export type GpuMode = 'auto' | 'gpu' | 'cpu';
let gpuMode: GpuMode = 'auto';
export function setGpuMode(m: GpuMode) {
  gpuMode = m;
  detected = undefined; // сбросить кэш — пересчитать под новый режим
}
export function getGpuMode(): GpuMode {
  return gpuMode;
}

// Кандидаты аппаратных H.264-энкодеров в порядке предпочтения (NVIDIA → Intel → AMD).
const HW_CANDIDATES = ['h264_nvenc', 'h264_qsv', 'h264_amf'] as const;
type HwCodec = (typeof HW_CANDIDATES)[number];

// Проверка: реально ли кодирует данный энкодер (наличие в списке ≠ рабочий драйвер).
function testEncoder(codec: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ffmpegBin) {
      resolve(false);
      return;
    }
    // Кодируем 1 секунду testsrc в null-мукс выбранным кодеком.
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=256x256:rate=30:duration=1',
      '-c:v', codec, '-f', 'null', '-',
    ];
    const proc = spawn(ffmpegBin, args, { windowsHide: true });
    let failed = false;
    proc.on('error', () => {
      failed = true;
      resolve(false);
    });
    proc.on('close', (code) => {
      if (!failed) resolve(code === 0);
    });
  });
}

// Результат детекта: имя рабочего HW-кодека или null (только CPU). Кэшируется.
let detected: Promise<HwCodec | null> | undefined;

function detectHwCodec(): Promise<HwCodec | null> {
  if (gpuMode === 'cpu') return Promise.resolve(null);
  if (!detected) {
    detected = (async () => {
      for (const c of HW_CANDIDATES) {
        if (await testEncoder(c)) return c;
      }
      return null;
    })();
  }
  return detected;
}

// x264 preset → NVENC preset (p1 — быстрейший … p7 — лучшее качество).
const NVENC_PRESET: Record<string, string> = {
  ultrafast: 'p1', superfast: 'p1', veryfast: 'p2', faster: 'p3',
  fast: 'p4', medium: 'p5', slow: 'p6', slower: 'p7', veryslow: 'p7',
};

export interface EncoderOpts {
  preset: string; // x264-пресет (veryfast/fast/medium…)
  crf: number;    // x264 CRF (0–51); для HW маппится в CQ/quality
  gop?: number;   // размер GOP (-g)
}

// Возвращает массив output-опций ffmpeg для видеокодека (кодек + скорость + качество + gop).
// Сами по себе -pix_fmt/-movflags/-c:a остаются за вызывающей стороной.
export async function videoEncoderOptions(opts: EncoderOpts): Promise<string[]> {
  const hw = await detectHwCodec();
  const out: string[] = [];

  if (hw === 'h264_nvenc') {
    out.push('-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[opts.preset] ?? 'p4', '-rc', 'vbr', '-cq', String(opts.crf), '-b:v', '0');
  } else if (hw === 'h264_qsv') {
    out.push('-c:v', 'h264_qsv', '-global_quality', String(opts.crf), '-preset', opts.preset);
  } else if (hw === 'h264_amf') {
    out.push('-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', String(opts.crf), '-qp_p', String(opts.crf), '-quality', 'balanced');
  } else {
    out.push('-c:v', 'libx264', '-preset', opts.preset, '-crf', String(opts.crf));
  }
  if (opts.gop != null) out.push('-g', String(opts.gop));
  // Совместимость: yuv420p + профиль High — иначе GPU-кодек может выдать поток,
  // который мобильные декодеры (TikTok) не читают («Couldn't decode»).
  out.push('-pix_fmt', 'yuv420p', '-profile:v', 'high');
  return out;
}

// Имя активного видеокодека (для UI/логов).
export async function activeVideoCodec(): Promise<string> {
  return (await detectHwCodec()) ?? 'libx264';
}
