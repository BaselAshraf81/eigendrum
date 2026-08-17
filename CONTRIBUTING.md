# Contributing / maintainer notes

## Licensing of contributions

By submitting a pull request, you agree your contribution is licensed under
the repository's current [LICENSE](LICENSE) and that the maintainer may
relicense the project as a whole in the future, including under a different
licence for new releases. This does not affect anyone's rights to code
already published under a prior licence.

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

`PROVIDER` in `src/app/ads.js` currently reads `'sponsor-wanted'`: no ad
network runs on the deployed site. Every reserved ad slot instead renders a
plain mailto pitch for a direct sponsor, no script, no iframe, nothing
off-origin. Adapters for AdSense, Media.net, Newor Media and Monetag also
exist in the same file and are not currently in use; switching providers is
that one constant plus the relevant IDs.

Monetag's In-Page Push and Direct Link were trialled and later turned off
after their network served a scareware pop-up to a visitor; see
[`privacy.html`](privacy.html) for the visitor-facing account. If a real
network is ever turned back on, every format that hijacks a click stays
rejected outright: pop-ups, pop-unders, interstitials, full-screen overlays,
notification prompts. Drawing on this site *is* clicking and dragging, so an
advert that redirects mid-stroke would break the only thing the site does.

Development contacts no ad network and never has under `sponsor-wanted`: the
analytics tag gates on `location.hostname`, and `npm run serve` strips ad and
analytics tags from every page it serves, so impressions never come from a
developer's machine or the test suites. See [`privacy.html`](privacy.html)
for the current visitor-facing notice.
