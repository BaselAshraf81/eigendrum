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

/** Reads `#p=<id>` (preset) or `#s=<encoded>` (custom shape). */
export function readHash(hash = location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const preset = params.get('p');
  const shape = params.get('s');
  if (shape) {
    const polygon = decodeShape(shape);
    if (polygon) return { kind: 'custom', polygon };
  }
  if (preset) return { kind: 'preset', id: preset };
  return null;
}

export function writeHash({ kind, id, polygon }, replace = true) {
  const params = new URLSearchParams();
  if (kind === 'preset') params.set('p', id);
  else if (kind === 'custom') params.set('s', encodeShape(polygon));
  const url = `${location.pathname}${location.search}#${params.toString()}`;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

export function shareUrl(state) {
  const params = new URLSearchParams();
  if (state.kind === 'preset') params.set('p', state.id);
  else params.set('s', encodeShape(state.polygon));
  return `${location.origin}${location.pathname}#${params.toString()}`;
}
