// Simulated Erae 2 surface. Byte layouts follow Embodme's Python reference (erae/utils.py).
const W = 42, H = 24, MAX_PIXELS = 1008;
const HEADER = [0x00, 0x21, 0x50, 0x00, 0x01, 0x00, 0x02];
const chan = new BroadcastChannel('erae-sim');

const $ = (id) => document.getElementById(id);
const canvas = $('led'), ctx = canvas.getContext('2d');
const pixels = new Uint8ClampedArray(W * H * 3); // index (y * W + x) * 3, y = 0 is the bottom row

const st = { streaming: false, tag: [], last: 'none', rx: 0, tx: 0, dropped: 0 };
const logIn = [], logOut = [];

// ---- 7-bit packing ----
const bitizedSize = (n) => Math.floor(n / 7) * 8 + (n % 7 ? 1 + (n % 7) : 0);
function bitize(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 7) {
    const grp = data.slice(i, i + 7);
    out.push(grp.reduce((a, b, j) => a | ((b & 0x80) >> (j + 1)), 0));
    for (const b of grp) out.push(b & 0x7f);
  }
  return out;
}
function unbitize(w) {
  const out = [];
  for (let i = 0; i < w.length; i += 8) {
    for (let j = 0; j < 7 && i + j + 1 < w.length; j++) out.push(((w[i] << (j + 1)) & 0x80) | w[i + j + 1]);
  }
  return out;
}
const xor = (a) => a.reduce((x, y) => x ^ y, 0);

// Colour: the spec says 7-bit per channel, shifted up by the device. Henry's page sends 0-255.
// Accept both: any channel above 0x7F means the host sent 8-bit. Unverified on hardware.
function colour(r, g, b, wide = r > 0x7f || g > 0x7f || b > 0x7f) {
  return [r, g, b].map((c) => (wide ? c : c * 2));
}
function setPx(x, y, rgb) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  pixels.set(rgb, (y * W + x) * 3);
}

// ---- log and status ----
function note(list, el, bytes) {
  list.push(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' '));
  if (list.length > 30) list.shift();
  el.textContent = list.join('\n');
}
function status() {
  $('status').textContent = `streaming ${st.streaming ? 'on' : 'off'} | last: ${st.last} | in ${st.rx} out ${st.tx} | dropped ${st.dropped}`;
}
function send(bytes) {
  chan.postMessage({ to: 'host', bytes });
  st.tx++;
  note(logOut, $('logOut'), bytes);
  status();
}

// ---- host commands ----
const NAMES = { 1: 'StartFingerDataStreaming', 2: 'EndFingerDataStreaming', 0x10: 'ZoneBoundaryRequest', 0x20: 'Clear',
  0x21: 'SetPixel', 0x22: 'DrawRectangle', 0x23: 'DrawImage', 0x7f: 'VersionRequest' };

function handle(m) {
  if (m.length < 14 || m[0] !== 0xf0 || m[m.length - 1] !== 0xf7) return false;
  const b = m.slice(1, -1);
  if (b.some((v) => v > 0x7f)) return false;
  if (HEADER.some((v, i) => b[i] !== v)) return false;
  if ((b[7] !== 0x01 && b[7] !== 0x7f) || b[8] !== 0x01 || b[9] !== 0x04) return false;
  const sub = b[10], p = b.slice(11);
  switch (sub) {
    case 0x01:
      if (p.length > 16) return false; // real device: streaming just stays off
      st.tag = p; st.streaming = true; break;
    case 0x02:
      if (p.length) return false;
      st.streaming = false; break;
    case 0x10:
      if (p.length !== 1) return false;
      if (st.streaming) send([0xf0, ...st.tag, 0x7f, 0x01, p[0], p[0] === 0 ? W : 0x7f, p[0] === 0 ? H : 0x7f, 0xf7]);
      break;
    case 0x7f: // the request carries its own reply tag (Python reference), so it works before API mode is on
      if (p.length > 16) return false;
      send([0xf0, ...(p.length ? p : st.tag), 0x7f, 0x02, 0x02, 0xf7]);
      break;
    case 0x20:
      if (p.length !== 1) return false;
      if (p[0] === 0) pixels.fill(0);
      break;
    case 0x21:
      if (p.length !== 6) return false;
      if (p[0] === 0) setPx(p[1], p[2], colour(p[3], p[4], p[5]));
      break;
    case 0x22: {
      if (p.length !== 8) return false;
      if (p[0] !== 0) break;
      const c = colour(p[5], p[6], p[7]);
      for (let y = p[2]; y < p[2] + p[4]; y++) for (let x = p[1]; x < p[1] + p[3]; x++) setPx(x, y, c);
      break;
    }
    case 0x23: {
      if (p.length < 6) return false;
      const [zone, x0, y0, w, h] = p;
      const n = w * h * 3;
      if (w * h < 1 || w * h > MAX_PIXELS || p.length !== 5 + bitizedSize(n) + 1) return false;
      const wire = p.slice(5, -1);
      if (xor(wire) !== p[p.length - 1]) return false;
      const rgb = unbitize(wire);
      if (rgb.length !== n) return false;
      if (zone !== 0) break;
      const wide = rgb.some((v) => v > 0x7f); // decide per image, not per pixel
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = (r * w + c) * 3;
        setPx(x0 + c, y0 + r, colour(rgb[i], rgb[i + 1], rgb[i + 2], wide));
      }
      break;
    }
    default: return false;
  }
  st.last = NAMES[sub];
  return true;
}

chan.onmessage = (e) => {
  if (!e.data || e.data.to !== 'device') return;
  const m = e.data.bytes;
  st.rx++;
  note(logIn, $('logIn'), m);
  if (!handle(m)) st.dropped++;
  status();
  draw();
};

// ---- drawing ----
const fingers = new Map(); // pointerId -> { id: 8 bytes, x, y }
let cell = 1, ox = 0, oy = 0, queued = false;

function draw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const cw = canvas.width, ch = canvas.height;
    ctx.fillStyle = '#08080a'; ctx.fillRect(0, 0, cw, ch);
    const gap = Math.max(1, cell * 0.12);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const lit = pixels[i] || pixels[i + 1] || pixels[i + 2];
      ctx.fillStyle = lit ? `rgb(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]})` : '#17171d';
      ctx.fillRect(ox + x * cell + gap / 2, oy + (H - 1 - y) * cell + gap / 2, cell - gap, cell - gap);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = Math.max(1, cell * 0.08);
    ctx.strokeRect(ox, oy, W * cell, H * cell); // zone 0 covers the whole surface
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, cell * 0.15);
    for (const f of fingers.values()) {
      ctx.beginPath();
      ctx.arc(ox + f.x * cell, oy + (H - f.y) * cell, cell * 1.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}
function resize() {
  const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * d));
  canvas.height = Math.max(1, Math.round(r.height * d));
  cell = Math.min(canvas.width / W, canvas.height / H);
  ox = (canvas.width - W * cell) / 2;
  oy = (canvas.height - H * cell) / 2;
  draw();
}
new ResizeObserver(resize).observe(canvas);

// ---- touch ----
$('press').addEventListener('input', () => { $('pv').textContent = Number($('press').value).toFixed(2); });

function fingerMessage(action, f, x, y, z) {
  const xyz = bitize(Array.from(new Uint8Array(new Float32Array([x, y, z]).buffer)));
  return [0xf0, ...st.tag, action, 0, ...bitize(f.id), ...xyz, xor(xyz), 0xf7];
}
function local(e) {
  const r = canvas.getBoundingClientRect(), d = canvas.width / r.width;
  const px = (e.clientX - r.left) * d, py = (e.clientY - r.top) * d;
  return { x: (px - ox) / cell, y: H - (py - oy) / cell };
}
const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
function pressure(e) {
  return e.pressure !== 0 && e.pressure !== 0.5 ? e.pressure : Number($('press').value);
}
function touch(action, e, f, p) {
  f.x = p.x; f.y = p.y;
  if (st.streaming) send(fingerMessage(action, f, p.x, p.y, pressure(e)));
  draw();
}

canvas.addEventListener('pointerdown', (e) => {
  const p = local(e);
  if (!inside(p)) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events have no active pointer */ }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)));
  const f = { id, x: p.x, y: p.y };
  fingers.set(e.pointerId, f);
  touch(0, e, f, p);
});
canvas.addEventListener('pointermove', (e) => {
  const f = fingers.get(e.pointerId), p = local(e);
  if (f && inside(p)) touch(1, e, f, p);
});
function up(e) {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  fingers.delete(e.pointerId);
  const p = local(e);
  touch(2, e, f, inside(p) ? p : f); // an outside release reports the last position inside the zone
}
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);

status();
