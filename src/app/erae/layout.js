/**
 * Where everything sits on the Erae's API zone. Pure maths, no DOM: given the
 * zone size it returns named rectangles in LED units, { x, y, w, h }, with
 * y = 0 the bottom row like the rest of the Erae code.
 *
 * On the usual 42 x 24 surface:
 *   columns 0 to 8    three faders (pitch, ring-out, mallet)
 *   columns 9 to 32   the drum
 *   columns 33 to 41  note name on top, preset buttons and the draw button, tension strip at the edge
 */

// Each side panel is nine columns: three 2-wide faders with a dark column after each.
const SIDE = 9;
// Below this width the drum would be squeezed to nothing, so it gets the whole zone.
const MIN_WIDTH_FOR_CONTROLS = 34;
const FADER_W = 2;
const NOTE_H = 5;
const BUTTON = 2;
const BUTTON_STEP = 3; // a 2 x 2 button and one dark LED

export const FADERS = ['pitch', 'bright', 'mallet'];

export const contains = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** presetCount: how many preset buttons to place. Buttons that do not fit are left out. */
export function layout(width, height, presetCount) {
  if (width < MIN_WIDTH_FOR_CONTROLS) {
    return { drum: { x: 0, y: 0, w: width, h: height }, faders: [], note: null, presets: [], draw: null, tension: null };
  }
  const drum = { x: SIDE, y: 0, w: width - 2 * SIDE, h: height };
  const faders = FADERS.map((name, i) => ({ name, x: i * (FADER_W + 1), y: 0, w: FADER_W, h: height }));

  const right = width - SIDE;
  // The note sits against the top edge, with one dark row under it.
  const note = { x: right, y: height - NOTE_H, w: SIDE, h: NOTE_H };
  const below = height - NOTE_H - 1;
  const tension = { x: width - 2, y: 0, w: 2, h: below };

  // Buttons fill the columns left of the strip, top row first, reading left to right.
  const cols = Math.floor((SIDE - 2) / BUTTON_STEP);
  const rows = Math.floor((below + 1) / BUTTON_STEP);
  const slot = (k) => ({ x: right + (k % cols) * BUTTON_STEP, y: below - BUTTON - Math.floor(k / cols) * BUTTON_STEP, w: BUTTON, h: BUTTON });
  const presets = [];
  for (let k = 0; k < Math.min(presetCount, cols * rows); k++) presets.push({ index: k, ...slot(k) });
  // The draw button takes the next free place after the presets, if the grid still has one.
  const draw = presetCount < cols * rows ? slot(presetCount) : null;
  return { drum, faders, note, presets, draw, tension };
}
