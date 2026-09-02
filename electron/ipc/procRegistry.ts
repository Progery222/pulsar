import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Реестр дочерних процессов.
 *
 * На Windows дочерние процессы не умирают вместе с родителем: при закрытии окна,
 * `app.quit()`, перезапуске после установки или крэше main все ffmpeg, python,
 * yt-dlp и PowerShell-опросчик остаются жить — грузят GPU, держат выходные файлы
 * и мешают обновлению заменить `resources\python`. Раньше состояние задач было
 * разбросано по семи модулям и единого места, где их можно погасить, не было.
 *
 * Использование: `track(child)` сразу после spawn (или `spawnTracked(...)`),
 * `untrack` — необязателен, реестр сам забывает завершившиеся процессы.
 * `killAll()` вызывается из main на выходе и перед аварийным завершением.
 */

const alive = new Set<ChildProcess>();

/** Завершить процесс вместе с потомками: yt-dlp порождает ffmpeg, pip — компиляторы. */
export function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    } catch {
      /* ниже — обычный kill */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* уже мёртв */
  }
}

export function track<T extends ChildProcess>(child: T): T {
  alive.add(child);
  child.once('exit', () => alive.delete(child));
  child.once('error', () => alive.delete(child));
  return child;
}

export function untrack(child: ChildProcess): void {
  alive.delete(child);
}

/**
 * Обёртка над spawn с теми же перегрузками: типы stdout/stderr зависят от
 * опций stdio, и упрощённая сигнатура ломала бы их во всех модулях.
 */
export const spawnTracked: typeof spawn = ((...args: unknown[]) =>
  track((spawn as (...a: unknown[]) => ChildProcess)(...args))) as typeof spawn;

export function killAll(): void {
  for (const child of [...alive]) killTree(child);
  alive.clear();
}

export const aliveCount = (): number => alive.size;
