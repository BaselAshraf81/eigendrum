/**
 * Paints the side controls into an LED image that already holds the drum.
 * Rectangles come from layout.js; values arrive as 0 to 1 so this module never
 * needs to know a slider's units.
 */

// Kept dim beside the drum so the eye goes to the membrane first. None of these
// is red or blue, which the drum uses for the two signs of displacement.
const FADER_COLOURS = {
  pitch: { track: [10, 9, 7], fill: [58, 52, 42], handle: [210, 195, 170] }, // warm white
  bright: { track: [12, 7, 0], fill: [78, 44, 0], handle: [235, 140, 10] }, // amber
  mallet: { track: [0, 10, 4], fill: [8, 66, 28], handle: [60, 215, 105] }, // green
};
const NOTE = [190, 180, 160];
const PRESET_IDLE = [26, 22, 6];
const PRESET_ON = [235, 195, 25]; // chrome yellow marks the selection, as on screen
const TENSION_IDLE = [14, 14, 14];
const TENSION_LIT = [230, 230, 230];

// A 3 x 5 LED font, top row first, only the characters a note name needs.
const GLYPHS = Object.assign(Object.create(null), {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
});

const textWidth = (s) => s.length * 4 - 1;

function put(rgb, width, i, j, c) {
  const o = (j * width + i) * 3;
  rgb[o] = c[0];
  rgb[o + 1] = c[1];
  rgb[o + 2] = c[2];
}

function fillRect(rgb, width, r, c) {
  for (let j = r.y; j < r.y + r.h; j++) {
    for (let i = r.x; i < r.x + r.w; i++) put(rgb, width, i, j, c);
  }
}

function fader(rgb, width, r, value, colours) {
  // Bottom is the minimum. Even at zero the bottom row is the handle, so you can see where it is.
  const top = Math.min(r.h - 1, Math.round(value * (r.h - 1)));
  for (let j = 0; j < r.h; j++) {
    const c = j === top ? colours.handle : j < top ? colours.fill : colours.track;
    for (let i = 0; i < r.w; i++) put(rgb, width, r.x + i, r.y + j, c);
  }
}

function text(rgb, width, r, s) {
  // The octave goes first when space is short: the letter matters more than the digit.
  if (textWidth(s) > r.w) s = s.replace(/\d+$/, '');
  if (textWidth(s) > r.w) return;
  let x = r.x + Math.floor((r.w - textWidth(s)) / 2);
  for (const ch of s) {
    const g = GLYPHS[ch];
    if (!g) return;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (g[row][col] === '#') put(rgb, width, x + col, r.y + r.h - 1 - row, NOTE);
      }
    }
    x += 4;
  }
}

/**
 * ui: the layout. values: { faders: { pitch, bright, mallet } as 0 to 1,
 * note: a name like 'F#3' or '', selected: index of the lit preset or -1,
 * tension: 0 to 1, or -1 when no finger holds the strip }.
 */
export function paintControls(rgb, width, ui, values) {
  for (const r of ui.faders) fader(rgb, width, r, values.faders[r.name], FADER_COLOURS[r.name]);
  if (ui.note && values.note) text(rgb, width, ui.note, values.note);
  for (const r of ui.presets) fillRect(rgb, width, r, r.index === values.selected ? PRESET_ON : PRESET_IDLE);
  if (ui.tension) {
    const t = ui.tension;
    const lit = values.tension < 0 ? 0 : Math.max(1, Math.round(values.tension * t.h));
    fillRect(rgb, width, t, TENSION_IDLE);
    fillRect(rgb, width, { x: t.x, y: t.y, w: t.w, h: lit }, TENSION_LIT);
  }
}
