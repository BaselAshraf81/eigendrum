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
    busyHidden: document.querySelector('#solving').hidden,
  }));
  console.log('\n-- initial load (circle) --');
  console.log('readout :', first.readout);
  console.log('modes   :', first.modeRows);
  console.log('busy hidden:', first.busyHidden);
  for (const [k, v] of first.facts) console.log(`  ${k}: ${v}`);
  await shot(page, 'circle');

  if (first.modeRows === 0) problems.push('no modes were listed after solving');
  if (!/Lowest mode/.test(first.readout)) problems.push('readout did not describe the drum');

  // Every listed mode has to be pressable, because pressing one plays it. The
  // ledger used to be sticky over the foot of this column, which left the last five
  // rows painted over: elementFromPoint on mode 16 returned a ledger term, so the
  // app offered sixteen modes and let you reach eleven. Counting rows in the DOM
  // does not catch that; hit-testing does.
  const reach = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#spectrum .mode-row')];
    const led = document.querySelector('.ledger').getBoundingClientRect();
    const unclickable = [];
    rows.forEach((row, i) => {
      row.scrollIntoView({ block: 'nearest' });
      const b = row.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + 8, b.top + b.height / 2);
      if (!hit || hit.closest('.mode-row') !== row) unclickable.push(i + 1);
    });
    return {
      unclickable,
      ledgerVisible: led.top >= 0 && led.bottom <= window.innerHeight + 0.5,
    };
  });
  console.log('unreachable mode rows:', reach.unclickable.length ? reach.unclickable : 'none');
  if (reach.unclickable.length) {
    problems.push(`mode rows not pressable: ${reach.unclickable.join(', ')}`);
  }
  if (!reach.ledgerVisible) problems.push('the measurements panel is off screen');

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

  // Clicking a control can scroll the page, which moves the canvas out from under
  // any coordinates captured earlier. Always re-derive the box with the drum
  // scrolled into view before aiming at it.
  const boardBox = async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(60);
    return page.$eval('#board', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  };

  // At rest the drum must be completely still. Nothing is vibrating, so nothing
  // may move or change colour until it is struck. (Earlier the idle view
  // oscillated the selected mode, which flipped the whole shape between blue and
  // amber forever and displaced the mesh with no hit behind it.)
  const restSample = () =>
    page.evaluate(() => {
      const c = document.querySelector('#board');
      const s = 160;
      return c
        .getContext('2d')
        .getImageData((c.width - s) / 2, (c.height - s) / 2, s, s)
        .data.join();
    });
  const rest1 = await restSample();
  await sleep(400);
  const rest2 = await restSample();
  console.log('\n-- at rest --');
  console.log('canvas identical across 400ms:', rest1 === rest2);
  if (rest1 !== rest2) {
    problems.push('the drum animates at rest, with nothing struck');
  }

  // Strike it.
  let box = await boardBox();
  await page.mouse.click(box.x + box.w * 0.42, box.y + box.h * 0.45);
  await sleep(700);
  const struck = await page.evaluate(() => ({
    hintHidden: document.querySelector('#prompt').hidden,
  }));
  console.log('\n-- after strike --');
  console.log('hint hidden (means struck):', struck.hintHidden);
  if (!struck.hintHidden) problems.push('striking the drum had no visible effect');

  // A strike has to show its mixture. This is the one thing that connects the mode
  // list to the drum — a strike is not one row, it is all of them at once in these
  // proportions — so if every rule came out the same length the interface would
  // have stopped explaining the physics.
  const mix = await page.evaluate(() => ({
    drives: [...document.querySelectorAll('#spectrum .mode-drive')].map((b) => b.style.transform),
    mutes: document.querySelectorAll('#spectrum .mode-row.is-mute').length,
    readout: document.querySelector('#readout').textContent.trim(),
  }));
  const distinct = new Set(mix.drives).size;
  console.log(`excitation: ${distinct} distinct of ${mix.drives.length}, silent modes: ${mix.mutes}`);
  console.log('readout:', mix.readout);
  if (distinct < 4) problems.push('a strike did not show a per-mode mixture');
  if (mix.drives.some((t) => !/^scaleX\(/.test(t))) {
    problems.push('an excitation rule was not scaled');
  }
  // The words and the marks must agree: the longest rule has to be the mode the
  // readout calls loudest, or one of the two is lying about the same strike.
  const scaleOf = (t) => {
    const m = /scaleX\(([-\d.eE+]+)\)/.exec(t);
    return m ? parseFloat(m[1]) : NaN;
  };
  const mixScales = mix.drives.map(scaleOf);
  let argmax = 0;
  for (let i = 1; i < mixScales.length; i++) if (mixScales[i] > mixScales[argmax]) argmax = i;
  const named = Number(/Loudest here is\s*mode\s*(\d+)/i.exec(mix.readout)?.[1] || 0);
  console.log(`loudest: readout says mode ${named}, longest rule is mode ${argmax + 1}`);
  if (named !== argmax + 1) {
    problems.push(`readout names mode ${named} loudest but the longest rule is mode ${argmax + 1}`);
  }
  if (!/Loudest here is\s*mode\s*\d+/i.test(mix.readout)) {
    problems.push('the strike readout did not name the loudest mode');
  }
  await shot(page, 'struck');

  // Selecting a higher mode should redraw and update the readout.
  await page.evaluate(() => document.querySelectorAll('#spectrum .mode-row')[4].click());
  await sleep(500);
  const modeText = await page.$eval('#readout', (n) => n.textContent.trim());
  console.log('\n-- mode 5 selected --\nreadout:', modeText);
  if (!/Mode\s*5/.test(modeText)) problems.push('selecting a mode did not update the readout');

  // Picking a mode sounds that mode alone — something no mallet can do, and the
  // only way to hear what one eigenvalue is. Exactly one rule at full length, the
  // rest at the zero stub.
  const alone = await page.evaluate(() => ({
    drives: [...document.querySelectorAll('#spectrum .mode-drive')].map((b) => b.style.transform),
    mutes: document.querySelectorAll('#spectrum .mode-row.is-mute').length,
    readout: document.querySelector('#readout').textContent,
  }));
  // Read the scale numerically: the CSSOM serialises scaleX(1.0000) back as scaleX(1).
  const scales = alone.drives.map((t) => {
    const m = /scaleX\(([-\d.eE+]+)\)/.exec(t);
    return m ? parseFloat(m[1]) : NaN;
  });
  const full = scales.filter((s) => s > 0.999).length;
  console.log(`mode alone -> ${full} full rule(s), ${alone.mutes} silent of ${scales.length}`);
  if (full !== 1) problems.push('selecting a mode did not sound it on its own');
  if (alone.mutes !== scales.length - 1) problems.push('a lone mode did not silence the others');
  if (!/by itself/.test(alone.readout)) {
    problems.push('the readout did not say that one mode alone is not something a strike can do');
  }
  await shot(page, 'mode5');

  // The isospectral pair: switch to Kac drum I, record its spectrum, switch to
  // II, and compare in the browser.
  await page.evaluate(() => {
    [...document.querySelectorAll('#presets .form-chip')].find((c) => c.dataset.id === 'gww-a').click();
  });
  // The partner drum is solved in the background, so wait for the measured match
  // line rather than for the main solve alone.
  await page.waitForFunction(
    () =>
      document.querySelector('#solving').hidden &&
      !document.querySelector('#kac').hidden &&
      document.querySelector('#kac .kac-match'),
    { timeout: 40000 },
  );
  await sleep(300);
  const specA = await page.$$eval('#spectrum .mode-hz', (n) => n.map((x) => x.textContent));

  const kacProof = await page.evaluate(() => ({
    match: document.querySelector('#kac .kac-match')?.textContent || '',
    ownTicks: document.querySelectorAll('#comb-axis .comb-tick:not(.is-partner)').length,
    partnerTicks: document.querySelectorAll('#comb-axis .comb-tick.is-partner').length,
    caption: document.querySelector('#comb-caption').textContent,
  }));
  console.log('\n-- isospectral proof shown in the UI --');
  console.log('match line   :', kacProof.match);
  console.log('comb ticks   :', kacProof.ownTicks, 'own +', kacProof.partnerTicks, 'partner');
  if (!/agree/.test(kacProof.match)) {
    problems.push('the Kac callout did not state a measured agreement');
  }
  if (kacProof.partnerTicks !== kacProof.ownTicks) {
    problems.push(
      `comb should overlay the partner spectrum: ${kacProof.ownTicks} own vs ${kacProof.partnerTicks} partner`,
    );
  }
  await shot(page, 'kac-a');

  await page.click('#btn-kac-swap');
  await page.waitForFunction(() => document.querySelector('#solving').hidden, { timeout: 30000 });
  await sleep(500);
  const specB = await page.$$eval('#spectrum .mode-hz', (n) => n.map((x) => x.textContent));
  await shot(page, 'kac-b');

  console.log('\n-- isospectral pair, as displayed in the browser --');
  console.log('drum I :', specA.slice(0, 6).join('  '));
  console.log('drum II:', specB.slice(0, 6).join('  '));
  if (specA.join('|') !== specB.join('|')) {
    problems.push('the two Kac drums displayed different spectra in the UI');
  }

  // Draw a custom shape: enable drawing and drag a rough three-lobed outline.
  await page.click('#btn-draw');
  box = await boardBox();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.min(box.w, box.h) * 0.3;
  // Use the same radius formula for the initial press as for every move —
  // otherwise the synthetic stroke really does contain a spike at its start, and
  // the app is right to reproduce it.
  const lobe = (a) => r * (1 + 0.16 * Math.cos(3 * a));
  await page.mouse.move(cx + lobe(0), cy);
  await page.mouse.down();
  for (let i = 1; i <= 72; i++) {
    const a = (2 * Math.PI * i) / 72;
    await page.mouse.move(cx + lobe(a) * Math.cos(a), cy + lobe(a) * Math.sin(a));
  }
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('#facts')?.children.length > 0 && document.querySelector('#solving').hidden,
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

  // Rapid strikes must not stall the animation. This is a regression test: the
  // synthesiser used to render each strike with per-sample Math.sin/Math.exp on
  // the main thread, so a fast series of hits blocked requestAnimationFrame and
  // the drum froze while the already-buffered audio kept playing.
  await page.evaluate(() => {
    window.__frames = 0;
    const tick = () => {
      window.__frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Sample a patch at the centre of the canvas: the corners are empty background
  // in every frame, so comparing those would prove nothing.
  const samplePatch = () =>
    page.evaluate(() => {
      const c = document.querySelector('#board');
      const s = 140;
      return c
        .getContext('2d')
        .getImageData((c.width - s) / 2, (c.height - s) / 2, s, s)
        .data.join();
    });

  const before = await samplePatch();

  box = await boardBox();
  const t0 = Date.now();
  for (let i = 0; i < 14; i++) {
    const a = (2 * Math.PI * i) / 14;
    await page.mouse.click(
      box.x + box.w / 2 + Math.cos(a) * box.w * 0.12,
      box.y + box.h / 2 + Math.sin(a) * box.h * 0.12,
    );
  }
  const clickMs = Date.now() - t0;
  await sleep(1000);

  const frames = await page.evaluate(() => window.__frames);
  const after = await samplePatch();
  console.log(`\n-- rapid strike stress (14 hits in ${clickMs} ms) --`);
  console.log('frames rendered in the following second:', frames);
  if (frames < 30) {
    problems.push(`animation stalled under rapid strikes: only ${frames} frames in 1s`);
  }
  if (after === before) problems.push('canvas stopped changing under rapid strikes');

  // And the drum must still be moving frame to frame, not stuck on one image.
  const a = await samplePatch();
  await sleep(120);
  const b = await samplePatch();
  if (a === b) problems.push('the drum is not animating between frames');
  await shot(page, 'stress');

  // The finite element mesh overlay must ride the displacement field rather than
  // sit at rest positions, so it visibly flexes while the drum rings.
  await page.evaluate(() => document.querySelector('#ctl-mesh').click());
  box = await boardBox();
  await page.mouse.click(box.x + box.w * 0.38, box.y + box.h * 0.4);
  await sleep(90);
  const mesh1 = await samplePatch();
  await sleep(130);
  const mesh2 = await samplePatch();
  if (mesh1 === mesh2) problems.push('the mesh overlay is static while the drum rings');
  await shot(page, 'mesh-flexing');
  console.log('\n-- mesh overlay --');
  console.log('mesh moves between frames:', mesh1 !== mesh2);

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
