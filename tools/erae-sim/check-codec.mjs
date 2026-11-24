// Cross-checks codec.js against Henry's vendor/erae-api.js and, when Python 3 exists, Embodme's utils.py.
// Run: node tools/erae-sim/check-codec.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bitize, unbitize, bitizedSize, xor } from './codec.js';

const here = dirname(fileURLToPath(import.meta.url));
const ctx = vm.createContext({ console });
vm.runInContext(readFileSync(join(here, 'vendor', 'erae-api.js'), 'utf8'), ctx, { filename: 'erae-api.js' });
const vendor = vm.runInContext('bitize7chksum', ctx);

// Deterministic PRNG so a failure reproduces.
let s = 0x2545f491;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const lens = [0, 1, 6, 7, 8, 13, 14, 3024];
while (lens.length < 200) lens.push(Math.floor(rnd() * 3025));
const vectors = lens.map((n) => Array.from({ length: n }, () => Math.floor(rnd() * 256)));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const results = {};
const check = (name, ok, detail) => { (results[name] ||= []).push([ok, detail]); };
const pyFormula = (n) => Math.floor(n / 7) * 8 + (n % 7 > 0 ? 1 + (n % 7) : 0);

for (const v of vectors) {
  const mine = bitize(v), [vw, vsum] = vendor(v, v.length);
  check('bitize equals vendor bitize7chksum', same(mine, Array.from(vw)), `len ${v.length}`);
  check('vendor checksum equals XOR of codec wire bytes', vsum === xor(mine), `len ${v.length}`);
  check('unbitize(bitize(x)) equals x', same(unbitize(mine), v), `len ${v.length}`);
  check('bitizedSize matches Python formula and wire length', bitizedSize(v.length) === pyFormula(v.length) && mine.length === pyFormula(v.length), `len ${v.length}`);
  check('every wire byte is 7-bit', mine.every((b) => b <= 0x7f), `len ${v.length}`);
}

let pyCmd = null;
for (const c of ['python', 'py']) {
  const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
  if (r.status === 0) { pyCmd = c; break; }
}
let pyNote;
if (!pyCmd) pyNote = 'Python 3 not found, Python comparison skipped';
else {
  const utils = join(here, '..', '..', '..', '..', '.erae-ref', 'erae_api_sysex', 'erae', 'utils.py');
  const code = [
    'import sys, json, importlib.util',
    `sp = importlib.util.spec_from_file_location('u', ${JSON.stringify(utils)})`,
    'u = importlib.util.module_from_spec(sp); sp.loader.exec_module(u)',
    'out = []',
    'for v in json.load(sys.stdin):',
    '    if not v: out.append(None); continue',
    '    w = u.bitize7chksum(v)',
    '    out.append({"wire": w, "back": u.unbitize7chksum(w[:-1], w[-1]), "size": u.bitized7size(len(v))})',
    'print(json.dumps(out))',
  ].join('\n');
  const r = spawnSync(pyCmd, ['-c', code], { input: JSON.stringify(vectors), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { pyNote = `Python failed: ${r.stderr.trim().slice(0, 300)}`; check('Python utils.py ran', false, pyNote); }
  else {
    const out = JSON.parse(r.stdout);
    pyNote = `Python ran via "${pyCmd}" on ${out.filter(Boolean).length} non-empty vectors`;
    vectors.forEach((v, i) => {
      const p = out[i];
      if (!p) return;
      check('codec bitize + checksum equals Python bitize7chksum bytes', same([...bitize(v), xor(bitize(v))], p.wire), `len ${v.length}`);
      check('codec unbitize equals Python unbitize7chksum', same(unbitize(p.wire.slice(0, -1)), p.back) && same(p.back, v), `len ${v.length}`);
      check('bitizedSize equals Python bitized7size', bitizedSize(v.length) === p.size, `len ${v.length}`);
    });
  }
}

let failed = 0;
for (const [name, list] of Object.entries(results)) {
  const bad = list.filter(([ok]) => !ok);
  if (bad.length) failed++;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${name} (${list.length - bad.length}/${list.length})${bad.length ? ' e.g. ' + bad[0][1] : ''}`);
}
console.log(pyNote);
process.exit(failed ? 1 : 0);
