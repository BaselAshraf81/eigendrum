/**
 * A metronome for the Erae LEDs while the page is hidden.
 *
 * Browsers pause requestAnimationFrame in a hidden or minimised tab and slow
 * main-thread timers to about one a second. A dedicated worker's timers are not
 * throttled, and a message from it still reaches the page, so this worker keeps
 * the LED frames coming. It exists only while an Erae is connected.
 */
const INTERVAL_MS = 40;
let timer = null;

self.onmessage = (event) => {
  if (event.data === 'start' && timer === null) {
    timer = setInterval(() => postMessage(0), INTERVAL_MS);
  } else if (event.data === 'stop' && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};
