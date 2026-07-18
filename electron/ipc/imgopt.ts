import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function pyCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}
function upscaleScript(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'upscale.py')
    : path.join(process.env.APP_ROOT ?? process.cwd(), 'python', 'upscale.py');
}

// IPC модуля «Изображения» (оптимизатор): сохранение обработанных файлов в папку.
export function registerImgOptHandlers() {
  // AI-апскейл (Python + ONNX super-resolution). Принимает байты изображения,
  // возвращает путь к результату (x3). Прогресс — в 'img:upscaleProgress'.
  ipcMain.handle('img:upscaleAI', async (e, data: ArrayBuffer) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-upscale-'));
    const inp = path.join(dir, 'in.png');
    const outp = path.join(dir, 'out.png');
    await fs.promises.writeFile(inp, Buffer.from(data));
    return await new Promise<{ ok: true; path: string } | { error: string }>((resolve) => {
      const modelDir = path.join(app.getPath('userData'), 'upscale-models');
      const child = spawn(pyCmd(), [upscaleScript(), 'run', inp, outp], {
        env: { ...process.env, UPSCALE_MODEL_DIR: modelDir },
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString();
        for (const line of out.split(/\r?\n/)) {
          const m = /"percent"\s*:\s*(\d+)/.exec(line);
          if (m) e.sender.send('img:upscaleProgress', Number(m[1]));
        }
      });
      child.stderr.on('data', (c: Buffer) => (err += c.toString()));
      child.on('error', (er) => resolve({ error: `Python не найден: ${er.message}` }));
      child.on('close', () => {
        // Последняя JSON-строка — результат.
        const lines = out.trim().split(/\r?\n/).filter(Boolean);
        let parsed: { ok?: boolean; out?: string; error?: string } = {};
        try {
          parsed = JSON.parse(lines[lines.length - 1] || '{}');
        } catch {
          /* ignore */
        }
        if (parsed.ok && parsed.out && fs.existsSync(parsed.out)) resolve({ ok: true, path: parsed.out });
        else resolve({ error: parsed.error || err.slice(-300) || 'Не удалось выполнить апскейл (нужны onnxruntime/pillow/numpy — Настройки → установка).' });
      });
    });
  });

  // Записать один файл в папку (имя санитизируется, только внутри выбранной папки).
  ipcMain.handle('img:writeFile', async (_e, dir: string, name: string, data: ArrayBuffer) => {
    try {
      if (!dir) return { error: 'нет папки' };
      const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200) || 'image';
      const out = path.join(dir, safe);
      // Не даём выйти за пределы папки.
      if (!path.resolve(out).startsWith(path.resolve(dir))) return { error: 'bad path' };
      await fs.promises.writeFile(out, Buffer.from(data));
      return { ok: true as const, path: out };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
}
