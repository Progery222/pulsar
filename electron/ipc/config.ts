import { app, ipcMain, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Локальное хранение секретов (API-ключ AssemblyAI) в userData. В git/исходники не попадает.
function configPath(): string {
  return path.join(app.getPath('userData'), 'vub-secrets.json');
}

function readRaw(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeRaw(data: Record<string, string>): void {
  fs.writeFileSync(configPath(), JSON.stringify(data), 'utf-8');
}

// Ключ шифруется через safeStorage (DPAPI на Windows), если доступно.
function encode(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(value).toString('base64');
  }
  return 'raw:' + Buffer.from(value, 'utf-8').toString('base64');
}

function decode(stored: string | undefined): string {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('raw:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf-8');
    }
  } catch {
    /* noop */
  }
  return '';
}

export function getAssemblyKey(): string {
  return decode(readRaw().assemblyai);
}

export function registerConfigHandlers() {
  ipcMain.handle('vub:getKey', () => getAssemblyKey());
  ipcMain.handle('vub:setKey', (_e, key: string) => {
    const data = readRaw();
    if (key) data.assemblyai = encode(key);
    else delete data.assemblyai;
    writeRaw(data);
    return { ok: true };
  });
}
