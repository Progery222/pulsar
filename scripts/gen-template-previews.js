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

const W = 216, H = 384, FPS = 24;
const LOG = path.join(ROOT, 'scripts', '_genlog.txt');
const log = (...a) => fs.appendFileSync(LOG, a.map(String).join(' ') + '\n');
try { fs.writeFileSync(LOG, ''); } catch {}

const S1 = [SUBJECT], S2 = [SUBJECT, SUBJECT], S3 = [SUBJECT, SUBJECT, SUBJECT];
// Проверка видео-слота: VTEST=/путь/к/clip.mp4 добавляет джоб с видео в сцене.
const fileUrl = (p) => encodeURI('file:///' + p.replace(/\\/g, '/'));
const VTEST = process.env.VTEST;
const JOBS = VTEST ? [
  { id: 'scenes', out: 'vtest', dur: 4.0, data: { accent: '#00e5ff', subjectImage: SUBJECT, slots: [{ v: fileUrl(VTEST) }],
    scenes: [
      { type: 'text', dur: 1.0, trans: 'fade', text: 'VIDEO' },
      { type: 'photo', dur: 2.0, trans: 'wipe', slot: 0, caption: 'clip 01', from: 'left' },
      { type: 'cta', dur: 1.0, trans: 'zoom', title: 'end', cta: 'Go' },
    ] } },
] : [
  { id: 'kinetic', out: 'kinetic', dur: 3, data: { accent: '#ccff00', alt: '#ff2d6b', eyebrow: 'new drop', title: 'GO', subtitle: 'crazy', cta: 'Shop now', subjectImage: SUBJECT } },
  { id: 'glitch', out: 'glitch', dur: 3, data: { accent: '#00e5ff', eyebrow: 'exclusive', title: 'HYPE', subtitle: 'drop 02', cta: 'Get it', subjectImage: SUBJECT } },
  {
    id: 'scenes', out: 'scenes-flash-sale', dur: 6.2,
    data: { accent: '#ff2d6b', subjectImage: SUBJECT, slots: S2, scenes: [
      { type: 'countdown', dur: 1.6, trans: 'fade', count: 3, caption: 'sale starts in' },
      { type: 'price', dur: 1.8, trans: 'punch', slot: 0, text: 'SNEAKERS', old: '$120', price: '$59', badge: '-50%' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 1, kicker: 'limited stock', text: 'GRAB IT' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'today only', cta: 'Shop now' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-glow-up', dur: 5.7,
    data: { accent: '#3ad1c0', subjectImage: SUBJECT, slots: S3, scenes: [
      { type: 'text', dur: 1.0, trans: 'fade', kicker: 'the results', text: 'GLOW UP', size: 15, align: 'center' },
      { type: 'beforeafter', dur: 1.9, trans: 'wipe', slot: 0, slot2: 1, text: 'before', caption: 'after' },
      { type: 'cover', dur: 1.4, trans: 'mirror', slot: 2, kicker: 'day 30', text: 'NEW YOU' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'your turn', cta: 'Start now' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-promo-drop', dur: 5.4,
    data: { accent: '#ff2d6b', subjectImage: SUBJECT, slots: S2, scenes: [
      { type: 'cover', dur: 1.4, trans: 'fade', slot: 0, kicker: 'new arrival', text: 'SUMMER SALE' },
      { type: 'stat', dur: 1.2, trans: 'punch', kicker: 'up to', text: '-50%', caption: 'today only' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 1, kicker: 'limited', text: 'GRAB YOURS' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'don’t miss it', cta: 'Shop now' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-top-reasons', dur: 6.4,
    data: { accent: '#ccff00', subjectImage: SUBJECT, slots: S1, scenes: [
      { type: 'text', dur: 1.2, trans: 'fade', kicker: 'why', text: '3 REASONS', size: 15, align: 'center', bg: 'linear-gradient(180deg,#f4f1ea,#e7e0d3)', color: '#141414' },
      { type: 'list', dur: 2.4, trans: 'swipeUp', title: 'why us', items: ['fast & easy', 'best price', 'loved by 10k+'] },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'proof', text: 'SEE FOR YOURSELF' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'try it', cta: 'Get started' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-split-story', dur: 7.1,
    data: { accent: '#00e5ff', subjectImage: SUBJECT, slots: S3, scenes: [
      { type: 'text', dur: 1.1, trans: 'fade', kicker: 'this vs that', text: 'YOU DECIDE', size: 15, align: 'left' },
      { type: 'split', dur: 1.6, trans: 'swipe', slot: 0, slot2: 1, caption: 'vs' },
      { type: 'cover', dur: 1.4, trans: 'mirror', slot: 2, kicker: 'the winner', text: 'THIS ONE' },
      { type: 'quote', dur: 1.6, trans: 'flash', text: 'trust me on this', caption: '— everyone' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'your turn', cta: 'Tap in' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-bold-quote', dur: 6.0,
    data: { accent: '#ffcc4d', subjectImage: SUBJECT, slots: S1, scenes: [
      { type: 'quote', dur: 1.6, trans: 'fade', text: 'dream big', caption: 'day one' },
      { type: 'cover', dur: 1.4, trans: 'wipe', slot: 0, kicker: 'the journey', text: 'KEEP GOING' },
      { type: 'quote', dur: 1.6, trans: 'glitchcut', text: 'never stop', caption: 'no excuses', bg: '#101014' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'let’s move', cta: 'Follow' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-story-reel', dur: 6.0,
    data: { accent: '#ff5c8a', subjectImage: SUBJECT, slots: S2, scenes: [
      { type: 'text', dur: 1.3, trans: 'fade', kicker: 'presenting', text: 'SUMMER', size: 16, align: 'left' },
      { type: 'photo', dur: 1.5, trans: 'wipe', slot: 0, caption: 'look 01', from: 'left' },
      { type: 'photo', dur: 1.5, trans: 'mirror', slot: 1, caption: 'look 02', from: 'right', capBottom: true, kenScale: true },
      { type: 'cta', dur: 1.7, trans: 'zoom', title: 'new drop', cta: 'Tap to shop' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-kinetic-trio', dur: 6.2,
    data: { accent: '#ccff00', subjectImage: SUBJECT, slots: S2, scenes: [
      { type: 'text', dur: 1.1, trans: 'fade', kicker: 'drop 02', text: 'GO CRAZY', size: 15, align: 'left' },
      { type: 'photo', dur: 1.3, trans: 'swipe', slot: 0, caption: 'move 01', from: 'left' },
      { type: 'text', dur: 1.0, trans: 'swipeUp', text: 'LET’S GO', size: 17, align: 'center' },
      { type: 'photo', dur: 1.3, trans: 'zoom', slot: 1, caption: 'move 02', from: 'right', capBottom: true },
      { type: 'cta', dur: 1.5, trans: 'wipe', title: 'shop now', cta: 'Get it' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-clip-reel', dur: 6.6,
    data: { accent: '#00e5ff', subjectImage: SUBJECT, slots: S3, scenes: [
      { type: 'text', dur: 1.0, trans: 'fade', kicker: 'now', text: 'CLIP REEL', size: 15, align: 'center' },
      { type: 'photo', dur: 1.4, trans: 'flash', slot: 0, caption: 'clip 01', from: 'left' },
      { type: 'photo', dur: 1.4, trans: 'glitchcut', slot: 1, caption: 'clip 02', from: 'right', capBottom: true },
      { type: 'photo', dur: 1.4, trans: 'punch', slot: 2, caption: 'clip 03', from: 'left' },
      { type: 'cta', dur: 1.4, trans: 'zoom', title: 'follow', cta: 'Subscribe' },
    ] },
  },
  {
    id: 'scenes', out: 'scenes-mirror-fashion', dur: 7.0,
    data: { accent: '#c8a26a', subjectImage: SUBJECT, slots: S3, scenes: [
      { type: 'text', dur: 1.2, trans: 'fade', kicker: 'the edit', text: 'AW 2026', size: 15, align: 'center' },
      { type: 'photo', dur: 1.4, trans: 'mirror', slot: 0, caption: '01', from: 'left' },
      { type: 'photo', dur: 1.4, trans: 'mirror', slot: 1, caption: '02', from: 'right', capBottom: true },
      { type: 'photo', dur: 1.4, trans: 'mirror', slot: 2, caption: '03', from: 'left', kenScale: true },
      { type: 'cta', dur: 1.6, trans: 'zoom', title: 'quiet luxury', cta: 'Discover' },
    ] },
  },
];

async function renderOne(job) {
  const DUR = job.dur || 3;
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

  try { await win.webContents.executeJavaScript('window.mediaReady ? window.mediaReady().then(()=>true) : true'); } catch {}
  const total = FPS * DUR;
  for (let i = 0; i < total; i++) {
    const tv = (i / FPS).toFixed(4);
    await win.webContents.executeJavaScript(`window.seekAndWait ? window.seekAndWait(${tv}).then(()=>true) : (window.seek(${tv}),true)`);
    await new Promise((r) => setTimeout(r, 16));
    let img = await win.webContents.capturePage();
    const sz = img.getSize();
    if (sz.width !== W || sz.height !== H) img = img.resize({ width: W, height: H, quality: 'best' });
    const png = img.toPNG();
    if (i === 0) log(job.id, 'frame0 size', sz.width + 'x' + sz.height, 'png bytes', png.length);
    fs.writeFileSync(path.join(tmp, `f${String(i).padStart(5, '0')}.png`), png);
  }
  if (!win.isDestroyed()) win.destroy();
  log(job.id, 'frames written', fs.readdirSync(tmp).length, 'tmp', tmp);

  const out = path.join(outDir, `${job.out || job.id}.mp4`);
  log(job.out || job.id, 'ffmpeg spawning ->', out);
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
