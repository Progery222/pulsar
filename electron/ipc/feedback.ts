import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Токен/chat_id Telegram: env-переменные (для CI) или gitignored feedback.secret.json (локально/пакет).
function loadConfig(): { token: string; chatId: string } | null {
  const envT = process.env.TG_FEEDBACK_TOKEN;
  const envC = process.env.TG_FEEDBACK_CHAT;
  if (envT && envC) return { token: envT, chatId: envC };
  const candidates = [
    path.join(process.env.APP_ROOT ?? process.cwd(), 'feedback.secret.json'),
    path.join(process.resourcesPath ?? '', 'feedback.secret.json'),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (j.token && j.chatId) return { token: String(j.token), chatId: String(j.chatId) };
    } catch {
      /* нет файла — пробуем следующий */
    }
  }
  return null;
}

export function registerFeedbackHandlers(): void {
  ipcMain.handle('feedback:send', async (_e, text: string) => {
    const cfg = loadConfig();
    if (!cfg) return { error: 'Обратная связь не настроена (нет токена)' };
    const msg = (text || '').trim();
    if (!msg) return { error: 'Пустое сообщение' };
    const header = `🐞 Pulsar feedback\nВерсия: ${app.getVersion()}\nОС: ${os.platform()} ${os.release()}\n————\n`;
    const body = (header + msg).slice(0, 4000); // лимит Telegram
    try {
      const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatId, text: body, disable_web_page_preview: true }),
      });
      if (!r.ok) return { error: `Telegram ${r.status}` };
      const j = (await r.json()) as { ok?: boolean; description?: string };
      return j.ok ? { ok: true } : { error: j.description || 'Ошибка Telegram' };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
}
