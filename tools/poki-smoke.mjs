/**
 * Browser test for the game, plus an audit of the platform requirements.
 *
 * Two deliberate choices, both learned the hard way:
 *
 * - The no-external-requests rule is checked by **reading the source**, not by
 *   watching one page load. A static scan proves no off-origin reference exists
 *   anywhere in the shipped build; observing a single run only proves none fired
 *   that time. It is also instant.
 * - Gameplay is driven by the **keyboard**. Puppeteer request interception was used
 *   at first to block the ad stack, and intercepting a twenty-module graph plus a
 *   module worker deadlocked half the runs. Keyboard input cannot be stolen by an
 *   ad overlay, so the test needs neither interception nor a live ad server.
 *
 *   node tools/serve.mjs &   then   node tools/poki-smoke.mjs
 */

import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const GAME = join(ROOT, 'poki-ready-copy');
const BASE = process.env.BASE || 'http://localhost:8080/poki-ready-copy/index.html';
const OUT = join(ROOT, '.smoke');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const problems = [];
const note = (s) => console.log(s);

// ------------------------------------------------------- 1. static source audit

{
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|css|html)$/.test(name)) files.push(full);
    }
  })(GAME);

  // A portal's own SDK is the only permitted off-origin reference, and only the one
  // this build is targeted at is actually injected. Both are listed because
  // platform.js carries an adapter for each; game/target.js decides which loads.
  const ALLOWED = /^https:\/\/(sdk\.crazygames\.com|game-cdn\.poki\.com)\//;
  let refs = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) {
      const url = m[0];
      // XML namespaces are identifiers, not fetches.
      if (url.startsWith('http://www.w3.org/')) continue;
      refs++;
      if (!ALLOWED.test(url)) {
        problems.push(`external reference in ${file.replace(GAME, '')}: ${url}`);
      }
    }
    // Matches actual API usage (localStorage.getItem(...), Object.defineProperty on
    // it, etc.), not the bare word appearing in a comment or docblock, which platform.js
    // legitimately does when explaining why it defers to store.js.
    if (/localStorage\s*[.[]/.test(text) && !/store\.js$/.test(file)) {
      problems.push(`${file.replace(GAME, '')} touches localStorage directly; it must go through store.js`);
    }
  }

  let bytes = 0;
  for (const f of files) bytes += statSync(f).size;
  note(`source audit: ${files.length} files, ${(bytes / 1024).toFixed(0)} kB, ${refs} off-origin reference(s), all allowed`);
}

// -------------------------------------------------------------- 2. the browser

const VIEWS = [
  { name: '640x360', width: 640, height: 360 },
  { name: '836x470', width: 836, height: 470 },
  { name: '1031x580', width: 1031, height: 580 },
  { name: 'phone-portrait', width: 390, height: 844, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

/**
 * Ready means solved, drawn, and actually reachable by a pointer.
 *
 * The reachability half matters: a real commercial break puts a full-screen ad
 * iframe over the game, and without this the suite measured the ad's geometry and
 * screenshotted a Drive Mad promo instead of the drum.
 */
/** The menu is the first playable surface, so every path in starts by choosing one. */
const enter = async (page, way) => {
  await page.waitForFunction(() => !document.querySelector('#home').hidden, { timeout: 30000, polling: 60 });
  await page.$eval(`#way-${way}`, (n) => n.click());
};

const solved = (page, timeout = 45000) =>
  page.waitForFunction(
    () =>
      document.querySelector('#solving').hidden === true &&
      /Lowest mode/.test(document.querySelector('#brief').textContent),
    { timeout, polling: 80 },
  );

const ready = (page, timeout = 45000) =>
  page.waitForFunction(
    () => {
      if (document.querySelectorAll('#progress .pip').length === 0) return false;
      if (document.querySelector('#solving').hidden !== true) return false;
      const c = document.querySelector('#drum');
      const b = c.getBoundingClientRect();
      if (b.width < 10) return false;
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return top === c;
    },
    { timeout, polling: 100 },
  );

async function open({ width, height, mobile = false, killStorage = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const errors = [];
  page.on('pageerror', (e) => errors.push({ text: e.message, stack: e.stack || '' }));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push({ text: m.text(), stack: m.stackTrace?.().map?.((f) => f.url).join(' ') || '' });
    }
  });
  // Never load a real portal SDK during tests. An advertising stack costs seconds of
  // network, serves overlays that steal the pointer, and makes the suite depend on a
  // third party being up. Absence is a supported production state, so this is a path
  // that has to work anyway.
  await page.evaluateOnNewDocument(() => {
    window.__noPortal = true;
  });

  if (killStorage) {
    // Stand in for a private window, where touching localStorage throws.
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    });
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return { page, errors };
}

/**
 * Errors from the platform's SDK and its ad stack are not this game's to fix.
 *
 * Attributed by where the stack points, not by matching words in the message. A
 * keyword blocklist wrongly blamed the game for a minified `reading 'h'` thrown
 * inside the SDK under mobile emulation, which names nothing recognisable.
 */
const ours = (errors) =>
  errors
    .filter((e) => {
      const where = `${e.stack} ${e.text}`;
      if (/poki\.(com|io)|crazygames\.com|doubleclick|googlesyndication|adtrafficquality|gpt\.js|ima3/i.test(where))
        return false;
      if (/ERR_|net::|Failed to load resource/i.test(e.text)) return false;
      // Anything with no frame in our own files cannot be attributed to us.
      return /poki-ready-copy\/(game|engine|styles)\//.test(e.stack) || e.stack === '';
    })
    .map((e) => e.text);

for (const view of VIEWS) {
  const { page, errors } = await open(view);
  try {
    await enter(page, 'play');
    await ready(page);
  } catch {
    const why = await page.evaluate(() => ({
      solvingHidden: document.querySelector('#solving')?.hidden,
      pips: document.querySelectorAll('#progress .pip').length,
      brief: document.querySelector('#brief')?.textContent?.slice(0, 60),
    }));
    problems.push(`${view.name}: never became ready ${JSON.stringify(why)}`);
    if (ours(errors).length) problems.push(`${view.name}: ${ours(errors)[0]}`);
    await page.close();
    continue;
  }
  await sleep(140);

  const geo = await page.evaluate(() => {
    const box = (s) => {
      const b = document.querySelector(s).getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      doc: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
      view: { w: window.innerWidth, h: window.innerHeight },
      target: box('#target'),
      drum: box('#drum'),
      strip: document.querySelectorAll('#strip .cell').length,
      brief: box('#brief').w > 0,
    };
  });

  // The thesis: reference diagram and playable drum at equal scale. If they differ,
  // the composition has quietly become a caption plus a play area.
  if (Math.abs(geo.target.w - geo.drum.w) > 2 || Math.abs(geo.target.h - geo.drum.h) > 2) {
    problems.push(`${view.name}: plates unequal (${geo.target.w}x${geo.target.h} vs ${geo.drum.w}x${geo.drum.h})`);
  }
  if (geo.doc.h > geo.view.h + 1 || geo.doc.w > geo.view.w + 1) {
    problems.push(`${view.name}: stage overflows viewport (${geo.doc.w}x${geo.doc.h} in ${geo.view.w}x${geo.view.h})`);
  }
  if (geo.strip !== 12) problems.push(`${view.name}: strip has ${geo.strip} cells`);
  if (!geo.brief) problems.push(`${view.name}: instruction band not visible`);
  if (geo.drum.w < 90) problems.push(`${view.name}: drum only ${geo.drum.w}px, too small to aim at`);
  if (ours(errors).length) problems.push(`${view.name}: ${ours(errors)[0]}`);

  note(
    `${view.name.padEnd(16)} plates ${String(geo.drum.w).padStart(4)}px  doc ${geo.doc.w}x${geo.doc.h}  own-errors ${ours(errors).length}`,
  );
  await page.screenshot({ path: join(OUT, `poki-${view.name}.png`) });
  await page.close();
}

// ------------------------------------------------------------- 3. play a level

{
  const { page, errors } = await open(VIEWS[2]);
  await enter(page, 'play');
  await ready(page);
  await sleep(120);

  // Keyboard throughout, so no ad overlay can intercept the input. Poki asks for
  // alternative control schemes anyway, so this is a requirement being tested rather
  // than a workaround. Enter charges on keydown and strikes on keyup, and `press`
  // releases immediately, which is the softest available hit.
  await page.focus('#drum');

  const readState = () =>
    page.evaluate(() => ({
      count: document.querySelector('#level-count').textContent.trim(),
      brief: document.querySelector('#brief').textContent.trim(),
      verdict: document.querySelector('#verdict').textContent.trim(),
      shown: !document.querySelector('#verdict').hidden,
      stars: document.querySelectorAll('#verdict .star.is-on').length,
      woke: [...document.querySelectorAll('#strip .cell-fill')].filter(
        (f) => parseFloat((/scaleX\(([-\d.eE+]+)\)/.exec(f.style.transform) || [])[1] || 0) > 0.02,
      ).length,
      next: !document.querySelector('#btn-next').hidden,
    }));

  const nextLevel = async (expect) => {
    await page.$eval('#btn-next', (n) => n.click());
    try {
      await page.waitForFunction(
        (want) => document.querySelector('#level-count').textContent.trim() === want,
        { timeout: 30000, polling: 60 },
        expect,
      );
      await ready(page, 30000);
      await page.focus('#drum');
      return true;
    } catch {
      problems.push(`advancing did not reach ${expect}`);
      return false;
    }
  };

  // The three opening beats teach by consequence and cannot be failed. Each one is
  // walked here, because they are the only part of the game a new player must get
  // through before anything else makes sense.
  await page.keyboard.press('Enter');
  await sleep(280);
  let s = await readState();
  note(`\ntutorial 1 (${s.count}): ${s.stars} star(s), ${s.woke} modes woke`);
  if (s.stars === 0) problems.push('the first tutorial beat could not be passed by tapping the drum');
  if (s.woke < 2) problems.push('a strike woke fewer than two modes, so the strip is not reporting');

  if (await nextLevel('2 / 6')) {
    // "Somewhere else" only passes when the mixture genuinely differs, so aim well
    // away from the centre before striking.
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await sleep(280);
    s = await readState();
    note(`tutorial 2 (${s.count}): ${s.stars} star(s) - ${s.verdict.slice(0, 68)}`);
    if (s.stars === 0) problems.push('striking a different spot did not satisfy the "somewhere else" beat');
  }

  if (await nextLevel('3 / 6')) {
    await page.keyboard.press('Enter'); // instant release, so the softest force
    await sleep(280);
    s = await readState();
    note(`tutorial 3 (${s.count}): ${s.stars} star(s) - ${s.verdict.slice(0, 68)}`);
    if (s.stars === 0) problems.push('a light tap did not satisfy the "gently" beat');
  }

  // The first scored level. This is where a measured number has to appear.
  if (await nextLevel('4 / 6')) {
    await page.keyboard.press('Enter');
    await sleep(300);
    s = await readState();
    note(`scored (${s.count}): ${s.stars} star(s), ${s.woke} modes woke`);
    note(`verdict: ${s.verdict}`);
    if (!s.shown) problems.push('a scored strike produced no verdict');
    if (!/%/.test(s.verdict)) problems.push('the verdict quoted no measured number');
    if (!/mode/i.test(s.brief)) problems.push('the first scored level never introduces the word "mode"');
  }
  const after = await readState();

  // Wait for the condition, never for a duration. Both of these assertions failed
  // once against a fixed sleep while the app was behaving correctly, which is a
  // false alarm that costs more to chase than the test is worth.
  // Dispatched directly rather than through page.click, which adds scrolling and
  // hit-testing of its own. That the buttons are genuinely on top and reachable is
  // asserted separately; here the subject is the handler and the state behind it.
  await page.$eval('#btn-hint', (n) => n.click());
  try {
    await page.waitForFunction(() => /score full/.test(document.querySelector('#drum-note').textContent), {
      timeout: 5000,
      polling: 50,
    });
  } catch {
    problems.push('the hint did not announce itself');
  }
  await page.screenshot({ path: join(OUT, 'poki-play-hinted.png') });

  if (!after.next) problems.push('a passed level offered no way forward');
  if (ours(errors).length) problems.push(`play: ${ours(errors)[0]}`);
  await page.close();
}

// ------------------------------------------------- 3b. draw mode and free mode

{
  const { page, errors } = await open(VIEWS[2]);
  await enter(page, 'draw');
  await sleep(300);

  // Trace a lobed closed loop. One radius function for every point including the
  // first: pressing down at a bare radius and then moving with a lobed one leaves a
  // genuine spike in the stroke, which this repo has already been fooled by once.
  const box = await page.$eval('#drum', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rAt = (t) => Math.min(box.w, box.h) * (0.3 + 0.05 * Math.sin(3 * t));
  await page.mouse.move(cx + rAt(0), cy);
  await page.mouse.down();
  for (let i = 1; i <= 84; i++) {
    const t = (2 * Math.PI * i) / 84;
    await page.mouse.move(cx + rAt(t) * Math.cos(t), cy + rAt(t) * Math.sin(t));
  }
  await page.mouse.up();

  let drew = true;
  try {
    await solved(page);
  } catch {
    drew = false;
    problems.push('a drawn outline never solved');
  }
  if (drew) {
    const said = await page.$eval('#brief', (n) => n.textContent);
    note(`\ndrawn: ${said}`);
    if (!/Hz/.test(said)) problems.push('a drawn drum reported no frequency');
    await page.mouse.click(cx + box.w * 0.08, cy - box.h * 0.06);
    await sleep(300);
    const woke = await page.$$eval('#strip .cell-fill', (f) =>
      f.filter((x) => parseFloat((/scaleX\(([-\d.eE+]+)\)/.exec(x.style.transform) || [])[1] || 0) > 0.02).length,
    );
    note(`a strike on the drawn drum woke ${woke} modes`);
    if (woke < 2) problems.push('striking a drawn drum woke almost nothing');
    await page.screenshot({ path: join(OUT, 'poki-draw.png') });
  }

  // Free mode: the whole gallery, the tools, and the sand view.
  await page.$eval('#btn-home', (n) => n.click());
  await enter(page, 'free');
  try {
    await solved(page);
  } catch {
    problems.push('free mode never solved its first shape');
  }
  const free = await page.evaluate(() => ({
    shapes: [...document.querySelectorAll('#tray-shapes .chip')].map((n) => n.textContent),
    mallets: [...document.querySelectorAll('#tray-mallets .chip')].map((n) => n.textContent),
    targetHidden: document.querySelector('#cell-target').hidden,
    brief: document.querySelector('#brief').textContent,
  }));
  note(`free: ${free.shapes.length} shapes, ${free.mallets.length} mallets, second plate hidden=${free.targetHidden}`);
  if (free.shapes.length < 10) problems.push(`free mode offers only ${free.shapes.length} shapes`);
  if (free.mallets.length !== 3) problems.push(`free mode offers ${free.mallets.length} mallets, expected 3`);
  if (!free.targetHidden) problems.push('free mode still shows the comparison plate');
  if (!/Hz/.test(free.brief)) problems.push('free mode reported no frequency');

  // Sand is the Chladni view: it must actually change what is drawn.
  await page.mouse.click(cx, cy - box.h * 0.05);
  await sleep(320);
  const before = await page.evaluate(() => {
    const c = document.querySelector('#drum');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 1009) h = (h * 31 + d[i]) | 0;
    return h;
  });
  await page.$eval('#btn-sand', (n) => n.click());
  await sleep(320);
  const sandOn = await page.$eval('#btn-sand', (n) => n.getAttribute('aria-pressed'));
  const afterSand = await page.evaluate(() => {
    const c = document.querySelector('#drum');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 1009) h = (h * 31 + d[i]) | 0;
    return h;
  });
  note(`sand pressed=${sandOn}, plate changed=${before !== afterSand}`);
  if (sandOn !== 'true') problems.push('the sand control did not engage');
  if (before === afterSand) problems.push('turning sand on changed nothing on the plate');
  await page.screenshot({ path: join(OUT, 'poki-free-sand.png') });

  if (ours(errors).length) problems.push(`sandbox: ${ours(errors)[0]}`);
  await page.close();
}

// --------------------------------------------------------- 4. private browsing

{
  const { page, errors } = await open({ ...VIEWS[2], killStorage: true });
  let ok = true;
  try {
    await enter(page, 'play');
    await ready(page);
  } catch {
    ok = false;
  }
  if (!ok) problems.push('incognito: the game did not become playable');
  else {
    await page.focus('#drum');
    await page.keyboard.press('Enter');
    await sleep(240);
    if (await page.evaluate(() => document.querySelector('#verdict').hidden)) {
      problems.push('incognito: could not score a strike');
    }
  }
  const fatal = ours(errors).filter((e) => !/SecurityError|denied/i.test(e));
  note(`incognito (localStorage throws)  playable=${ok} own-errors=${fatal.length}`);
  if (fatal.length) problems.push(`incognito: ${fatal[0]}`);
  await page.close();
}

await browser.close();

note('');
if (problems.length) {
  console.error(`FAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
note('All Poki checks passed.');
