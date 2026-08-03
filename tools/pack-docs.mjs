/**
 * Packs the working documents into an encrypted archive at docs/working-docs.zip.
 *
 * Why this exists: the reasoning behind this project - the charter, the design
 * system, the codebase map and especially the memory file with every dead end in it -
 * is gitignored on purpose, so a public repo carries the runnable build rather than
 * the notes. That was the right call for the repo and a bad one for durability: those
 * files existed on exactly one machine. An encrypted archive gets them off it without
 * publishing them.
 *
 * Why the password is not in this file: this script is committed to a public
 * repository. A password sitting next to the ciphertext is not encryption, it is
 * decoration. It comes from the DOCS_PASSWORD environment variable.
 *
 * Why AES-256 and not the classic zip cipher: ZipCrypto is broken well enough to be
 * treated as plaintext, and the whole point here is that the archive sits in public.
 * The cost is that Windows Explorer cannot open an AES zip - 7-Zip, WinRAR, Keka and
 * p7zip all can, and that is the right trade when the alternative is no real
 * protection at all.
 *
 * Note that the output is never byte-reproducible: AES uses a fresh random salt each
 * run, so re-packing unchanged documents still produces a different file and git will
 * report the archive as modified. That is expected. `git checkout -- docs` if the
 * contents genuinely did not change.
 *
 * Usage:
 *   $env:DOCS_PASSWORD = '...'; npm run pack-docs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'working-docs.zip');

/**
 * Everything gitignored that is worth keeping, plus the global steering file, which
 * lives outside the repo and is the distilled result of all of it.
 *
 * `into` renames the entry inside the archive. The steering files keep their numeric
 * prefixes because the order is meaningful (charter, then map, then timeline).
 */
const FILES = [
  { from: join(root, 'PRODUCT.md'), into: 'PRODUCT.md' },
  { from: join(root, 'DESIGN.md'), into: 'DESIGN.md' },
  { from: join(root, '.kiro/steering/00-project.md'), into: 'steering/00-project.md' },
  { from: join(root, '.kiro/steering/10-codebase-map.md'), into: 'steering/10-codebase-map.md' },
  { from: join(root, '.kiro/steering/20-memory.md'), into: 'steering/20-memory.md' },
  // Optional because the game does not exist on the `master` branch, and this script
  // has to work from either. A missing file is reported, never silently dropped.
  { from: join(root, 'poki-ready-copy/GAME.md'), into: 'game/GAME.md', optional: true },
  { from: join(root, 'poki-ready-copy/SUBMISSION.md'), into: 'game/SUBMISSION.md', optional: true },
  { from: join(root, 'poki-ready-copy/DESIGN.md'), into: 'game/DESIGN.md', optional: true },
  {
    from: join(homedir(), '.kiro/steering/shipping-things-people-want.md'),
    into: 'global-steering/shipping-things-people-want.md',
    optional: true,
  },
];

function findSevenZip() {
  const candidates = [
    'C:/Program Files/7-Zip/7z.exe',
    'C:/Program Files (x86)/7-Zip/7z.exe',
    '7z',
    '7zz',
    '7za',
  ];
  for (const c of candidates) {
    if (c.includes('/') && !existsSync(c)) continue;
    const probe = spawnSync(c, ['i'], { stdio: 'ignore' });
    if (!probe.error) return c;
  }
  return null;
}

const password = process.env.DOCS_PASSWORD;
if (!password) {
  console.error('Set DOCS_PASSWORD first. It is deliberately not stored in this repo.');
  console.error("  PowerShell:  $env:DOCS_PASSWORD = '...'; npm run pack-docs");
  process.exit(1);
}

const sevenZip = findSevenZip();
if (!sevenZip) {
  console.error('7-Zip not found, and it is needed for AES-256. https://7-zip.org');
  process.exit(1);
}

// Stage under .smoke/, which is already gitignored, so a plaintext copy of the notes
// can never be committed by accident even if this run dies half way through.
const stage = join(root, '.smoke', 'docs-pack');
rmSync(stage, { recursive: true, force: true });

const missing = [];
let staged = 0;
for (const file of FILES) {
  if (!existsSync(file.from)) {
    if (file.optional) console.log(`  . ${file.into}  (not on this branch)`);
    else missing.push(file.into);
    continue;
  }
  const dest = join(stage, file.into);
  mkdirSync(dirname(dest), { recursive: true });
  spawnSync(process.execPath, ['-e', 'require("fs").copyFileSync(process.argv[1],process.argv[2])', file.from, dest]);
  staged += 1;
  console.log(`  + ${file.into}  (${(statSync(file.from).size / 1024).toFixed(1)} kB)`);
}

if (missing.length) {
  console.error(`\nMissing, and not optional: ${missing.join(', ')}`);
  rmSync(stage, { recursive: true, force: true });
  process.exit(1);
}

rmSync(out, { force: true });
mkdirSync(dirname(out), { recursive: true });

const zip = spawnSync(
  sevenZip,
  ['a', '-tzip', '-mm=Deflate', '-mx=9', '-mem=AES256', `-p${password}`, out, '*'],
  { cwd: stage, encoding: 'utf8' },
);
rmSync(stage, { recursive: true, force: true });

if (zip.status !== 0) {
  console.error(zip.stdout || '', zip.stderr || '');
  process.exit(1);
}

// Prove it is actually encrypted before claiming so. `l` without a password on an
// AES zip lists the names but cannot read the data, and `t` must fail.
const wrong = spawnSync(sevenZip, ['t', '-pdefinitely-not-the-password', out], {
  encoding: 'utf8',
});
if (wrong.status === 0) {
  console.error('The archive opened with the wrong password. Refusing to claim it is encrypted.');
  rmSync(out, { force: true });
  process.exit(1);
}

const right = spawnSync(sevenZip, ['t', `-p${password}`, out], { encoding: 'utf8' });
if (right.status !== 0) {
  console.error('The archive did not verify with the right password.');
  console.error(right.stdout || '', right.stderr || '');
  rmSync(out, { force: true });
  process.exit(1);
}

// Report the cipher actually used rather than the one that was asked for. `t` does not
// print it, so read the entry listing, and require that every file entry is encrypted:
// directory entries are stored and carry no data, but a single unencrypted file would
// make the whole archive a lie.
const listing = spawnSync(sevenZip, ['l', '-slt', `-p${password}`, out], { encoding: 'utf8' });
// Only entry blocks carry an `Encrypted` field. Keying on that also skips the archive
// header block `l -slt` prints first, which has a Path and a Size and is not a file -
// it was being counted as an unencrypted entry.
const entries = listing.stdout.split(/\r?\n\r?\n/).filter((b) => /^Encrypted = /m.test(b));
const files = entries.filter((b) => !/^Attributes = .*D/m.test(b));
const plain = files.filter((b) => !/^Encrypted = \+/m.test(b));
if (plain.length) {
  console.error(`${plain.length} entries are not encrypted. Refusing to keep the archive.`);
  rmSync(out, { force: true });
  process.exit(1);
}
const method = /Method = (.*)/.exec(files[0] || '')?.[1]?.trim() || 'unknown';

console.log(`\n${staged} files -> docs/working-docs.zip`);
console.log(`  ${(statSync(out).size / 1024).toFixed(1)} kB, ${method}`);
console.log(`  verified: ${files.length} entries encrypted, wrong password refused`);
