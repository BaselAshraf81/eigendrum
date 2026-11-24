/**
 * Erae 2 support: shows the live drum on the controller's LEDs and turns a tap
 * on the surface into the same strike a mouse click makes. Everything else (the
 * sound, the field, the solve) stays where it was. main.js only calls
 * setupErae() once, send() every frame and drumChanged() after each solve.
 *
 * Around the drum sit faders, preset buttons and a tension strip (layout.js).
 * A finger belongs to whatever it first touched until it lifts, so a fader can
 * be dragged across the drum without striking it.
 */
import { EraeLink, ZONE, unavailableReason } from './link.js';
import { EraeRaster } from './raster.js';
import { layout, contains } from './layout.js';
import { paintControls } from './controls.js';
import { freqToNote } from '../../audio/notes.js';

// The LEDs do not need the display's frame rate. 25 images a second looks smooth and keeps USB quiet.
const LED_INTERVAL_MS = 40;
// Even a feather touch should be heard, so pressure scales loudness from this floor up to full.
const PRESSURE_FLOOR = 0.2;
const PRESSURE_SLOPE = 1 - PRESSURE_FLOOR;
// Four semitones at full pressure is about what pushing on a frame drum's head gives.
const MAX_BEND = 4;
// setTargetAtTime settles in about three time constants: 20 ms onto a bend, 150 ms back off it.
const BEND_SMOOTH = 0.007;
const RELEASE_SMOOTH = 0.05;
const ACTION_CLICK = 0;
const ACTION_SLIDE = 1;
const ACTION_RELEASE = 2;

const SIM_REQUESTED = /[?&]sim(=|&|$)/.test(location.search);
let simShimLoaded = false;
// The simulator docks in this page so both stay visible; see dock.js for why.
if (SIM_REQUESTED) import('./dock.js').then((dock) => dock.mountDock());

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
 * sliders: { pitch, bright, mallet } range inputs. presetIds lists the presets in
 * button order and selectPreset(id) is what an on-screen preset button does.
 * isSolving() is true while a solve runs. setBend(factor, smoothing) retunes
 * everything ringing.
 */
export function setupErae({ state, els, strike, containsPoint, ensureAudio, sliders, presetIds, selectPreset, isSolving, setBend }) {
  const raster = new EraeRaster();
  let lastSend = 0;
  let lastImage = null;
  let busy = false;
  let ui = null;
  let uiKey = '';
  // finger id -> the rectangle it landed on, until it lifts
  const owners = new Map();
  let tension = -1;

  function layoutFor(width, height) {
    const key = width + 'x' + height;
    if (key !== uiKey) {
      uiKey = key;
      ui = layout(width, height, presetIds.length);
    }
    return ui;
  }

  function setSlider(input, y, r) {
    const v = Math.min(1, Math.max(0, (y - r.y) / r.h));
    const min = Number(input.min);
    const max = Number(input.max);
    const next = String(min + v * (max - min));
    input.value = next;
    // The slider snaps to its step; only tell the app when the snapped value moved.
    if (input.value === input.dataset.eraeLast) return;
    input.dataset.eraeLast = input.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function bend(z) {
    tension = z;
    setBend(2 ** ((MAX_BEND * z) / 12), BEND_SMOOTH);
  }

  function releaseTension() {
    tension = -1;
    setBend(1, RELEASE_SMOOTH);
  }

  function onFinger(f) {
    if (f.zone !== ZONE || !link.zone) return;
    const u = layoutFor(link.zone.width, link.zone.height);
    if (f.action === ACTION_CLICK) {
      const t = target(u, f);
      if (t) owners.set(f.id, t);
    }
    const own = owners.get(f.id);
    if (f.action === ACTION_RELEASE) {
      owners.delete(f.id);
      if (own && own.kind === 'tension' && ![...owners.values()].some((o) => o.kind === 'tension')) releaseTension();
      return;
    }
    if (!own) return;
    if (own.kind === 'fader') setSlider(sliders[own.rect.name], f.y, own.rect);
    else if (own.kind === 'tension') bend(Math.min(1, Math.max(0, f.z)));
    else if (f.action === ACTION_CLICK && own.kind === 'preset' && !isSolving()) selectPreset(presetIds[own.rect.index]);
    else if (f.action === ACTION_CLICK && own.kind === 'drum') strikeAt(f);
  }

  function target(u, f) {
    const r = u.faders.find((q) => contains(q, f.x, f.y));
    if (r) return { kind: 'fader', rect: r };
    const p = u.presets.find((q) => contains(q, f.x, f.y));
    if (p) return { kind: 'preset', rect: p };
    if (u.tension && contains(u.tension, f.x, f.y)) return { kind: 'tension', rect: u.tension };
    if (contains(u.drum, f.x, f.y)) return { kind: 'drum', rect: u.drum };
    return null;
  }

  function strikeAt(f) {
    if (state.drawMode || !state.drum || !raster.ready) return;
    const p = raster.toDrum(f.x, f.y);
    if (!containsPoint(p.x, p.y)) return;
    strike(p.x, p.y, Math.min(1, PRESSURE_FLOOR + PRESSURE_SLOPE * f.z));
  }

  const fraction = (input) => (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));

  function paint(rgb, width) {
    const u = ui;
    const note = state.drum && state.freqs && !state.drawMode ? freqToNote(state.freqs[0]) : null;
    paintControls(rgb, width, u, {
      faders: { pitch: fraction(sliders.pitch), bright: fraction(sliders.bright), mallet: fraction(sliders.mallet) },
      note: note ? note.name + note.octave : '',
      selected: presetIds.indexOf(state.presetId),
      tension,
    });
  }

  const link = new EraeLink({
    onStatus: (text) => {
      els.status.textContent = text;
      els.label.textContent = link.connected ? 'disconnect erae' : 'connect erae';
    },
    onFinger,
  });

  els.button.addEventListener('click', async () => {
    if (busy) return;
    if (link.connected) {
      link.disconnect();
      owners.clear();
      if (tension >= 0) releaseTension();
      return;
    }
    // Erae touches are not user gestures, so audio is unlocked by this click.
    if (!state.muted) ensureAudio();
    busy = true;
    try {
      if (SIM_REQUESTED && !simShimLoaded) {
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
      const { width, height } = link.zone;
      const u = layoutFor(width, height);
      let rgb;
      if (state.drawMode || !state.drum) {
        if (!raster.ready) return;
        rgb = raster.blank();
      } else {
        raster.prepare(state.drum, width, height, u.drum);
        const struck = state.view === 'struck' && state.strike;
        rgb = raster.render(state.fieldBuf, struck ? state.strike.refAmp : 1);
      }
      paint(rgb, width);
      if (lastImage && lastImage.every((v, i) => v === rgb[i])) return;
      lastImage = rgb.slice();
      lastSend = now;
      link.send(rgb);
    },
    /** A new drum was solved: the old fit no longer describes it. */
    drumChanged() {
      raster.reset();
      if (link.connected) raster.prepare(state.drum, link.zone.width, link.zone.height, layoutFor(link.zone.width, link.zone.height).drum);
    },
  };
}
