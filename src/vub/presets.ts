import type { VubSnapshot } from './store';

// Профили уникализатора: именованные наборы настроек. Хранятся в localStorage
// (переживают перезапуск). Ключ -> снимок настроек.
const KEY = 'vub_presets_v1';

type PresetMap = Record<string, VubSnapshot>;

function readAll(): PresetMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as PresetMap;
  } catch {
    return {};
  }
}

function writeAll(map: PresetMap): void {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function listPresets(): string[] {
  return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
}

export function getPreset(name: string): VubSnapshot | null {
  return readAll()[name] ?? null;
}

export function savePreset(name: string, data: VubSnapshot): void {
  const map = readAll();
  map[name] = data;
  writeAll(map);
}

export function deletePreset(name: string): void {
  const map = readAll();
  delete map[name];
  writeAll(map);
}
