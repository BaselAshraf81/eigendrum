/**
 * Putting a shape in the URL, so a drum you drew can be sent to someone else.
 *
 * Coordinates are quantised to signed 16-bit fixed point over a +/-4 range,
 * which is far finer than the mesh could resolve, then base64url encoded. A
 * 120-vertex outline lands in about 640 characters.
 */

const SCALE = 8192; // 2^13, giving a range of +/-4 in Int16

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '==='.slice((padded.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeShape(polygon) {
  const view = new DataView(new ArrayBuffer(polygon.length * 4));
  polygon.forEach((p, i) => {
    const qx = Math.max(-32768, Math.min(32767, Math.round(p.x * SCALE)));
    const qy = Math.max(-32768, Math.min(32767, Math.round(p.y * SCALE)));
    view.setInt16(i * 4, qx, true);
    view.setInt16(i * 4 + 2, qy, true);
  });
  return toBase64Url(new Uint8Array(view.buffer));
}

export function decodeShape(encoded) {
  try {
    const bytes = fromBase64Url(encoded);
    if (bytes.length < 12 || bytes.length % 4 !== 0) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = [];
    for (let i = 0; i < bytes.length / 4; i++) {
      out.push({
        x: view.getInt16(i * 4, true) / SCALE,
        y: view.getInt16(i * 4 + 2, true) / SCALE,
      });
    }
    return out.length >= 3 ? out : null;
  } catch {
    return null;
  }
}

/**
 * A formula travels as its own text, not as the polygon it produced.
 *
 * That is the point of having formulas at all: `#f=p:1+0.3cos(5t)` is a shape you
 * can read, retype and edit, where `#s=` is 640 characters of base64 nobody can do
 * anything with. It also survives a change to the sampler, since the recipe is
 * stored rather than one sampling of it.
 *
 * `~` separates x from y. It is not in the expression language's vocabulary at all,
 * so it cannot collide with anything a formula can legally contain.
 */
/**
 * Percent-encodes only what would actually break a URL fragment.
 *
 * `URLSearchParams` was the obvious tool and it is the wrong one here, twice over.
 * It escapes `:` `(` `)` and encodes a space as `+`, so `r = 1 + 0.3cos(5t)` came
 * out as `f=p%3A1+%2B+0.3cos%285t%29` - unreadable, which defeats the entire reason
 * for storing a formula as text. Worse, on the way back in it decodes `+` to a
 * space, so a link somebody typed by hand with a plus sign in it would arrive
 * meaning something else. The expression language's other characters are all legal
 * in a fragment as they stand.
 */
const NEEDS_ESCAPE = /[%#&=?|\s]/g;
const escapeFormula = (s) =>
  s.replace(NEEDS_ESCAPE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

function encodeFormula(formula) {
  if (formula.kind === 'polar') return `p:${escapeFormula(formula.r)}`;
  return `q:${escapeFormula(formula.x)}~${escapeFormula(formula.y)}`;
}

/** Pulls `f=` out of a fragment by hand, so `+` survives as a plus. */
function rawFormulaParam(fragment) {
  for (const part of fragment.split('&')) {
    if (part.startsWith('f=')) {
      try {
        return decodeURIComponent(part.slice(2));
      } catch {
        return null; // a malformed escape is just an unreadable link
      }
    }
  }
  return null;
}

function decodeFormula(raw) {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  if (raw.startsWith('p:')) {
    const r = raw.slice(2);
    return r ? { kind: 'polar', r } : null;
  }
  if (raw.startsWith('q:')) {
    const parts = raw.slice(2).split('~');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { kind: 'parametric', x: parts[0], y: parts[1] };
  }
  return null;
}

/** Reads `#p=<id>` (preset), `#f=<formula>`, or `#s=<encoded>` (traced shape). */
export function readHash(hash = location.hash) {
  const fragment = hash.replace(/^#/, '');
  const params = new URLSearchParams(fragment);
  const preset = params.get('p');
  const shape = params.get('s');
  const formula = rawFormulaParam(fragment);
  if (formula) {
    // Never trusted: the caller still has to compile and validate it. The parser
    // cannot execute anything, so the worst a hostile link achieves is an error
    // message.
    const parsed = decodeFormula(formula);
    if (parsed) return { kind: 'formula', formula: parsed };
  }
  if (shape) {
    const polygon = decodeShape(shape);
    if (polygon) return { kind: 'custom', polygon };
  }
  if (preset) return { kind: 'preset', id: preset };
  return null;
}

function fragmentFor({ kind, id, polygon, formula }) {
  // Built as a string rather than through URLSearchParams so the formula case keeps
  // its own escaping. The preset id and the base64 shape contain nothing that needs
  // escaping in the first place.
  if (kind === 'preset') return `p=${encodeURIComponent(id)}`;
  if (kind === 'formula') return `f=${encodeFormula(formula)}`;
  if (polygon) return `s=${encodeShape(polygon)}`;
  return '';
}

export function writeHash(source, replace = true) {
  const url = `${location.pathname}${location.search}#${fragmentFor(source)}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

export function shareUrl(state) {
  return `${location.origin}${location.pathname}#${fragmentFor(state)}`;
}
