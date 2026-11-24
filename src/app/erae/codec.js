// Pure Erae 2 byte functions, no DOM. Layouts follow Embodme's Python reference (erae/utils.py, erae_api_sysex.py).

export const bitizedSize = (n) => Math.floor(n / 7) * 8 + (n % 7 ? 1 + (n % 7) : 0);

export function bitize(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 7) {
    const grp = data.slice(i, i + 7);
    out.push(grp.reduce((a, b, j) => a | ((b & 0x80) >> (j + 1)), 0));
    for (const b of grp) out.push(b & 0x7f);
  }
  return out;
}

export function unbitize(w) {
  const out = [];
  for (let i = 0; i < w.length; i += 8) {
    for (let j = 0; j < 7 && i + j + 1 < w.length; j++) out.push(((w[i] << (j + 1)) & 0x80) | w[i + j + 1]);
  }
  return out;
}

export const xor = (a) => a.reduce((x, y) => x ^ y, 0);
// Host to device: F0, Embodme + Erae 2 prefix, device ID 01, services group 01, API service 04, sub, payload, F7.
const API = [0xf0, 0x00, 0x21, 0x50, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x04];
const api = (sub, payload = []) => [...API, sub, ...payload, 0xf7];
export const apiEnable = (tag) => api(0x01, tag);
export const apiDisable = () => api(0x02);
export const zoneBoundaryRequest = (zone) => api(0x10, [zone]);
// rgb is w*h*3 full 8-bit bytes, row 0 painted at zone row y (bottom-up).
export function drawImage(zone, x, y, w, h, rgb) {
  const wire = bitize(rgb);
  return api(0x23, [zone, x, y, w, h, ...wire, xor(wire)]);
}

// Finger Stream message: F0 tag action zone fingerId(8 -> 10 bytes) xyz(3 float32 LE -> 14 bytes) checksum F7
export function encodeFinger(tag, action, zone, id, x, y, z) {
  const xyz = bitize(Array.from(new Uint8Array(new Float32Array([x, y, z]).buffer)));
  return [0xf0, ...tag, action, zone, ...bitize(id), ...xyz, xor(xyz), 0xf7];
}

// Mirrors EraeAPISysex.receive_midi_message. `prefix` is the reply tag. Returns null when the
// message is not for this prefix. Like the reference, the version branch is a second `if`, not an `else`.
export function decodeReply(msg, prefix) {
  if (msg[0] !== 0xf0 || msg[msg.length - 1] !== 0xf7) return null;
  const s = Array.from(msg).slice(1, -1);
  if (!(s.length > prefix.length && prefix.every((v, i) => s[i] === v))) return null;
  let o = prefix.length;
  if (s[o] === 0x7f) {
    o++;
    const out = {};
    if (s[o] === 0x01) {
      o++; out.kind = 'zone'; out.zone = s[o++]; out.width = s[o++]; out.height = s[o];
    }
    if (s[o] === 0x02) { o++; out.kind = 'version'; out.version = s[o]; }
    return out;
  }
  const action = s[o++] & 0x07, zone = s[o++];
  const idLen = bitizedSize(8), xyzLen = bitizedSize(12);
  const idData = s.slice(o, o + idLen); o += idLen;
  const xyzData = s.slice(o, o + xyzLen); o += xyzLen;
  const sum = s[o];
  const idBytes = new Uint8Array(unbitize(idData));
  const id = new DataView(idBytes.buffer).getBigUint64(0, true);
  const f = new DataView(new Uint8Array(unbitize(xyzData)).buffer);
  return { kind: 'finger', id, zone, action, x: f.getFloat32(0, true), y: f.getFloat32(4, true), z: f.getFloat32(8, true),
    checksumOk: sum === xor(xyzData) };
}
