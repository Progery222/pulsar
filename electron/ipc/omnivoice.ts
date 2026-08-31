import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getSettingValue } from './config';

// OmniVoice (k2-fsa) — офлайн-движок озвучки с клонированием голоса. Здесь общее для
// tts/dub/aivideo/setup: где лежит модель, установлен ли движок, какой движок брать.

export type TtsEngine = 'omnivoice' | 'edge';

export function pythonDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python');
}

export function omniVoiceModelDir(): string {
  return path.join(pythonDir(), 'models', 'omnivoice');
}

// Модель качается последним шагом установки — её наличие и означает «движок готов».
export function isOmniVoiceInstalled(): boolean {
  return fs.existsSync(path.join(omniVoiceModelDir(), 'model.safetensors'));
}

let nvidiaProbe: Promise<boolean> | undefined;

// Есть ли NVIDIA GPU (nvidia-smi ставится с драйвером): от этого зависит сборка PyTorch и скорость.
export function hasNvidiaGpu(): Promise<boolean> {
  if (!nvidiaProbe) {
    nvidiaProbe = new Promise((resolve) => {
      let child;
      try {
        child = spawn('nvidia-smi', ['-L'], { windowsHide: true });
      } catch {
        resolve(false);
        return;
      }
      let out = '';
      const timer = setTimeout(() => { try { child.kill(); } catch { /* уже мёртв */ } resolve(false); }, 8000);
      child.stdout.on('data', (c) => (out += c.toString()));
      child.on('error', () => { clearTimeout(timer); resolve(false); });
      child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && /GPU \d/.test(out)); });
    });
  }
  return nvidiaProbe;
}

function engineSetting(): string {
  const s = getSettingValue('ttsEngine');
  return typeof s === 'string' ? s : 'auto';
}

// Какой движок реально использовать: явный запрос → настройка «Движок озвучки» →
// авто (OmniVoice, если установлен, иначе Edge TTS).
export function resolveTtsEngine(requested?: string): TtsEngine {
  const want = requested && requested !== 'auto' ? requested : engineSetting();
  if (want === 'omnivoice' || want === 'edge') return want;
  return isOmniVoiceInstalled() ? 'omnivoice' : 'edge';
}

// Движок выбран явно (запросом или настройкой) — тогда при сбое не подменяем его резервным.
export function isExplicitEngine(requested?: string): boolean {
  if (requested === 'omnivoice' || requested === 'edge') return true;
  const s = engineSetting();
  return s === 'omnivoice' || s === 'edge';
}

// Голос в формате OmniVoice: 'clone:<путь к аудио>' либо 'design:<описание голоса>'.
export function isOmniVoiceSpec(voice: string): boolean {
  return voice.startsWith('clone:') || voice.startsWith('design:');
}
