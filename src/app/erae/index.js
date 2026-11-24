/**
 * Erae 2 support: shows the live drum on the controller's LEDs and turns a tap
 * on the surface into the same strike a mouse click makes. Everything else (the
 * sound, the field, the solve) stays where it was. main.js only calls
 * setupErae() once, send() every frame and drumChanged() after each solve.
 */
import { EraeLink, ZONE, unavailableReason } from './link.js';
import { EraeRaster } from './raster.js';

// The LEDs do not need the display's frame rate. 25 images a second looks smooth and keeps USB quiet.
const LED_INTERVAL_MS = 40;
// Even a feather touch should be heard, so pressure scales loudness from this floor up to full.
const PRESSURE_FLOOR = 0.2;
const PRESSURE_SLOPE = 1 - PRESSURE_FLOOR;

let simShimLoaded = false;

/** The simulator replaces navigator.requestMIDIAccess, so it has to load before the first connect. */
function loadSimShim() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'tools/erae-sim/midi-shim.js';
    script.onload = script.onerror = resolve;
    document.head.appendChild(script);
  });
}

/**
 * state: main's app state (read only here). els: { button, label, status }.
 * strike(x, y, vel) is the mouse strike path, containsPoint tells whether a drum
 * coordinate lies inside the outline, ensureAudio unlocks sound on a click.
 */
export function setupErae({ state, els, strike, containsPoint, ensureAudio }) {
  const raster = new EraeRaster();
  let lastSend = 0;
  let lastImage = null;
  let busy = false;

  const link = new EraeLink({
    onStatus: (text) => {
      els.status.textContent = text;
      els.label.textContent = link.connected ? 'disconnect erae' : 'connect erae';
    },
    onFinger: (f) => {
      // Only the moment of touch strikes; slides and lifts do not.
      if (f.action !== 0 || f.zone !== ZONE || state.drawMode || !state.drum || !raster.ready) return;
      const p = raster.toDrum(f.x, f.y);
      if (!containsPoint(p.x, p.y)) return;
      strike(p.x, p.y, Math.min(1, PRESSURE_FLOOR + PRESSURE_SLOPE * f.z));
    },
  });

  els.button.addEventListener('click', async () => {
    if (busy) return;
    if (link.connected) {
      link.disconnect();
      return;
    }
    // Erae touches are not user gestures, so audio is unlocked by this click.
    if (!state.muted) ensureAudio();
    busy = true;
    try {
      if (/[?&]sim(=|&|$)/.test(location.search) && !simShimLoaded) {
        simShimLoaded = true;
        await loadSimShim();
      }
      const why = unavailableReason();
      if (why) {
        els.status.textContent = why;
        return;
      }
      raster.reset();
      lastImage = null;
      await link.connect();
    } catch (err) {
      console.error('erae connect failed', err);
      els.status.textContent = 'could not connect to erae';
    } finally {
      busy = false;
    }
  });

  return {
    /** Called each frame after the canvas is drawn: the same field as an LED image, only when it changed. */
    send(now) {
      if (!link.connected || now - lastSend < LED_INTERVAL_MS) return;
      let rgb;
      if (state.drawMode || !state.drum) {
        if (!raster.ready) return;
        rgb = raster.blank();
      } else {
        raster.prepare(state.drum, link.zone.width, link.zone.height);
        const struck = state.view === 'struck' && state.strike;
        rgb = raster.render(state.fieldBuf, struck ? state.strike.refAmp : 1);
      }
      if (lastImage && lastImage.every((v, i) => v === rgb[i])) return;
      lastImage = rgb.slice();
      lastSend = now;
      link.send(rgb);
    },
    /** A new drum was solved: the old fit no longer describes it. */
    drumChanged() {
      raster.reset();
      if (link.connected) raster.prepare(state.drum, link.zone.width, link.zone.height);
    },
  };
}
