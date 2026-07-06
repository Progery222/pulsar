// Сборка встроенной «Студии» (вендор OpenReel в studio-src) -> public/studio.
// Требует pnpm. Запуск: npm run studio:build
import { execSync } from 'node:child_process';
import { existsSync, rmSync, cpSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const studio = path.join(root, 'studio-src');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', shell: true });

if (!existsSync(studio)) {
  console.error('[studio] нет папки studio-src — исходники не завендорены');
  process.exit(1);
}
if (!existsSync(path.join(studio, 'node_modules'))) {
  console.log('[studio] pnpm install…');
  run('pnpm install', studio);
}
console.log('[studio] build:wasm…');
run('pnpm build:wasm', studio);
console.log('[studio] build web (base=./)…');
run('pnpm --filter @openreel/web exec vite build --base=./', studio);

const dist = path.join(studio, 'apps', 'web', 'dist');
const out = path.join(root, 'public', 'studio');
rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });
console.log('[studio] готово -> public/studio');
