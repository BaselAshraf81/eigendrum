/**
 * The one owner of the solver worker.
 *
 * Every mode of the game (chapters, draw, free) asks for drums through here, so
 * there is a single request/reply protocol, a single generation counter, and a
 * single place where a stale reply is discarded.
 */

const worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 0;
let onProgress = null;

worker.onmessage = ({ data }) => {
  if (data.progress !== undefined) {
    if (onProgress) onProgress(data.progress);
    return;
  }
  const resolve = pending.get(data.id);
  if (!resolve) return;
  pending.delete(data.id);
  resolve(data);
};

worker.onerror = (event) => {
  // Fail every outstanding request rather than leaving a caller awaiting forever.
  const message = event.message || 'the solver worker failed';
  for (const [, resolve] of pending) resolve({ ok: false, error: message });
  pending.clear();
};

export function setProgressHandler(fn) {
  onProgress = fn;
}

/**
 * Solves a shape and builds the amplitude table for one mallet radius.
 *
 * `shapeId` is only a cache key for the solve itself. Pass a fresh key for drawn
 * shapes, or two different outlines would collide onto one cached solution.
 */
export function requestDrum({ shapeId, polygon, align = 0, mallet, targetNodes, modeCount }) {
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, shapeId, polygon, align, mallet, targetNodes, modeCount });
  });
}
