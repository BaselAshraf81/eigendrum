/**
 * Drawing an outline with a finger on the Erae. Pure helpers, no DOM: the stroke
 * space the page's own draw mode uses, a line rasteriser for the live trail, and
 * the LED image of the drawing canvas.
 *
 * The finger's X and Y are floats in LED units, and the touch matrix under the
 * LEDs is much finer than 42 x 24, so points are kept unrounded and only
 * the trail on the LEDs is snapped to a cell.
 */
import { drawButton } from './controls.js';
const BORDER = [46, 34, 12];
const BORDER_ERROR = [230, 20, 10];
const DOT = [4, 3, 3];
const TRAIL = [255, 214, 150]; // bright warm white
const BUTTON_GROUND = [70, 22, 100];
function put(rgb, width, i, j, c) {
  const o = (j * width + i) * 3;
  rgb[o] = c[0];
  rgb[o + 1] = c[1];
  rgb[o + 2] = c[2];
}
/**
 * Zone units to the stroke space of canvas.js (the shorter side spans -1 to 1,
 * y up). One scale for both axes keeps the shape undistorted. The outline is
 * normalised to unit area afterwards, so the size of the Erae does not matter
 * for the sound, only the shape does.
 */
export function toStrokeSpace(x, y, width, height) {
  const half = height / 2;
  return { x: (x - width / 2) / half, y: (y - half) / half };
}
/** Calls plot(i, j) for every LED cell the segment touches, stepping at half an LED. */
export function lineLeds(x0, y0, x1, y1, plot) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    plot(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t));
  }
}
/**
 * The drawing canvas: dim dots across the whole zone, a border, the trail so far
 * and the cancel button. points are zone units. The border goes red while an
 * outline is being refused.
 */
export function paintPen(rgb, width, height, points, button, refused) {
  rgb.fill(0);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) put(rgb, width, i, j, DOT);
  }
  const edge = refused ? BORDER_ERROR : BORDER;
  for (let i = 0; i < width; i++) {
    put(rgb, width, i, 0, edge);
    put(rgb, width, i, height - 1, edge);
  }
  for (let j = 0; j < height; j++) {
    put(rgb, width, 0, j, edge);
    put(rgb, width, width - 1, j, edge);
  }
  const plot = (i, j) => {
    if (i >= 0 && j >= 0 && i < width && j < height) put(rgb, width, i, j, TRAIL);
  };
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const q = points[k - 1] || p;
    lineLeds(q.x, q.y, p.x, p.y, plot);
  }
  if (button) drawButton(rgb, width, button, BUTTON_GROUND);
}
