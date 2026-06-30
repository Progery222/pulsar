import { app, BrowserWindow, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';
import { UPDATE_GITHUB_TOKEN } from './defaultKeys';

const { autoUpdater } = electronUpdater;

// Состояние обновления, транслируемое в renderer (баннер «Обновить»).
export type UpdateState =
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; error: string };

function broadcast(payload: UpdateState) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('update-status', payload);
  }
}

export function registerUpdaterHandlers() {
  // Скачиваем только по нажатию пользователя; ставим при выходе.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Приватный GitHub-репо: задаём токен (только-чтение), иначе релизы недоступны.
  if (UPDATE_GITHUB_TOKEN) {
    try {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'Progery222',
        repo: 'pulsar',
        private: true,
        token: UPDATE_GITHUB_TOKEN,
      });
    } catch {
      /* в dev setFeedURL может бросать — игнорируем */
    }
  }

  autoUpdater.on('update-available', (info) => broadcast({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }));
  autoUpdater.on('error', (err) => broadcast({ state: 'error', error: err instanceof Error ? err.message : String(err) }));
  autoUpdater.on('download-progress', (p) => broadcast({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'ready', version: info.version }));

  ipcMain.handle('update:check', async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: r?.updateInfo?.version ?? null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
    return { ok: true };
  });
  ipcMain.handle('update:version', () => app.getVersion());

  // Авто-проверка вскоре после старта (в dev-режиме просто молча падает в catch).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4000);
}
