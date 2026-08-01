/**
 * Design inspection captures. Dev-only.
 *
 * One batched round: every state worth judging, desktop and mobile, written to
 * .smoke/shot-*.png. Used for the visual review and handed to the finish
 * reviewer, which has no browser of its own.
 *
 *   node tools/serve.mjs &   then   node tools/shots.mjs
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = new URL('../.smoke/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
});

const problems = [];

async function open(width, height, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#facts')?.children.length > 0, {
    timeout: 30000,
  });
  await sleep(500);
  return page;
}

const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}shot-${name}.png`, ...opts });

const boardBox = async (page) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(60);
  return page.$eval('#board', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
};

// ------------------------------------------------------------------- desktop

{
  const page = await open(1512, 950);
  await shot(page, '01-desktop-rest');

  let box = await boardBox(page);
  await page.mouse.click(box.x + box.w * 0.42, box.y + box.h * 0.44);
  await sleep(140);
  await shot(page, '02-desktop-struck');

  // A higher mode, where the nodal lines are the whole story.
  await page.evaluate(() => document.querySelectorAll('#spectrum .mode-row')[7].click());
  await sleep(400);
  await shot(page, '03-desktop-mode8');

  // Mesh overlay on, mid-ring.
  await page.evaluate(() => document.querySelector('#ctl-mesh').click());
  box = await boardBox(page);
  await page.mouse.click(box.x + box.w * 0.38, box.y + box.h * 0.42);
  await sleep(120);
  await shot(page, '04-desktop-mesh');
  await page.evaluate(() => document.querySelector('#ctl-mesh').click());

  // The isospectral pair.
  await page.evaluate(() => {
    [...document.querySelectorAll('#presets .form-chip')].find((c) => c.dataset.id === 'gww-a').click();
  });
  await page.waitForFunction(() => document.querySelector('#solving').hidden, { timeout: 30000 });
  await sleep(500);
  await shot(page, '05-desktop-kac');

  // A shape with spikes, the case that used to show seams.
  await page.evaluate(() => {
    [...document.querySelectorAll('#presets .form-chip')].find((c) => c.dataset.id === 'star').click();
  });
  await page.waitForFunction(() => document.querySelector('#solving').hidden, { timeout: 30000 });
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('#spectrum .mode-row')[5].click());
  await sleep(400);
  await shot(page, '06-desktop-star');

  // Drawing in progress.
  await page.click('#btn-draw');
  box = await boardBox(page);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.min(box.w, box.h) * 0.3;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 46; i++) {
    const a = (2 * Math.PI * i) / 60;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  await shot(page, '07-desktop-drawing');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#solving').hidden, { timeout: 30000 });
  await sleep(400);
  await shot(page, '08-desktop-drawn');

  // The notice state: an outline that crosses itself has no inside.
  await page.click('#btn-draw');
  box = await boardBox(page);
  await page.mouse.move(cx - r, cy - r);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    const t = (2 * Math.PI * i) / 60;
    await page.mouse.move(cx + r * Math.sin(2 * t), cy + r * Math.sin(t));
  }
  await page.mouse.up();
  await sleep(400);
  await shot(page, '09-desktop-notice');

  // The explainer.
  await page.evaluate(() => document.querySelector('#btn-about').click());
  await sleep(400);
  await shot(page, '10-desktop-about');

  await page.close();
}

// -------------------------------------------------------------------- mobile

{
  const page = await open(390, 844, true);
  await shot(page, '20-phone-top');
  await shot(page, '21-phone-full', { fullPage: true });

  const box = await boardBox(page);
  await page.mouse.click(box.x + box.w / 2, box.y + box.h * 0.45);
  await sleep(140);
  await shot(page, '22-phone-struck');

  await page.evaluate(() => {
    document.querySelector('#bench').scrollIntoView({ block: 'center' });
  });
  await sleep(300);
  await shot(page, '23-phone-bench');

  await page.evaluate(() => document.querySelector('#btn-about').click());
  await sleep(400);
  await shot(page, '24-phone-about');
  await page.close();
}

// ------------------------------------------------------------------- tablet

{
  const page = await open(834, 1112, true);
  await shot(page, '30-tablet-full', { fullPage: true });
  await page.close();
}

await browser.close();

if (problems.length) {
  console.log('problems during capture:');
  for (const p of [...new Set(problems)]) console.log('  - ' + p);
  process.exitCode = 1;
} else {
  console.log(`captured to ${OUT}`);
}
