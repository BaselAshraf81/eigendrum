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

// Colour rule, per command (Erae API V2 Rev 004 PDF, Embodme reference, Python and Henry's JS):
// - SetPixel and DrawRectangle: "3 7-bits bytes", raw SysEx. The device shifts them up, so value << 1.
//   (Henry's set_pixel masks every channel with 0x7F, the Python reference rejects bytes above 0x7F.)
// - DrawImage: "7-bitized 24 bits RGB data". The PDF example sends 0xFF bytes, so it is full 8-bit.
// Not confirmed on hardware, but the same rule is applied to every host with no guessing.
const shift7 = (r, g, b) => [r << 1, g << 1, b << 1];
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
      if (p[0] === 0) setPx(p[1], p[2], shift7(p[3], p[4], p[5]));
      break;
    case 0x22: {
      if (p.length !== 8) return false;
      if (p[0] !== 0) break;
      const c = shift7(p[5], p[6], p[7]);
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
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = (r * w + c) * 3;
        setPx(x0 + c, y0 + r, [rgb[i], rgb[i + 1], rgb[i + 2]]);
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

// ---- drawing: round LEDs under a frosted diffuser ----
const fingers = new Map(); // pointerId -> { id: 8 bytes, x, y, z }
let pitch = 1, ox = 0, oy = 0, queued = false, panel = null;
const ledXY = (x, y) => [ox + (x + 0.5) * pitch, oy + (H - 1 - y + 0.5) * pitch]; // y = 0 is the bottom row
// Static layer: bezel, diffuser with a soft sheen and fine grain, and the unlit LED dots beneath it.
function buildPanel() {
  panel = document.createElement('canvas');
  panel.width = canvas.width; panel.height = canvas.height;
  const p = panel.getContext('2d'), bz = pitch * 0.8;
  const x0 = ox - bz, y0 = oy - bz, w = W * pitch + 2 * bz, h = H * pitch + 2 * bz;
  p.fillStyle = '#0b0b0e'; p.fillRect(0, 0, panel.width, panel.height);
  p.fillStyle = '#26262d'; p.beginPath(); p.roundRect(x0, y0, w, h, pitch * 1.2); p.fill();
  p.save(); p.beginPath(); p.roundRect(ox - bz * 0.35, oy - bz * 0.35, W * pitch + bz * 0.7, H * pitch + bz * 0.7, pitch * 0.8); p.clip();
  const g = p.createLinearGradient(ox, oy, ox + W * pitch, oy + H * pitch);
  g.addColorStop(0, '#c4c4c8'); g.addColorStop(0.5, '#b4b4b9'); g.addColorStop(1, '#a6a6ac');
  p.fillStyle = g; p.fillRect(x0, y0, w, h);
  for (let i = 0; i < 6000; i++) { // grain, so the cover reads as plastic and not flat paint
    p.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.05)';
    p.fillRect(ox + Math.random() * W * pitch, oy + Math.random() * H * pitch, 1, 1);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [cx, cy] = ledXY(x, y);
    const d = p.createRadialGradient(cx, cy, 0, cx, cy, pitch * 0.32);
    d.addColorStop(0, 'rgba(40,40,60,0.16)'); d.addColorStop(1, 'rgba(40,40,60,0)');
    p.fillStyle = d; p.beginPath(); p.arc(cx, cy, pitch * 0.32, 0, Math.PI * 2); p.fill();
  }
  p.restore();
}
function drawLeds() {
  ctx.save();
  ctx.beginPath(); ctx.roundRect(ox, oy, W * pitch, H * pitch, pitch * 0.5); ctx.clip();
  const R = pitch * 0.85; // each LED is a distinct round disc with a soft edge and a faint halo
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (!(r || g || b)) continue;
    const [cx, cy] = ledXY(x, y);
    const k = Math.max(r, g, b) / 255; // dim LEDs are fainter
    const c = (a) => `rgba(${r},${g},${b},${a * (0.35 + 0.65 * k)})`;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    gr.addColorStop(0, `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},${0.35 + 0.65 * k})`);
    gr.addColorStop(0.25, c(1));
    gr.addColorStop(0.45, c(0.9));
    gr.addColorStop(0.58, c(0.3));
    gr.addColorStop(1, c(0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  }  ctx.restore();
}
function drawFingers() {
  for (const f of fingers.values()) {
    const cx = ox + f.x * pitch, cy = oy + (H - f.y) * pitch;
    ctx.beginPath(); ctx.arc(cx, cy, pitch * 0.5, 0, Math.PI * 2);
    const lw = pitch * (0.08 + 0.14 * f.z); // pressure shows as ring thickness
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = lw + 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(15,15,25,0.8)'; ctx.lineWidth = lw; ctx.stroke();
  }
}
function draw() { // redraws only when the framebuffer or a finger changed, at most once per frame
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    ctx.drawImage(panel, 0, 0);
    drawLeds();
    drawFingers();
  });
}
function resize() {
  const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * d));
  canvas.height = Math.max(1, Math.round(r.height * d));
  pitch = Math.min(canvas.width / (W + 2.6), canvas.height / (H + 2.6)); // equal pitch in X and Y, room for the bezel
  ox = (canvas.width - W * pitch) / 2;
  oy = (canvas.height - H * pitch) / 2;
  buildPanel();
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
  return { x: (px - ox) / pitch, y: H - (py - oy) / pitch };
}
const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
function pressure(e) {
  return e && e.pressure !== 0 && e.pressure !== 0.5 ? e.pressure : Number($('press').value);
}
function touch(action, e, f, p) {
  f.x = p.x; f.y = p.y; f.z = pressure(e);
  if (st.streaming) send(fingerMessage(action, f, f.x, f.y, f.z));
  draw();
}
// A finger exists only while its pointer is down. Every way a pointer can end funnels into release().
function release(pointerId, e) {
  const f = fingers.get(pointerId);
  if (!f) return;
  fingers.delete(pointerId);
  const p = e ? local(e) : f;
  touch(2, e, f, inside(p) ? p : f); // an outside release reports the last position inside the zone
}
function releaseAll() { for (const id of [...fingers.keys()]) release(id, null); }
canvas.addEventListener('pointerdown', (e) => {
  const p = local(e);
  if (!inside(p)) return;
  release(e.pointerId, null); // never two fingers for one pointer
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events have no active pointer */ }
  const f = { id: Array.from(crypto.getRandomValues(new Uint8Array(8))), x: p.x, y: p.y, z: 0 };
  fingers.set(e.pointerId, f);
  touch(0, e, f, p);
});
canvas.addEventListener('pointermove', (e) => {
  const f = fingers.get(e.pointerId), p = local(e);
  if (f && inside(p)) touch(1, e, f, p);
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => release(e.pointerId, e));
canvas.addEventListener('lostpointercapture', (e) => release(e.pointerId, null));
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
status();