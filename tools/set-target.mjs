/**
 * Repoints the build at a portal.
 *
 *   node tools/set-target.mjs crazygames
 *   node tools/set-target.mjs poki
 *   node tools/set-target.mjs none
 *
 * One line in one file, because portals refuse builds that carry a competitor's SDK
 * and the alternative is a separate index.html per portal.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = ['crazygames', 'poki', 'none'];
const file = new URL('../poki-ready-copy/game/target.js', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const wanted = process.argv[2];
const text = readFileSync(file, 'utf8');
const current = /export const TARGET = '([^']+)'/.exec(text)?.[1];

if (!wanted) {
  console.log(`target is '${current}'. Options: ${TARGETS.join(', ')}`);
  process.exit(0);
}
if (!TARGETS.includes(wanted)) {
  console.error(`unknown target '${wanted}'. Options: ${TARGETS.join(', ')}`);
  process.exit(1);
}

writeFileSync(file, text.replace(/export const TARGET = '[^']+'/, `export const TARGET = '${wanted}'`));
console.log(`target: ${current} -> ${wanted}`);
