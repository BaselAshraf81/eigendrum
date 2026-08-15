# Contributing / maintainer notes

## Scripts

```bash
npm run serve         # dev server on :8080
npm test              # unit tests, including the accuracy proofs
npm run bench          # accuracy and timing against closed-form spectra
npm run isospectral    # verifies the two Kac drums really are isospectral
npm run smoke          # headless browser test of the whole app
npm run mobile         # narrow-viewport layout and touch checks
npm run readme-shots   # regenerates the images in README.md
```

## Advertising

Advertising is served by **Monetag**, set by one constant (`PROVIDER`) in
`src/app/ads.js`. The module stays provider-agnostic: adapters for AdSense,
Media.net and Newor Media are also written, and switching is that constant plus
the relevant IDs.

Two zones run: an in-page banner, which Monetag position themselves rather than
filling a reserved slot, and a Direct Link filling the reserved footer and
article frames, the only one of their formats that can occupy a container. That
one is a plain anchor: no script, no iframe, nothing off-origin pulled into the
page, so it costs nothing in layout shift and cannot execute anything.

Every format that hijacks a click was rejected outright: pop-ups, pop-unders,
interstitials, full-screen overlays, notification prompts. Drawing on this site
*is* clicking and dragging, so an advert that redirects mid-stroke would break
the only thing the site does.

Development contacts no ad network: the analytics tag gates on
`location.hostname`, and `npm run serve` strips ad tags from every page it
serves, so impressions never come from a developer's machine or the test
suites. One exception: the ad tag is pasted verbatim as Monetag issue it, so it
is unconditional, and opening a page directly from `file://` will request it.
Their installation checker doesn't recognise a wrapped or rewritten copy, so
verbatim is the only form that registers as installed. See
[`privacy.html`](privacy.html) for the visitor-facing notice.
