/* AdSense loader.
 *
 * Three rules this module exists to enforce, because getting any of them wrong
 * costs either money or the product:
 *
 * 1. Nothing loads off-origin unless we are actually on the deployed host. The
 *    charter pins zero runtime dependencies and `file://` support, so local
 *    development, the browser test suites and anyone who cloned the repo and
 *    opened index.html get no third-party script at all.
 * 2. Every slot reserves its height in CSS before the frame arrives. An ad that
 *    pushes the page down as it loads is a layout shift, and layout shift is the
 *    one Core Web Vital that a static site can still fail.
 * 3. Slots are declared here, once. `data-ad-slot` values come from the AdSense
 *    dashboard after approval, and hunting them through four HTML files later is
 *    how one of them ends up stale.
 */

// From the AdSense dashboard: Account -> Settings -> Account information.
// Until this is set, the module is inert and the site ships without ad markup,
// which is the correct state while the application is still under review.
export const PUBLISHER_ID = '';

/* Slot IDs, per placement. Empty string means "not created yet": the placement
   still reserves its space and renders its label, but no request is made, so a
   half-configured account cannot produce blank framed holes. */
export const SLOTS = {
  // Instrument page, in the footer band below the study sheet.
  'home-footer': '',
  // Prose pages: one after the opening section, one at the foot of the article.
  'article-top': '',
  'article-foot': '',
};

const HOST = 'eigendrum.com';

/** The deployed site only. Not localhost, not file://, not the github.io mirror
 *  (which redirects here anyway, so serving ads there would bill an impression
 *  for a pageview the visitor never really had). */
export function adsAllowed() {
  if (typeof location === 'undefined') return false;
  return location.hostname === HOST || location.hostname === `www.${HOST}`;
}

let scriptRequested = false;

function requestScript() {
  if (scriptRequested) return;
  scriptRequested = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBLISHER_ID}`;
  document.head.appendChild(s);
}

/** Fill every `[data-ad]` placeholder on the page. Safe to call unconditionally:
 *  it returns without touching the DOM when ads are off or unconfigured. */
export function mountAds() {
  const holders = [...document.querySelectorAll('[data-ad]')];
  if (!holders.length) return;

  if (!PUBLISHER_ID || !adsAllowed()) {
    // Collapse the reserved space rather than leaving labelled empty frames on a
    // page that is never going to fill them.
    for (const holder of holders) holder.hidden = true;
    return;
  }

  let mounted = 0;
  for (const holder of holders) {
    const slot = SLOTS[holder.dataset.ad];
    if (!slot) {
      holder.hidden = true;
      continue;
    }

    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = PUBLISHER_ID;
    ins.dataset.adSlot = slot;
    ins.dataset.adFormat = holder.dataset.adFormat || 'auto';
    // Lets a unit go taller than wide in the footer band, where the space is
    // wide and short, without AdSense picking a skyscraper.
    ins.dataset.fullWidthResponsive = 'true';

    holder.querySelector('.ad-frame').appendChild(ins);
    mounted += 1;
  }

  if (!mounted) return;
  requestScript();
  window.adsbygoogle = window.adsbygoogle || [];
  for (let i = 0; i < mounted; i += 1) window.adsbygoogle.push({});
}
