import { spawn, type SpawnOptionsWithoutStdio, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Поиск настоящего интерпретатора Python.
//
// Зачем отдельный модуль: на Windows в PATH первым обычно стоит заглушка из
// Microsoft Store — %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe. Она не
// запускает скрипты, а открывает страницу магазина и завершается. spawn('python')
// при этом «успешно» стартует и молча ничего не выводит, из-за чего приложение
// считало, что Python не установлен, даже когда он стоял рядом.

export interface PythonCmd {
  cmd: string;
  args: string[]; // префикс-аргументы (для лаунчера py это ['-3'])
  exe: string; // абсолютный путь к интерпретатору (sys.executable)
  version: string;
}

let cached: PythonCmd | null = null;
let pending: Promise<PythonCmd | null> | null = null;

// Заглушка магазина: путь внутри WindowsApps. Настоящий Python туда не ставится.
const isStoreStub = (p: string) => /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(p);

function probe(cmd: string, args: string[]): Promise<PythonCmd | null> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (v: PythonCmd | null) => { if (!done) { done = true; resolve(v); } };

    let child;
    try {
      child = spawn(cmd, [...args, '-c', 'import sys;print(sys.executable);print(sys.version.split()[0])'], {
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }

    // Заглушка умеет зависнуть, открыв магазин, — не ждём её вечно.
    const timer = setTimeout(() => { try { child.kill(); } catch { /* уже мёртв */ } finish(null); }, 7000);

    child.stdout.on('data', (c) => (out += c.toString()));
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const [exe, version] = out.trim().split(/\r?\n/);
      if (code !== 0 || !exe || !version || isStoreStub(exe)) { finish(null); return; }
      finish({ cmd, args, exe, version });
    });
  });
}

// Кандидаты по убыванию надёжности. Лаунчер py первым: он ставится вместе с
// Python и знает про все версии, даже когда PATH не настроен.
function candidates(): { cmd: string; args: string[] }[] {
  if (process.platform !== 'win32') {
    return [{ cmd: 'python3', args: [] }, { cmd: 'python', args: [] }];
  }
  const list: { cmd: string; args: string[] }[] = [
    { cmd: 'py', args: ['-3'] },
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] },
  ];
  // Обычные места установки — на случай, когда галочку «Add to PATH» не ставили.
  const roots = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python'),
    'C:\\Program Files\\Python',
    'C:\\',
  ];
  for (const root of roots) {
    try {
      for (const name of fs.readdirSync(root)) {
        if (!/^Python3\d*$/i.test(name)) continue;
        const exe = path.join(root, name, 'python.exe');
        if (fs.existsSync(exe)) list.push({ cmd: exe, args: [] });
      }
    } catch { /* каталога нет — не страшно */ }
  }
  return list;
}

export async function resolvePython(force = false): Promise<PythonCmd | null> {
  if (cached && !force) return cached;
  if (pending && !force) return pending;
  pending = (async () => {
    for (const c of candidates()) {
      const found = await probe(c.cmd, c.args);
      if (found) { cached = found; return found; }
    }
    cached = null;
    return null;
  })();
  const res = await pending;
  pending = null;
  return res;
}

// Синхронный доступ для модулей, которые собирают команду до await.
// Отдаём абсолютный путь: он не зависит от PATH и не ведёт в заглушку магазина.
// До прогрева кэша возвращаем прежнее поведение, чтобы ничего не сломать.
export function pythonCmdSync(): string {
  return cached?.exe ?? (process.platform === 'win32' ? 'python' : 'python3');
}

// Сбросить кэш — после установки Python в текущей сессии.
export function forgetPython(): void {
  cached = null;
}

// Запуск python-скрипта найденным интерпретатором.
// Бросает понятную ошибку, если Python в системе действительно нет.
export async function spawnPython(
  args: string[],
  opts: SpawnOptionsWithoutStdio = {},
): Promise<ChildProcessWithoutNullStreams> {
  const py = await resolvePython();
  if (!py) throw new Error('Python не найден. Установите его с python.org и перезапустите приложение.');
  return spawn(py.exe, args, { windowsHide: true, ...opts });
}
