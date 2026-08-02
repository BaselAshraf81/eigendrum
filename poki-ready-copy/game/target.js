/**
 * Which portal this build is packaged for.
 *
 * One line, on purpose. Portals forbid carrying a competitor's SDK, so the script is
 * injected at runtime by platform.js according to this value rather than being
 * hardcoded in index.html. Switch it with `npm run target crazygames|poki|none`.
 *
 * 'none' is a complete, playable build with no portal and no ads, which is what runs
 * from a bare filesystem and on our own hosting.
 */
export const TARGET = 'crazygames';
