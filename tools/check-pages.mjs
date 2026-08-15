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

/* The advertising config and the pages have to agree, and the ways they can disagree are
   all expensive: a live provider with no ads.txt entry loses most of the demand, and a
   privacy notice that names the wrong partner - or claims ads are off while they are
   running - is the exact prose-drift failure this file exists to catch. */
const adsjs = readFileSync('src/app/ads.js', 'utf8');
const provider = adsjs.match(/^export const PROVIDER = '([a-z-]+)';/m)?.[1];
if (!provider) problems.push('src/app/ads.js: could not read PROVIDER');

const adstxt = readFileSync('ads.txt', 'utf8');
const declared = adstxt
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'));

const privacy = readFileSync('privacy.html', 'utf8');
const saysAdsOff = /no advertising is running on this site yet/i.test(privacy);

if (provider === 'none') {
  if (declared.length) {
    problems.push(`ads.txt declares ${declared.length} seller line(s) but PROVIDER is 'none'`);
  }
  if (!saysAdsOff) {
    problems.push('PROVIDER is \'none\' but privacy.html no longer says advertising is off');
  }
  console.log("note: advertising is off (PROVIDER = 'none'); every slot collapses.");
} else if (provider === 'sponsor-wanted') {
  /* Not a network: every slot is a mailto pitch instead. No ads.txt entry to check,
     and privacy.html is allowed to say ads are off, since none are running. */
  if (declared.length) {
    problems.push(
      `ads.txt declares ${declared.length} seller line(s) but PROVIDER is 'sponsor-wanted'`,
    );
  }
  console.log("note: PROVIDER is 'sponsor-wanted'; every slot pitches direct sponsorship instead of running a network.");
} else {
  if (!['adsense', 'medianet', 'newor', 'monetag'].includes(provider)) {
    problems.push(`src/app/ads.js: unknown PROVIDER '${provider}'`);
  }
  /* Monetag sell their own inventory directly and do not participate in ads.txt, so an
     empty sellers file is the correct state for them - not the missed-revenue mistake it
     would be for the header-bidding providers, where every absent line is demand that
     silently will not bid. */
  const needsAdsTxt = !['monetag'].includes(provider);
  if (needsAdsTxt && !declared.length) {
    problems.push(`PROVIDER is '${provider}' but ads.txt declares no sellers`);
  }

  /* Monetag's tag is inline in every page's head, because their installation checker
     reads the served HTML and cannot see a script an ES module appends later. That means
     the zone ID lives in six places instead of one, so it gets checked: a page missing
     the tag earns nothing, and a page carrying a stale zone earns for the wrong one. */
  if (provider === 'monetag') {
    const zone = adsjs.match(/zone: '(\d+)'/)?.[1];
    const src = adsjs.match(/scriptSrc: '([^']+)'/)?.[1];
    if (!zone || !src) {
      problems.push('src/app/ads.js: monetag zone or scriptSrc missing');
    } else {
      for (const [file] of PAGES) {
        const html = readFileSync(file, 'utf8');
        if (!html.includes(`s.dataset.zone='${zone}'`) || !html.includes(src)) {
          problems.push(`${file}: missing or stale inline Monetag tag (zone ${zone})`);
        }
      }
      /* The tag is verbatim and therefore unconditional, so the only thing keeping local
         pageviews and the browser suites from billing impressions is the dev server
         stripping it. If that ever silently stops matching the snippet, every test run
         becomes invalid traffic, so it is checked rather than trusted. */
      const serve = readFileSync('tools/serve.mjs', 'utf8');
      if (!serve.includes('stripAdTag')) {
        problems.push('tools/serve.mjs no longer strips the ad tag for local requests');
      } else {
        const sample = readFileSync('index.html', 'utf8');
        const stripRe = serve.match(/html\.replace\((\/[\s\S]*?\/g)/)?.[1];
        if (!stripRe) {
          problems.push('tools/serve.mjs: could not read the strip pattern');
        } else {
          const body = stripRe.slice(1, -2);
          if (new RegExp(body, 'g').test(sample) === false) {
            problems.push('tools/serve.mjs strip pattern no longer matches the tag in index.html');
          }
        }
      }
    }
  }
  if (saysAdsOff) {
    problems.push(
      `PROVIDER is '${provider}' but privacy.html still says no advertising is running`,
    );
  }
}

if (problems.length) {
  console.error('Page audit failed:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`Page audit passed: ${PAGES.length} pages, ${locs.length} sitemap URLs.`);
