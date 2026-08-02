/**
 * Regenerates the images the README embeds. Dev-only.
 *
 * Deliberately separate from tools/shots.mjs: those are throwaway review captures
 * in the gitignored .smoke/, whereas these are committed assets, so they need to be
 * reproducible on demand and small enough to live in the repo.
 *
 *   node tools/serve.mjs &   then   node tools/readme-shots.mjs
 */

import puppeteer from 'puppeteer';
import { mkdirSync, statSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = new URL('../docs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
});

const problems = [];
const page = await browser.newPage();
// 1.5x, not 2x: a README renders at roughly 900px of content width, so 1.5x is
// already past what any display can resolve, and 2x doubled the byte cost of the
// two full-interface images for nothing. Height fits the whole form gallery, so no
// chip row is left sliced off at the bottom edge.
await page.setViewport({ width: 1340, height: 940, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#facts')?.children.length > 0, {
  timeout: 30000,
});
await sleep(500);

const solved = () =>
  page.waitForFunction(() => document.querySelector('#solving').hidden, { timeout: 40000 });

const preset = async (id) => {
  await page.evaluate((wanted) => {
    [...document.querySelectorAll('#presets .form-chip')].find((c) => c.dataset.id === wanted).click();
  }, id);
  await solved();
  await sleep(400);
};

const boardBox = async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(60);
  return page.$eval('#board', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
};

const written = [];
async function shot(name, opts = {}) {
  const path = `${OUT}${name}.png`;
  await page.screenshot({ path, ...opts });
  written.push([`docs/${name}.png`, statSync(path).size]);
}

/** Just the drum, with a little air around it. */
async function shotBoard(name) {
  const b = await boardBox();
  const pad = 10;
  await shot(name, {
    clip: { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2 },
  });
}

// 1. The whole interface, mid-strike: the plate, the mixture the strike excited, and
//    the measurements. This is the one that has to say what the app is at a glance.
{
  const b = await boardBox();
  await page.mouse.click(b.x + b.w * 0.42, b.y + b.h * 0.44);
  await sleep(150);
  await shot('hero');
}

// 2. A high mode on a spiky shape, where the nodal lines are the whole point.
await preset('star');
await page.evaluate(() => document.querySelectorAll('#spectrum .mode-row')[8].click());
await sleep(450);
await shotBoard('nodal-lines');

// 3. The isospectral pair. Waits for the background partner solve, because that is
//    what puts the measured match line and the overlaid comb on screen. Without it
//    the image would be claiming something it does not show.
await page.evaluate(() => {
  [...document.querySelectorAll('#presets .form-chip')].find((c) => c.dataset.id === 'gww-a').click();
});
await page.waitForFunction(
  () => document.querySelector('#solving').hidden && document.querySelector('#kac .kac-match'),
  { timeout: 40000 },
);
await sleep(500);
await shot('kac-pair');

// 4. A freehand shape, solved. The promise of the whole project in one picture.
{
  await page.click('#btn-draw');
  const b = await boardBox();
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  // One radius function for every point including the first. Pressing down at a bare
  // radius and then moving with a lobed one leaves a genuine spike in the stroke.
  const rAt = (t) => Math.min(b.w, b.h) * (0.3 + 0.055 * Math.sin(3 * t) + 0.03 * Math.cos(5 * t));
  const pt = (t) => [cx + rAt(t) * Math.cos(t), cy + rAt(t) * Math.sin(t)];
  await page.mouse.move(...pt(0));
  await page.mouse.down();
  for (let i = 1; i <= 96; i++) await page.mouse.move(...pt((2 * Math.PI * i) / 96));
  await page.mouse.up();
  await solved();
  await sleep(300);
  const box = await boardBox();
  await page.mouse.click(box.x + box.w * 0.55, box.y + box.h * 0.4);
  await sleep(150);
  await shotBoard('freehand');
}

await browser.close();

for (const [name, bytes] of written) console.log(`${name.padEnd(24)} ${(bytes / 1024).toFixed(0)} kB`);
const total = written.reduce((s, [, b]) => s + b, 0);
console.log(`${'total'.padEnd(24)} ${(total / 1024).toFixed(0)} kB`);

if (problems.length) {
  console.error('\nproblems while capturing:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
