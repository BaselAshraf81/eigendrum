/**
 * Builds the CrazyGames store assets: three cover images and two preview videos.
 *
 * Covers are rendered from tools/assets/cover.html, which is purpose-built art rather
 * than a screenshot, so the drum is large and the wordmark is legible at thumbnail
 * size. Videos are captured as timed screenshots of the real game and assembled by
 * ffmpeg using each frame's measured timestamp, because Puppeteer's screencast wrote
 * an empty file in this environment and per-frame durations keep the result honest.
 *
 *   node tools/serve.mjs &   then   node tools/store-assets.mjs [covers|videos]
 */

import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8080';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const only = process.argv[2];
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'],
});

// ------------------------------------------------------------------- 1. covers

const COVERS = [
  { variant: 'landscape', w: 1920, h: 1080, shape: 'star', mode: 8 },
  { variant: 'portrait', w: 800, h: 1200, shape: 'star', mode: 8 },
  { variant: 'square', w: 800, h: 800, shape: 'circle', mode: 6 },
];

if (!only || only === 'covers') {
  for (const c of COVERS) {
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 1 });
    await page.goto(
      `${BASE}/tools/assets/cover.html?variant=${c.variant}&shape=${c.shape}&mode=${c.mode}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForFunction(() => document.title === 'cover-ready', { timeout: 60000 });
    await sleep(250);
    const file = join(OUT, `cover-${c.variant}-${c.w}x${c.h}.png`);
    await page.screenshot({ path: file });
    console.log(`cover: ${c.variant} ${c.w}x${c.h}`);
    await page.close();
  }
}

// ------------------------------------------------------------------- 2. videos

/**
 * One take of real gameplay: pick a shape in free mode, strike it, switch to the sand
 * view, step a mode, then draw a shape by hand and hit it.
 *
 * Under 20 seconds, which is the platform's hard limit, and it opens on motion rather
 * than on a static menu because the cover is what the player has already seen.
 */
async function recordTake({ name, w, h, fps = 15 }) {
  const frames = join(OUT, `frames-${name}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/poki-ready-copy/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#home') && !document.querySelector('#home').hidden, {
    timeout: 40000,
  });

  const solved = () =>
    page.waitForFunction(
      () => document.querySelector('#solving').hidden && /Lowest mode/.test(document.querySelector('#brief').textContent),
      { timeout: 60000, polling: 80 },
    );
  const drumBox = () =>
    page.$eval('#drum', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

  // Get into free mode before recording, so the clip opens on the drum.
  await page.$eval('#way-free', (n) => n.click());
  await solved();
  await sleep(400);

  const shots = [];
  let n = 0;
  let capturing = true;
  const t0 = Date.now();
  const capture = (async () => {
    while (capturing) {
      const at = Date.now() - t0;
      const file = join(frames, `f${String(n++).padStart(4, '0')}.png`);
      try {
        await page.screenshot({ path: file });
        shots.push({ file, at });
      } catch {
        break;
      }
      await sleep(Math.max(0, 1000 / fps - (Date.now() - t0 - at)));
    }
  })();

  const strike = async (fx, fy) => {
    const b = await drumBox();
    await page.mouse.click(b.x + b.w * fx, b.y + b.h * fy);
  };

  // Beat 1: hit the shape that is already loaded.
  await strike(0.42, 0.44);
  await sleep(1700);

  // Beat 2: a spikier shape, struck again.
  await page.$$eval('#tray-shapes .chip', (chips) => {
    const star = chips.find((c) => c.textContent.trim() === 'star');
    (star || chips[chips.length - 1]).click();
  });
  await solved();
  await sleep(300);
  await strike(0.5, 0.36);
  await sleep(1600);

  // Beat 3: the sand view, which is the most distinctive frame in the game.
  await page.$eval('#btn-sand', (btn) => btn.click());
  await sleep(700);
  await page.$eval('#fig-next', (btn) => btn.click());
  await sleep(1500);
  await page.$eval('#fig-next', (btn) => btn.click());
  await sleep(1600);
  await page.$eval('#btn-sand', (btn) => btn.click());
  await sleep(400);

  // Beat 4: draw one by hand and hit it. This is the hook.
  await page.$eval('#btn-home', (btn) => btn.click());
  await sleep(350);
  await page.$eval('#way-draw', (btn) => btn.click());
  await sleep(500);
  {
    const b = await drumBox();
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const r = Math.min(b.w, b.h) * 0.3;
    const rAt = (t) => r * (1 + 0.22 * Math.sin(3 * t) + 0.08 * Math.cos(5 * t));
    const pt = (t) => [cx + rAt(t) * Math.cos(t), cy + rAt(t) * Math.sin(t)];
    await page.mouse.move(...pt(0));
    await page.mouse.down();
    for (let i = 1; i <= 84; i++) {
      await page.mouse.move(...pt((2 * Math.PI * i) / 84));
      if (i % 7 === 0) await sleep(12);
    }
    await page.mouse.up();
    await solved();
    await sleep(350);
    await strike(0.52, 0.42);
    await sleep(2000);
  }

  capturing = false;
  await capture;
  const totalMs = Date.now() - t0;
  await page.close();

  // Measured durations, so the assembled video runs at the speed it was captured.
  const list = shots
    .map((f, i) => {
      const next = shots[i + 1] ? shots[i + 1].at : totalMs;
      return `file '${f.file.replace(/\\/g, '/')}'\nduration ${Math.max(0.01, (next - f.at) / 1000).toFixed(4)}`;
    })
    .join('\n');
  const listFile = join(OUT, `frames-${name}.txt`);
  writeFileSync(listFile, `${list}\nfile '${shots.at(-1).file.replace(/\\/g, '/')}'\n`);

  const mp4 = join(OUT, `preview-${name}-${w}x${h}.mp4`);
  ff([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-movflags', '+faststart',
    '-t', '19.5',
    mp4,
  ]);
  rmSync(frames, { recursive: true, force: true });
  rmSync(listFile, { force: true });
  console.log(`video: ${name} ${w}x${h}, ${shots.length} frames, ${(totalMs / 1000).toFixed(1)}s captured`);
}

if (!only || only === 'videos') {
  await recordTake({ name: 'landscape', w: 1280, h: 720 });
  await recordTake({ name: 'portrait', w: 800, h: 1200 });
}

await browser.close();
if (existsSync(OUT)) console.log(`\nassets in ${OUT}`);
