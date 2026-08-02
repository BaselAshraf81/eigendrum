/**
 * The portal, whichever one it is.
 *
 * Every SDK call in the game goes through here, and every one is safe when no SDK is
 * present. That is not defensive padding: absence is a supported, tested state, since
 * it covers local development, running off a bare filesystem, and a player with an ad
 * blocker. Portals require the last case explicitly.
 *
 * The SDK script is injected at runtime from `target.js` rather than sitting in
 * index.html, because portals forbid a build that carries a competitor's SDK. One
 * codebase, one line to repoint it.
 *
 * Differences the adapters exist to hide:
 *
 *   - CrazyGames v3 requires `init()` to be awaited before anything else works, and
 *     reports ads through callbacks. Poki resolves a promise instead.
 *   - CrazyGames calls it `loadingStop`, Poki calls it `gameLoadingFinished`.
 *   - Neither guarantees a callback ever arrives, so every ad is raced against a
 *     timeout. A portal that goes quiet must not strand the game between levels.
 */

import { TARGET } from './target.js';

const noop = () => {};

/** Used when there is no portal, and as the fallback when one fails to load. */
const STUB = {
  loadingStart: noop,
  loadingFinished: noop,
  gameplayStart: noop,
  gameplayStop: noop,
  ad: () => Promise.resolve(false),
  rewarded: () => Promise.resolve(false),
  captureError: noop,
};

/** No callback from a portal may hold the game up longer than this. */
const AD_TIMEOUT_MS = 45000;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(tag);
  });
}

// ----------------------------------------------------------------- CrazyGames v3

function crazyAdapter(SDK) {
  /**
   * `requestAd` reports through callbacks and returns nothing, so it is wrapped into a
   * promise here. `onEnd` fires only if an ad actually started: not every request
   * shows one, and unmuting after a break that never happened would override whatever
   * the player chose.
   */
  const request = (type, { onStart = noop, onEnd = noop } = {}) =>
    new Promise((resolve) => {
      let started = false;
      let settled = false;
      const finish = (rewarded) => {
        if (settled) return;
        settled = true;
        if (started) onEnd();
        resolve(rewarded);
      };
      const timer = setTimeout(() => finish(false), AD_TIMEOUT_MS);
      try {
        SDK.ad.requestAd(type, {
          adStarted: () => {
            started = true;
            onStart();
          },
          adFinished: () => {
            clearTimeout(timer);
            finish(true);
          },
          adError: () => {
            clearTimeout(timer);
            finish(false);
          },
        });
      } catch {
        clearTimeout(timer);
        finish(false);
      }
    });

  return {
    loadingStart: () => SDK.game.loadingStart(),
    loadingFinished: () => SDK.game.loadingStop(),
    gameplayStart: () => SDK.game.gameplayStart(),
    gameplayStop: () => SDK.game.gameplayStop(),
    ad: (opts) => request('midgame', opts),
    // For a rewarded ad, adFinished is the signal that the reward was earned.
    rewarded: (opts) => request('rewarded', opts),
    captureError: noop,
  };
}

// ------------------------------------------------------------------------- Poki

function pokiAdapter(SDK) {
  const wrap = (call, { onStart = noop, onEnd = noop } = {}) => {
    let started = false;
    return Promise.resolve(
      call(() => {
        started = true;
        onStart();
      }),
    )
      .then((value) => {
        if (started) onEnd();
        return Boolean(value);
      })
      .catch(() => {
        if (started) onEnd();
        return false;
      });
  };

  return {
    loadingStart: () => SDK.gameLoadingStart(),
    loadingFinished: () => SDK.gameLoadingFinished(),
    gameplayStart: () => SDK.gameplayStart(),
    gameplayStop: () => SDK.gameplayStop(),
    ad: (opts) => wrap((onStart) => SDK.commercialBreak(onStart), opts),
    rewarded: (opts) => wrap((onStart) => SDK.rewardedBreak(onStart), opts),
    captureError: (err) => SDK.captureError?.(err),
  };
}

const PORTALS = {
  crazygames: {
    script: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
    find: () => window.CrazyGames?.SDK,
    // v3 is unusable until init settles, so this one genuinely must be awaited.
    build: async (SDK) => {
      await SDK.init();
      return crazyAdapter(SDK);
    },
  },
  poki: {
    script: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
    find: () => window.PokiSDK,
    build: async (SDK) => {
      await SDK.init();
      return pokiAdapter(SDK);
    },
  },
};

// ------------------------------------------------------------------- the façade

let sdk = STUB;
let ready = false;
let playing = false;
const deferred = [];

/**
 * Calls made before the SDK settles are replayed once it does.
 *
 * The game deliberately starts solving its first drum without waiting for the portal,
 * because an advertising stack costs seconds of network and the player gains nothing
 * from staring at a blank screen while it arrives. That means loading and gameplay
 * events can legitimately happen first, and they still have to be reported.
 */
function defer(name) {
  return (...args) => {
    if (!ready) {
      deferred.push([name, args]);
      return;
    }
    try {
      sdk[name](...args);
    } catch {
      /* a broken portal is not a broken game */
    }
  };
}

export async function initPlatform() {
  const portal = PORTALS[TARGET];
  // Test hook, with no user-facing surface: the browser suite sets this so it never
  // depends on a live advertising stack. Portal absence is a supported state anyway,
  // so this exercises a path that has to work in production regardless.
  if (portal && !window.__noPortal) {
    try {
      await loadScript(portal.script);
      const raw = portal.find();
      if (!raw) throw new Error(`${TARGET} sdk did not appear`);
      sdk = await portal.build(raw);
    } catch {
      sdk = STUB;
    }
  }
  ready = true;
  for (const [name, args] of deferred.splice(0)) {
    try {
      sdk[name](...args);
    } catch {
      /* ignore */
    }
  }
  return sdk !== STUB;
}

export const loadingStart = defer('loadingStart');
export const loadingFinished = defer('loadingFinished');

/** Kept balanced by a flag, since the game has several routes into and out of play. */
export function gameplayStart() {
  if (playing) return;
  playing = true;
  defer('gameplayStart')();
}
export function gameplayStop() {
  if (!playing) return;
  playing = false;
  defer('gameplayStop')();
}

/**
 * An ad opportunity at a natural pause. Gameplay is stopped around it, as every portal
 * asks, and resumed only if it was running beforehand.
 */
export async function commercialBreak(opts = {}) {
  const wasPlaying = playing;
  gameplayStop();
  if (ready) await sdk.ad(opts);
  if (wasPlaying) gameplayStart();
}

/** Offered, never forced, and the player is told it is an ad before it starts. */
export async function rewardedBreak(opts = {}) {
  const wasPlaying = playing;
  gameplayStop();
  const rewarded = ready ? await sdk.rewarded(opts) : false;
  if (wasPlaying) gameplayStart();
  return rewarded;
}

export function captureError(err) {
  try {
    sdk.captureError(err);
  } catch {
    /* nothing to do about a broken error reporter */
  }
  if (!ready) console.error(err);
}
