/**
 * Browser smoke test. Dev-only — puppeteer is a devDependency and the shipped
 * app still has zero runtime dependencies.
 *
 * Loads the real page against the real dev server and exercises the paths that
 * unit tests cannot reach: the worker handshake, canvas rendering, the audio
 * graph, drawing input, and preset switching. Any console error or unhandled
 * rejection fails the run.
 *
 * Usage: node tools/serve.mjs &  then  node tools/smoke.mjs
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = new URL('../.smoke/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const problems = [];
let step = 0;

async function shot(page, name) {
  step += 1;
  const path = `${OUT}${String(step).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path });
  return path;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-sandbox',
      '--use-gl=swiftshader',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1 });

  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) =>
    problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`),
  );

  console.log(`Loading ${BASE} …`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // The worker must deliver a solution and the facts table must fill in.
  await page.waitForFunction(() => document.querySelector('#facts')?.children.length > 0, {
    timeout: 30000,
  });
  await sleep(400);

  const first = await page.evaluate(() => ({
    readout: document.querySelector('#readout').textContent.trim(),
    modeRows: document.querySelectorAll('#spectrum .mode-row').length,
    facts: [...document.querySelectorAll('#facts dt')].map((dt, i) => [
      dt.textContent,
      document.querySelectorAll('#facts dd')[i].textContent,
    ]),
    busyHidden: document.querySelector('#stage-busy').hidden,
  }));
  console.log('\n-- initial load (circle) --');
  console.log('readout :', first.readout);
  console.log('modes   :', first.modeRows);
  console.log('busy hidden:', first.busyHidden);
  for (const [k, v] of first.facts) console.log(`  ${k}: ${v}`);
  await shot(page, 'circle');

  if (first.modeRows === 0) problems.push('no modes were listed after solving');
  if (!/Lowest mode/.test(first.readout)) problems.push('readout did not describe the drum');

  // Check the canvas actually has ink on it, not just an empty element.
  const painted = await page.evaluate(() => {
    const c = document.querySelector('#board');
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 8) lit++;
    return { lit, total: Math.ceil(data.length / (4 * 97)), w: c.width, h: c.height };
  });
  console.log('painted pixels sampled:', painted);
  if (painted.lit < painted.total * 0.1) problems.push('canvas looks blank after solving');

  // Strike it.
  const box = await page.$eval('#board', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * 0.42, box.y + box.h * 0.45);
  await sleep(700);
  const struck = await page.evaluate(() => ({
    hintHidden: document.querySelector('#stage-hint').hidden,
  }));
  console.log('\n-- after strike --');
  console.log('hint hidden (means struck):', struck.hintHidden);
  if (!struck.hintHidden) problems.push('striking the drum had no visible effect');
  await shot(page, 'struck');

  // Selecting a higher mode should redraw and update the readout.
  await page.evaluate(() => document.querySelectorAll('#spectrum .mode-row')[4].click());
  await sleep(500);
  const modeText = await page.$eval('#readout', (n) => n.textContent.trim());
  console.log('\n-- mode 5 selected --\nreadout:', modeText);
  if (!/Mode\s*5/.test(modeText)) problems.push('selecting a mode did not update the readout');
  await shot(page, 'mode5');

  // The isospectral pair: switch to Kac drum I, record its spectrum, switch to
  // II, and compare in the browser.
  await page.evaluate(() => {
    [...document.querySelectorAll('#presets .chip')].find((c) => c.dataset.id === 'gww-a').click();
  });
  await page.waitForFunction(
    () => document.querySelector('#stage-busy').hidden && document.querySelector('#kac-callout') && !document.querySelector('#kac-callout').hidden,
    { timeout: 30000 },
  );
  await sleep(300);
  const specA = await page.$$eval('#spectrum .mode-freq', (n) => n.map((x) => x.textContent));
  await shot(page, 'kac-a');

  await page.click('#btn-kac-swap');
  await page.waitForFunction(() => document.querySelector('#stage-busy').hidden, { timeout: 30000 });
  await sleep(500);
  const specB = await page.$$eval('#spectrum .mode-freq', (n) => n.map((x) => x.textContent));
  await shot(page, 'kac-b');

  console.log('\n-- isospectral pair, as displayed in the browser --');
  console.log('drum I :', specA.slice(0, 6).join('  '));
  console.log('drum II:', specB.slice(0, 6).join('  '));
  if (specA.join('|') !== specB.join('|')) {
    problems.push('the two Kac drums displayed different spectra in the UI');
  }

  // Draw a custom shape: enable drawing and drag a rough pentagon.
  await page.click('#btn-draw');
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.min(box.w, box.h) * 0.3;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 72; i++) {
    const a = (2 * Math.PI * i) / 72;
    const rr = r * (1 + 0.16 * Math.cos(3 * a));
    await page.mouse.move(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('#facts')?.children.length > 0 && document.querySelector('#stage-busy').hidden,
    { timeout: 30000 },
  );
  await sleep(500);
  const custom = await page.evaluate(() => ({
    readout: document.querySelector('#readout').textContent.trim(),
    hash: location.hash.slice(0, 40),
    facts: [...document.querySelectorAll('#facts dt')].map((dt, i) => [
      dt.textContent,
      document.querySelectorAll('#facts dd')[i].textContent,
    ]),
  }));
  console.log('\n-- custom drawn shape --');
  console.log('readout:', custom.readout);
  console.log('url    :', custom.hash + '…');
  for (const [k, v] of custom.facts) console.log(`  ${k}: ${v}`);
  await shot(page, 'custom');

  if (!/Lowest mode/.test(custom.readout)) problems.push('drawn shape did not solve');
  if (!custom.hash.startsWith('#s=')) problems.push('drawn shape was not encoded into the URL');

  // Keyboard path.
  await page.focus('#board');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot(page, 'keyboard-strike');

  await browser.close();

  console.log('\n----------------------------------------');
  if (problems.length) {
    console.log(`FAILED with ${problems.length} problem(s):`);
    for (const p of problems) console.log('  - ' + p);
    process.exitCode = 1;
  } else {
    console.log('All browser checks passed.');
    console.log(`Screenshots in ${OUT}`);
  }
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exitCode = 1;
});
