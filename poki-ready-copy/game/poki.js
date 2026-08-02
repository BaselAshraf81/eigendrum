/**
 * Poki SDK wrapper.
 *
 * Every call goes through here and every call is safe when the SDK is absent,
 * which happens in three real situations: local development, an ad blocker, and
 * running the build straight off the filesystem. Poki requires that a blocked SDK
 * still yield a fully playable game, so absence is a supported state rather than
 * an error path.
 *
 * The stub resolves rather than rejects, so callers never need a catch and a
 * missing SDK can never strand the game mid-transition.
 */

const noop = () => {};
const resolved = () => Promise.resolve();

const STUB = {
  init: resolved,
  gameLoadingStart: noop,
  gameLoadingFinished: noop,
  gameplayStart: noop,
  gameplayStop: noop,
  commercialBreak: resolved,
  rewardedBreak: () => Promise.resolve(false),
  captureError: noop,
  setDebug: noop,
};

let sdk = STUB;
let ready = false;
let missedPlay = false;

/**
 * Resolves once, whether or not the SDK actually arrived.
 *
 * Measured on a real load, the SDK and its advertising stack take about 1.8s of
 * network before `init()` settles. The game must not wait for that to start
 * solving its first drum, so this is deliberately not awaited before loading
 * begins; any call that arrived early is replayed here instead.
 */
export async function initPoki() {
  const real = typeof window !== 'undefined' ? window.PokiSDK : null;
  if (real) {
    try {
      await real.init();
      sdk = real;
    } catch {
      sdk = STUB;
    }
  }
  ready = true;
  if (missedPlay && playing) {
    missedPlay = false;
    sdk.gameplayStart();
  }
  return sdk !== STUB;
}

export const loadingStart = () => sdk.gameLoadingStart();
export const loadingFinished = () => sdk.gameLoadingFinished();

/**
 * Poki wants gameplayStart/Stop to bracket actual play, and to be balanced. The
 * flag makes double calls harmless, because the game has several routes into and
 * out of play (level start, curtain, chapter change) and an unbalanced pair
 * misreports engagement.
 */
let playing = false;
export function gameplayStart() {
  if (playing) return;
  playing = true;
  // Play can begin before the SDK finishes loading, since the game deliberately
  // does not wait for it. Remember the call so initPoki can replay it.
  if (!ready) {
    missedPlay = true;
    return;
  }
  sdk.gameplayStart();
}
export function gameplayStop() {
  if (!playing) return;
  playing = false;
  sdk.gameplayStop();
}

/**
 * An ad at a natural pause. Gameplay is stopped around it, as Poki asks.
 *
 * `onStart` only fires when an ad is genuinely about to show, which is not every
 * call: their system decides when a player is ready for one. That callback is the
 * only correct place to mute, because muting on every call would silence the game
 * at every chapter boundary whether an ad ran or not.
 */
export async function commercialBreak({ onStart = noop, onEnd = noop } = {}) {
  const wasPlaying = playing;
  gameplayStop();
  let started = false;
  try {
    await sdk.commercialBreak(() => {
      started = true;
      onStart();
    });
  } catch {
    /* a failed ad is not a failed game */
  }
  if (started) onEnd();
  if (wasPlaying) gameplayStart();
}

/** Offered, never forced, and the player is told it is an ad before it starts. */
export async function rewardedBreak({ onStart = noop, onEnd = noop } = {}) {
  const wasPlaying = playing;
  gameplayStop();
  let started = false;
  let rewarded = false;
  try {
    rewarded = await sdk.rewardedBreak(() => {
      started = true;
      onStart();
    });
  } catch {
    rewarded = false;
  }
  if (started) onEnd();
  if (wasPlaying) gameplayStart();
  return Boolean(rewarded);
}

export function captureError(err) {
  try {
    sdk.captureError(err);
  } catch {
    /* nothing to do about a broken error reporter */
  }
  if (!ready) console.error(err);
}
