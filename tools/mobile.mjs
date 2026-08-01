/**
 * Narrow-viewport check. Dev-only.
 *
 * Confirms the layout stacks, nothing overflows horizontally, the canvas stays
 * usable, and a strike still works with touch-sized targets.
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../.smoke/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await puppeteer.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
});

for (const [name, width, height] of [
  ['phone', 390, 844],
  ['tablet', 820, 1180],
]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${name} console.error: ${m.text()}`);
  });

  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#facts')?.children.length > 0, {
    timeout: 30000,
  });
  await sleep(500);

  const metrics = await page.evaluate(() => {
    const board = document.querySelector('#board');
    const r = board.getBoundingClientRect();
    return {
      docWidth: document.documentElement.scrollWidth,
      viewWidth: window.innerWidth,
      boardWidth: r.width,
      boardHeight: r.height,
      panelStacked:
        getComputedStyle(document.querySelector('main')).gridTemplateColumns.split(' ').length === 1,
    };
  });
  console.log(`\n${name} (${width}x${height}):`, metrics);

  if (metrics.docWidth > metrics.viewWidth + 1) {
    problems.push(`${name}: horizontal overflow (${metrics.docWidth} > ${metrics.viewWidth})`);
  }
  if (metrics.boardWidth < 200) problems.push(`${name}: canvas too small (${metrics.boardWidth})`);

  // Strike via touch.
  const box = await page.$eval('#board', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(600);
  const struck = await page.$eval('#prompt', (n) => n.hidden);
  if (!struck) problems.push(`${name}: tapping the drum did nothing`);

  await page.screenshot({ path: `${OUT}mobile-${name}.png`, fullPage: false });
  await page.close();
}

await browser.close();

if (problems.length) {
  console.log('\nFAILED:');
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
} else {
  console.log('\nNarrow-viewport checks passed.');
}
