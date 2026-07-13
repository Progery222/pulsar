// Генератор превью фото-шаблонов: грузит public/templates/runtime.html офскрин,
// прогоняет initTemplate+seek покадрово (как templateRender), склеивает ffmpeg -> mp4.
// Запуск: electron scripts/gen-template-previews.cjs
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const ffmpegBin = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const runtimeHtml = path.join(ROOT, 'public', 'templates', 'runtime.html');
const fontsDir = path.join(ROOT, 'assets', 'fonts');
const outDir = path.join(ROOT, 'public', 'templates', 'previews');

const SUBJECT =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='560'>" +
      "<g fill='#dce1ea'><circle cx='200' cy='150' r='92'/>" +
      "<path d='M52 560 C52 372 118 292 200 292 C282 292 348 372 348 560 Z'/></g></svg>"
  );

const W = 216, H = 384, FPS = 24, DUR = 3;
const LOG = path.join(ROOT, 'scripts', '_genlog.txt');
const log = (...a) => fs.appendFileSync(LOG, a.map(String).join(' ') + '\n');
try { fs.writeFileSync(LOG, ''); } catch {}

const JOBS = [
  { id: 'kinetic', data: { accent: '#ccff00', alt: '#ff2d6b', eyebrow: 'new drop', title: 'GO', subtitle: 'crazy', cta: 'Shop now', subjectImage: SUBJECT } },
  { id: 'glitch', data: { accent: '#00e5ff', eyebrow: 'exclusive', title: 'HYPE', subtitle: 'drop 02', cta: 'Get it', subjectImage: SUBJECT } },
];

async function renderOne(job) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tplprev-'));
  const win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  await win.loadFile(runtimeHtml);
  const cfg = { id: job.id, dur: DUR, fontsDir, data: job.data };
  await win.webContents.executeJavaScript(`initTemplate(${JSON.stringify(cfg)}); true`);
  try { await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)'); } catch {}
  await new Promise((r) => setTimeout(r, 400));

  const total = FPS * DUR;
  for (let i = 0; i < total; i++) {
    await win.webContents.executeJavaScript(`window.seek(${(i / FPS).toFixed(4)}); true`);
    await new Promise((r) => setTimeout(r, 22));
    let img = await win.webContents.capturePage();
    const sz = img.getSize();
    if (sz.width !== W || sz.height !== H) img = img.resize({ width: W, height: H, quality: 'best' });
    const png = img.toPNG();
    if (i === 0) log(job.id, 'frame0 size', sz.width + 'x' + sz.height, 'png bytes', png.length);
    fs.writeFileSync(path.join(tmp, `f${String(i).padStart(5, '0')}.png`), png);
  }
  if (!win.isDestroyed()) win.destroy();
  log(job.id, 'frames written', fs.readdirSync(tmp).length, 'tmp', tmp);

  const out = path.join(outDir, `${job.id}.mp4`);
  log(job.id, 'ffmpeg bin exists?', fs.existsSync(ffmpegBin), 'spawning ->', out);
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin, [
      '-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS),
      '-i', path.join(tmp, 'f%05d.png'), '-vf', 'format=yuv420p',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-t', String(DUR), out,
    ], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => { if (err) log(job.id, 'ffmpeg stderr:', err.slice(-300)); c === 0 ? resolve() : reject(new Error(err)); });
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  log('OK', out, fs.statSync(out).size, 'bytes');
}

app.on('window-all-closed', () => { /* не выходим сами — выйдем после рендера всех job */ });
app.whenReady().then(async () => {
  try {
    for (const job of JOBS) await renderOne(job);
    log('DONE');
    app.exit(0);
  } catch (e) {
    log('FAIL', e && e.stack || e);
    app.exit(1);
  }
});
