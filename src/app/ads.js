/* Advertising, provider-agnostic.
 *
 * Which network serves these slots is not settled - AdSense, Media.net and Newor Media
 * all want different tags - but everything that matters to this site is identical
 * whichever wins: where the slots sit, that they reserve their height, that they are
 * labelled, and that nothing loads off-origin during development. So the provider is
 * one setting and an adapter, and the rest of the file never changes.
 *
 * Three rules this module exists to enforce, because getting any of them wrong costs
 * either money or the product:
 *
 * 1. Nothing loads off-origin unless we are actually on the deployed host. The charter
 *    pins zero runtime dependencies and `file://` support, so local development, the
 *    browser suites and anyone who cloned the repo get no third-party script at all.
 * 2. Every slot reserves its height in CSS before the frame arrives. An ad that pushes
 *    the page down as it loads is a layout shift, and layout shift is the one Core Web
 *    Vital a static site can still fail.
 * 3. IDs live here, once. Hunting a stale publisher ID through five HTML files is how
 *    one of them ends up wrong.
 */

/** 'none' | 'adsense' | 'medianet' | 'newor'
 *  Leave as 'none' until an application is approved: every slot then collapses and the
 *  site ships without ad markup, which is the correct state while under review. */
export const PROVIDER = 'none';

/* Per-provider credentials. Only the active provider's entry is read.
 *
 *   adsense  client:  'ca-pub-XXXXXXXXXXXXXXXX' (AdSense > Account > Settings)
 *            slot:    the numeric ad unit ID, per placement
 *   medianet cid:     the 8-digit customer ID from the Media.net dashboard
 *            crid:    per-placement creative ID, plus the size they issue it for
 *   newor    script:  the tag URL Newor Media supplies
 *            zone:    per-placement div id they ask you to put on the page
 */
export const PROVIDERS = {
  adsense: {
    client: '',
    slots: { 'home-footer': '', 'article-top': '', 'article-foot': '' },
  },
  medianet: {
    cid: '',
    slots: {
      'home-footer': { crid: '', size: '728x90' },
      'article-top': { crid: '', size: '300x250' },
      'article-foot': { crid: '', size: '300x250' },
    },
  },
  newor: {
    script: '',
    slots: { 'home-footer': '', 'article-top': '', 'article-foot': '' },
  },
};

const HOST = 'eigendrum.com';

/** The deployed site only. Not localhost, not file://, and not the github.io mirror,
 *  which redirects here anyway - serving ads there would bill an impression for a
 *  pageview the visitor never really had. Kept in step with the analytics gate in
 *  index.html; if one changes, change both. */
export function adsAllowed() {
  if (typeof location === 'undefined') return false;
  return location.hostname === HOST || location.hostname === `www.${HOST}`;
}

let scriptRequested = false;

function loadScript(src, { crossOrigin } = {}) {
  if (scriptRequested) return;
  scriptRequested = true;
  const s = document.createElement('script');
  s.async = true;
  if (crossOrigin) s.crossOrigin = crossOrigin;
  s.src = src;
  document.head.appendChild(s);
}

/* Each adapter answers the same two questions: what does a unit look like, and what
   has to happen once they are all in the DOM. `unit` returns false to decline a
   placement it has no ID for, which collapses that frame rather than leaving a
   labelled empty box. */
const ADAPTERS = {
  adsense: {
    ready: (c) => Boolean(c.client),
    unit(frame, name, cfg, holder) {
      const slot = cfg.slots[name];
      if (!slot) return false;
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.dataset.adClient = cfg.client;
      ins.dataset.adSlot = slot;
      ins.dataset.adFormat = holder.dataset.adFormat || 'auto';
      ins.dataset.fullWidthResponsive = 'true';
      frame.appendChild(ins);
      return true;
    },
    done(count, cfg) {
      loadScript(
        `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.client}`,
        { crossOrigin: 'anonymous' },
      );
      window.adsbygoogle = window.adsbygoogle || [];
      for (let i = 0; i < count; i += 1) window.adsbygoogle.push({});
    },
  },

  medianet: {
    ready: (c) => Boolean(c.cid),
    unit(frame, name, cfg) {
      const slot = cfg.slots[name];
      if (!slot?.crid) return false;
      const div = document.createElement('div');
      div.id = `mn-${slot.crid}`;
      frame.appendChild(div);
      // Media.net wants each unit queued by id and size once its tag has booted.
      window._mNHandle = window._mNHandle || {};
      window._mNHandle.queue = window._mNHandle.queue || [];
      window._mNHandle.queue.push(() => {
        try {
          window._mNDetails.loadTag(div.id, slot.size, slot.crid);
        } catch {
          /* A failed unit must never take the instrument down with it. */
        }
      });
      return true;
    },
    done(_count, cfg) {
      loadScript(`https://contextual.media.net/dmedianet.js?cid=${cfg.cid}`);
    },
  },

  newor: {
    ready: (c) => Boolean(c.script),
    unit(frame, name, cfg) {
      const zone = cfg.slots[name];
      if (!zone) return false;
      // Newor place their own creative into a div they nominate by id.
      const div = document.createElement('div');
      div.id = zone;
      frame.appendChild(div);
      return true;
    },
    done(_count, cfg) {
      loadScript(cfg.script);
    },
  },
};

/** Fill every `[data-ad]` placeholder on the page. Safe to call unconditionally: it
 *  returns without touching the DOM when advertising is off, unconfigured, or the page
 *  is not being served from the live host. */
export function mountAds() {
  const holders = [...document.querySelectorAll('[data-ad]')];
  if (!holders.length) return;

  const adapter = ADAPTERS[PROVIDER];
  const cfg = PROVIDERS[PROVIDER];
  const live = adapter && cfg && adapter.ready(cfg) && adsAllowed();

  if (!live) {
    // Collapse the reserved space rather than leaving labelled empty frames on a page
    // that is never going to fill them.
    for (const holder of holders) holder.hidden = true;
    return;
  }

  let mounted = 0;
  for (const holder of holders) {
    const frame = holder.querySelector('.ad-frame');
    if (frame && adapter.unit(frame, holder.dataset.ad, cfg, holder)) mounted += 1;
    else holder.hidden = true;
  }

  if (mounted) adapter.done(mounted, cfg);
}
