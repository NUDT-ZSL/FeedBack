import puppeteer from 'puppeteer-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'http://localhost:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1280,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__app && window.__app.gallery, { timeout: 20000 });
  await sleep(300);
  return page;
}

const getState = (page) =>
  page.evaluate(() => {
    const { camera, gallery, focusLog } = window.__app;
    return {
      pos: camera.position.toArray(),
      quat: camera.quaternion.toArray(),
      flying: gallery.isTeleporting(),
      focusLog: focusLog.slice()
    };
  });

const clickThumb = (page, i) =>
  page.evaluate((idx) => {
    const c = Array.from(document.querySelectorAll('canvas')).filter((x) => x.width === 50 && x.height === 50);
    c[idx].parentElement.parentElement.click();
  }, i);

const distToArt = (page, i) =>
  page.evaluate((idx) => {
    const { camera, gallery } = window.__app;
    const p = gallery.artworks[idx].group.position;
    return Math.hypot(camera.position.x - p.x, camera.position.z - p.z);
  }, i);

async function waitArrival(page, timeout = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await getState(page);
    if (!s.flying) return Date.now() - t0;
    await sleep(50);
  }
  return -1;
}

// Scenario A: smooth flight, focus only on arrival
{
  const page = await newPage();
  await clickThumb(page, 9);
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < 4000) {
    const s = await getState(page);
    samples.push({ t: Date.now() - t0, ...s });
    if (!s.flying && samples.length > 3) break;
    await sleep(80);
  }
  const last = samples[samples.length - 1];
  check('A1 flight starts flying', samples[0].flying === true);
  const early = samples.filter((s) => s.t < 250);
  const earlyMoved = Math.hypot(...early[early.length - 1].pos.map((v, i) => v - samples[0].pos[i]));
  check('A2 no instant jump (first 250ms moves < 3u)', earlyMoved < 3, `moved=${earlyMoved.toFixed(2)}`);
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    maxStep = Math.max(maxStep, Math.hypot(...samples[i].pos.map((v, j) => v - samples[i - 1].pos[j])));
  }
  check('A3 smooth motion (max sample step < 4u)', maxStep < 4, `maxStep=${maxStep.toFixed(2)}`);
  check('A4 flight duration ~2.4s', last.t > 1800 && last.t < 3200, `t=${last.t}ms`);
  const midFocus = samples.filter((s) => s.flying).every((s) => s.focusLog.length === 0);
  check('A5 no focus change during flight', midFocus);
  check('A6 focus set to target on arrival', JSON.stringify(last.focusLog) === '[9]', JSON.stringify(last.focusLog));
  const d = await distToArt(page, 9);
  check('A7 arrives ~2.5u from target', Math.abs(d - 2.5) < 0.05, `d=${d.toFixed(3)}`);
  const hl = await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('canvas')).filter((x) => x.width === 50 && x.height === 50);
    return c[9].parentElement.style.borderWidth;
  });
  check('A8 thumbnail highlight updated', hl === '3px', `borderWidth=${hl}`);
  await page.close();
}

// Scenario B: repeated click on same target does not restart flight
{
  const page = await newPage();
  await clickThumb(page, 9);
  await sleep(400);
  await clickThumb(page, 9);
  const t1 = Date.now();
  const arrival = await waitArrival(page);
  const total = 400 + (Date.now() - t1);
  check('B1 same-target click keeps one flight (~2.4s total)', total > 2000 && total < 2700, `total=${total}ms arrival=${arrival}ms`);
  const d = await distToArt(page, 9);
  check('B2 arrives at target', Math.abs(d - 2.5) < 0.05, `d=${d.toFixed(3)}`);
  await page.close();
}

// Scenario C: rapid clicks on different targets, later replaces earlier
{
  const page = await newPage();
  await clickThumb(page, 9);
  await sleep(400);
  await clickThumb(page, 2);
  const arrival = await waitArrival(page);
  check('C1 replacement flight completes', arrival > 0, `arrival=${arrival}ms`);
  const d2 = await distToArt(page, 2);
  const d9 = await distToArt(page, 9);
  check('C2 ends at second target', Math.abs(d2 - 2.5) < 0.05 && d9 > 5, `d2=${d2.toFixed(2)} d9=${d9.toFixed(2)}`);
  const s = await getState(page);
  check('C3 focus only for final target', JSON.stringify(s.focusLog) === '[2]', JSON.stringify(s.focusLog));
  await page.close();
}

// Scenario D: cancel stops camera, focus untouched, later input works
{
  const page = await newPage();
  await clickThumb(page, 9);
  await sleep(500);
  const cancelled = await page.evaluate(() => window.__app.gallery.cancelTeleport());
  check('D1 cancelTeleport returns true', cancelled === true);
  const p1 = (await getState(page)).pos;
  await sleep(400);
  const s2 = await getState(page);
  const moved = Math.hypot(...s2.pos.map((v, i) => v - p1[i]));
  check('D2 camera stays at cancel position', moved < 1e-6, `moved=${moved}`);
  check('D3 focus unchanged after cancel', s2.focusLog.length === 0, JSON.stringify(s2.focusLog));
  await page.keyboard.down('KeyW');
  await sleep(400);
  await page.keyboard.up('KeyW');
  const s3 = await getState(page);
  const walked = Math.hypot(...s3.pos.map((v, i) => v - s2.pos[i]));
  check('D4 keyboard control works after cancel', walked > 0.5, `walked=${walked.toFixed(2)}`);
  await page.close();
}

// Scenario E: drag takes over mid-flight
{
  const page = await newPage();
  await clickThumb(page, 9);
  await sleep(500);
  const before = await getState(page);
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(760, 400, { steps: 5 });
  const during = await getState(page);
  check('E1 drag ends flight immediately', during.flying === false);
  await page.mouse.up();
  await sleep(300);
  const after = await getState(page);
  const posDrift = Math.hypot(...after.pos.map((v, i) => v - during.pos[i]));
  check('E2 camera stays where drag took over', posDrift < 0.01, `drift=${posDrift.toFixed(4)}`);
  const quatChanged = after.quat.some((v, i) => Math.abs(v - before.quat[i]) > 1e-4);
  check('E3 drag rotates camera smoothly from flight pose', quatChanged);
  check('E4 no focus change from takeover', after.focusLog.length === 0, JSON.stringify(after.focusLog));
  await page.close();
}

// Scenario F: movement key takes over mid-flight
{
  const page = await newPage();
  await clickThumb(page, 9);
  await sleep(500);
  const before = await getState(page);
  await page.keyboard.down('KeyW');
  await sleep(150);
  const mid = await getState(page);
  check('F1 movement key ends flight', mid.flying === false);
  await sleep(400);
  await page.keyboard.up('KeyW');
  const after = await getState(page);
  const walked = Math.hypot(...after.pos.map((v, i) => v - before.pos[i]));
  check('F2 camera moves under key control after takeover', walked > 0.5, `walked=${walked.toFixed(2)}`);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? 'ALL SCENARIOS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
