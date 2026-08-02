/**
 * Sound.
 *
 * The engine renders a strike by summing decaying sinusoids, one per mode. Nothing
 * here alters a frequency ratio; the only choices this file makes are the ones that
 * belong to a mallet and a room: overall level, and how fast each overtone fades.
 *
 * An AudioContext cannot start before a gesture, which is exactly the behaviour
 * the honesty rule wants, so no sound can escape before the player's first tap.
 */

import { decayTimes, renderStrike } from '../engine/audio/synth.js';

const MAX_VOICES = 5;

let ctx = null;
let muted = false;
let suspended = false;
const voices = [];

export function setMuted(next) {
  muted = next;
  if (muted) stopAll();
}
export const isMuted = () => muted;

/**
 * Silence for reasons that are not the player's choice, currently an ad playing
 * over the top. Kept separate from `muted` so that coming back from a break
 * restores whatever the player actually wanted rather than un-muting them.
 */
export function setSuspended(next) {
  suspended = next;
  if (suspended) stopAll();
}

function ensureContext() {
  if (muted || suspended) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function stopAll() {
  while (voices.length) {
    const v = voices.pop();
    try {
      v.stop();
    } catch {
      /* already finished */
    }
  }
}

/**
 * Plays one strike.
 *
 * `amps` must be *audible* amplitudes, not raw projections: the caller is expected
 * to have put them through the engine's `audibleAmps` and to pass a `gain` scaled
 * by `strikeHeadroom`. The default of 1 assumes that has happened. It used to be
 * 3.0 applied to raw projections, which drove the sum well past the renderer's soft
 * limiter and made every strike a burst of clipping.
 */
export function playStrike(freqs, amps, { brightness = 0.55, gain = 1, taus: given = null } = {}) {
  const audio = ensureContext();
  if (!audio) return;

  // The caller may already have computed these to draw the matching displacement.
  // Reusing them keeps what you see and what you hear the same event.
  const taus = given || decayTimes(freqs, 1.35, brightness);
  const samples = renderStrike({ freqs, amps, taus, sampleRate: audio.sampleRate, gain });

  const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const out = audio.createGain();
  out.gain.value = 0.8;
  src.connect(out).connect(audio.destination);
  src.onended = () => {
    const i = voices.indexOf(src);
    if (i >= 0) voices.splice(i, 1);
  };

  // Overlapping strikes are correct for a drum, but the pile-up needs a bound.
  voices.push(src);
  while (voices.length > MAX_VOICES) {
    const oldest = voices.shift();
    try {
      oldest.stop();
    } catch {
      /* already finished */
    }
  }
  src.start();
  return taus;
}


