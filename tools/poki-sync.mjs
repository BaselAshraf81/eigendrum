/**
 * Vendors the verified engine into poki-ready-copy/engine/.
 *
 * Why vendor at all: a Poki submission is a self-contained bundle. Anything
 * outside the uploaded folder does not exist, so `../src/...` is not available.
 *
 * Why generate rather than hand-copy: the accuracy claims in this repo are only
 * true of *this* solver. A second, hand-maintained copy would drift, and the
 * moment it drifted the game would be making claims that the tests no longer
 * check. So the copy is byte-identical, produced by this script, and verified by
 * `--check`, which is wired into the test run.
 *
 * Why the directory structure is mirrored: every module imports its neighbours by
 * relative path (`../geom/polygon.js`). Preserving the layout means not one byte
 * has to be rewritten, which is what makes byte-identical verification possible.
 *
 *   node tools/poki-sync.mjs           # write
 *   node tools/poki-sync.mjs --check   # verify no drift, exit 1 if any
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DEST = join(ROOT, 'poki-ready-copy', 'engine');

/**
 * Every file the game needs from the instrument, and nothing else.
 *
 * Deliberately excluded: math/bessel.js and math/analytic.js (closed-form spectra
 * are for the accuracy tests and the instrument's error readout; the game never
 * needs them), app/share.js (Poki forbids outgoing links), app/main.js,
 * app/spectrum.js (the instrument's own interface), and worker/solver.worker.js
 * (the game ships its own worker, because it also has to build the amplitude
 * table that makes levels provable).
 */
const MANIFEST = [
  'src/math/linalg.js',
  'src/math/sparse.js',
  'src/math/banded.js',
  'src/math/eigen.js',
  'src/geom/polygon.js',
  'src/geom/mesh.js',
  'src/fem/assemble.js',
  'src/fem/solve.js',
  'src/audio/synth.js',
  'src/audio/notes.js',
  // DOM-free despite living under app/: shapes and freehand cleanup.
  'src/app/presets.js',
  'src/app/draw.js',
  // The renderer. Touches a canvas, which the game also has. Vendored rather than
  // reimplemented so the posterised field ramp has exactly one definition and
  // cannot drift from DESIGN.md.
  'src/app/canvas.js',
  // The typeface as a base64 data URI. Poki blocks external requests, so a CDN or
  // a Fonts API call is not an option even if we wanted one.
  'styles/font.css',
];

/**
 * Hashed on content with line endings normalised, not on raw bytes.
 *
 * Git rewrites line endings on checkout, so a byte comparison reports every vendored
 * file as drifted the first time the working copy is touched on a machine with a
 * different `core.autocrlf`. That is a false alarm about a real guarantee, which is the
 * worst kind: it trains you to run the sync reflexively and stop reading the output.
 * What matters is whether the *code* differs.
 */
const sha = (buf) =>
  createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/** src/foo/bar.js -> engine/foo/bar.js, styles/font.css -> engine/styles/font.css */
const destFor = (rel) => join(DEST, rel.startsWith('src/') ? rel.slice(4) : rel);

const check = process.argv.includes('--check');
const entries = [];
const problems = [];

for (const rel of MANIFEST) {
  const from = join(ROOT, rel);
  if (!existsSync(from)) {
    problems.push(`${rel}: missing from the repo, so the manifest is stale`);
    continue;
  }
  const src = readFileSync(from);
  const to = destFor(rel);
  entries.push({ rel, to: to.replace(ROOT, '').replace(/\\/g, '/'), hash: sha(src) });

  if (check) {
    if (!existsSync(to)) {
      problems.push(`${rel}: not vendored yet`);
    } else if (sha(readFileSync(to)) !== sha(src)) {
      problems.push(`${rel}: vendored copy has drifted from source`);
    }
  } else {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, src);
  }
}

if (!check) {
  writeFileSync(
    join(DEST, 'MANIFEST.json'),
    `${JSON.stringify({ generatedBy: 'tools/poki-sync.mjs', files: entries }, null, 2)}\n`,
  );
  writeFileSync(
    join(DEST, 'README.md'),
    [
      '# engine/ is generated. Do not edit anything in here.',
      '',
      'Byte-identical copies of the verified solver, vendored from the repo root by',
      '`npm run poki:sync`. `npm test` runs `npm run poki:check`, which fails if any',
      'file here has drifted from its source.',
      '',
      'To change engine behaviour, edit the original under `src/` at the repo root,',
      'where the accuracy tests can see it, then re-run the sync. Editing a file here',
      'would produce a solver that no test covers, and every accuracy claim the game',
      'makes would silently stop being true.',
      '',
      '| vendored | source |',
      '| --- | --- |',
      ...entries.map((e) => `| \`${e.to.replace(/^\//, '')}\` | \`${e.rel}\` |`),
      '',
    ].join('\n'),
  );
}

if (problems.length) {
  console.error(check ? 'engine/ has drifted from src/:' : 'sync failed:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(check ? '\nRun: npm run poki:sync' : '');
  process.exit(1);
}

console.log(
  check
    ? `engine/ matches src/ exactly (${entries.length} files)`
    : `vendored ${entries.length} files into poki-ready-copy/engine/`,
);
