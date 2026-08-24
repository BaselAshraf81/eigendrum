import { readFileSync } from 'node:fs';

const files = [
  'index.html',
  'how-it-works.html',
  'formulas.html',
  'hearing-the-shape-of-a-drum.html',
  'privacy.html',
];
let bad = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) console.log(`${f}: (no json-ld)`);
  for (const m of blocks) {
    try {
      JSON.parse(m[1]);
      console.log(`${f}: OK`);
    } catch (e) {
      bad += 1;
      console.log(`${f}: INVALID - ${e.message}`);
    }
  }
}
process.exit(bad ? 1 : 0);
