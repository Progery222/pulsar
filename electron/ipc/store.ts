import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Персистентная история выполненных задач (userData/history.json).
export interface HistoryEntry {
  id: string;
  mode: 'editor' | 'vub' | 'cleaner';
  title: string;
  createdAt: number; // мс (передаётся из renderer)
  outputDir: string;
  files: string[]; // имена/пути результатов
  settings: unknown; // снимок настроек для повтора
}

const MAX_ENTRIES = 200;

function historyPath(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

function readHistory(): HistoryEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(historyPath(), 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeHistory(list: HistoryEntry[]): void {
  fs.writeFileSync(historyPath(), JSON.stringify(list.slice(0, MAX_ENTRIES)), 'utf-8');
}

export function registerStoreHandlers() {
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('history:list', () => readHistory());
  ipcMain.handle('history:add', (_e, entry: HistoryEntry) => {
    const list = readHistory();
    list.unshift(entry); // новые сверху
    writeHistory(list);
    return { ok: true };
  });
  ipcMain.handle('history:remove', (_e, id: string) => {
    writeHistory(readHistory().filter((x) => x.id !== id));
    return { ok: true };
  });
  ipcMain.handle('history:clear', () => {
    writeHistory([]);
    return { ok: true };
  });
}
