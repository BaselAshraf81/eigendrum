/* Static audit of the shipped HTML pages: canonical URLs, ad placeholders, and the
 * honesty invariant that no page still claims to be ad-free. Cheap enough to run on
 * every change, and it catches the class of mistake that a browser test cannot see -
 * a stale sentence.
 */
import { readFileSync } from 'node:fs';

const PAGES = [
  ['index.html', 'https://eigendrum.com/'],
  ['how-it-works.html', 'https://eigendrum.com/how-it-works'],
  ['hearing-the-shape-of-a-drum.html', 'https://eigendrum.com/hearing-the-shape-of-a-drum'],
  ['formulas.html', 'https://eigendrum.com/formulas'],
  ['privacy.html', 'https://eigendrum.com/privacy'],
];

const problems = [];

const sitemap = readFileSync('sitemap.xml', 'utf8');
if (!sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9')) {
  problems.push('sitemap.xml has the wrong urlset namespace');
}
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

for (const [file, expectedCanonical] of PAGES) {
  const html = readFileSync(file, 'utf8');

  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== expectedCanonical) {
    problems.push(`${file}: canonical is ${canonical}, expected ${expectedCanonical}`);
  }
  if (!locs.includes(expectedCanonical)) {
    problems.push(`${file}: ${expectedCanonical} is missing from sitemap.xml`);
  }
  if (!/<title>.{10,70}<\/title>/.test(html)) {
    problems.push(`${file}: title missing or outside 10-70 chars`);
  }
  const desc = html.match(/name="description"\s+content="([^"]*)"/s)?.[1];
  if (!desc) problems.push(`${file}: no meta description`);

  // Every ad placeholder needs its label and its reserved frame, or it is either
  // unlabelled (a policy problem) or unreserved (a layout-shift problem).
  const holders = [...html.matchAll(/data-ad="([^"]+)"/g)].map((m) => m[1]);
  for (const h of holders) {
    if (!['home-footer', 'article-top', 'article-foot'].includes(h)) {
      problems.push(`${file}: unknown ad slot "${h}"`);
    }
  }
  const labels = (html.match(/class="ad-label"/g) || []).length;
  const frames = (html.match(/class="ad-frame"/g) || []).length;
  if (labels !== holders.length || frames !== holders.length) {
    problems.push(
      `${file}: ${holders.length} ad holders but ${labels} labels and ${frames} frames`,
    );
  }

  // The claim that got the game build a DO NOT SHIP once already: prose that stopped
  // being true. The site is ad-supported now, so nothing may say otherwise.
  if (/\bno ads\b/i.test(html)) problems.push(`${file}: still claims "no ads"`);

  // Prose pages must reach the instrument and the privacy notice.
  if (file !== 'index.html') {
    if (!html.includes('href="/privacy"') && file !== 'privacy.html') {
      problems.push(`${file}: no link to the privacy notice`);
    }
    if (!/href="\/(#|")/.test(html) && !html.includes('href="/"')) {
      problems.push(`${file}: no link back to the instrument`);
    }
  }
}

const readme = readFileSync('README.md', 'utf8');
if (/\bno ads\b/i.test(readme)) problems.push('README.md still claims "no ads"');

const ads = readFileSync('ads.txt', 'utf8');
if (!/^google\.com, pub-\d{16}, DIRECT, f08c47fec0942fa0$/m.test(ads)) {
  console.log('note: ads.txt still holds the placeholder publisher ID');
}

if (problems.length) {
  console.error('Page audit failed:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`Page audit passed: ${PAGES.length} pages, ${locs.length} sitemap URLs.`);
