/**
 * Ticks from a worker, whose timers browsers do not throttle.
 *
 * requestAnimationFrame stops in a hidden or minimised tab, and with it the LED
 * frames, although the player is still touching the Erae. The caller decides
 * whether a tick is needed: while the frame loop is running it does the work and
 * the tick is ignored, so nothing is advanced or sent twice.
 */
let worker = null;

/** onTick(now) runs on every tick, with a performance.now() timestamp. */
export function startBackground(onTick) {
  if (worker) return;
  worker = new Worker(new URL('../../worker/tick.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = () => onTick(performance.now());
  worker.postMessage('start');
}

export function stopBackground() {
  if (!worker) return;
  worker.terminate();
  worker = null;
}
