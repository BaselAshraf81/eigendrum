// Simulated Erae 2 surface. Byte layouts follow Embodme's Python reference (erae/utils.py).
import { bitizedSize, unbitize, xor, encodeFinger } from '../../src/app/erae/codec.js';
const W = 42;
const H = 24;
const MAX_PIXELS = 1008;
const HEADER = [0x00, 0x21, 0x50, 0x00, 0x01, 0x00, 0x02];
const chan = new BroadcastChannel('erae-sim');

const $ = (id) => document.getElementById(id);
const canvas = $('led');
const ctx = canvas.getContext('2d');
const pixels = new Uint8ClampedArray(W * H * 3); // index (y * W + x) * 3, y = 0 is the bottom row

const st = { streaming: false, tag: [], last: 'none', rx: 0, tx: 0, dropped: 0 };
const logIn = [], logOut = [];

// Colour rule, per command (Erae API V2 Rev 004 PDF, Embodme reference, Python and the vendor JS example):
// - SetPixel and DrawRectangle: "3 7-bits bytes", raw SysEx. The device shifts them up, so value << 1.
//   (The vendor set_pixel masks every channel with 0x7F, the Python reference rejects bytes above 0x7F.)
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
const NAMES = {
  1: 'StartFingerDataStreaming',
  2: 'EndFingerDataStreaming',
  0x10: 'ZoneBoundaryRequest',
  0x20: 'Clear',
  0x21: 'SetPixel',
  0x22: 'DrawRectangle',
  0x23: 'DrawImage',
  0x7f: 'VersionRequest',
};

function handle(m) {
  if (m.length < 13 || m[0] !== 0xf0 || m[m.length - 1] !== 0xf7) return false;
  const b = m.slice(1, -1);
  if (b.some((v) => v > 0x7f)) return false;
  if (HEADER.some((v, i) => b[i] !== v)) return false;
  if ((b[7] !== 0x01 && b[7] !== 0x7f) || b[8] !== 0x01 || b[9] !== 0x04) return false;
  const sub = b[10];
  const p = b.slice(11);
  switch (sub) {
    case 0x01:
      if (p.length > 16) return false; // real device: streaming just stays off
      st.tag = p;
      st.streaming = true;
      break;
    case 0x02:
      if (p.length) return false;
      st.streaming = false;
      break;
    case 0x10:
      if (p.length !== 1) return false;
      if (st.streaming) {
        const known = p[0] === 0;
        send([0xf0, ...st.tag, 0x7f, 0x01, p[0], known ? W : 0x7f, known ? H : 0x7f, 0xf7]);
      }
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
      for (let y = p[2]; y < p[2] + p[4]; y++) {
        for (let x = p[1]; x < p[1] + p[3]; x++) setPx(x, y, c);
      }
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
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const i = (r * w + c) * 3;
          setPx(x0 + c, y0 + r, [rgb[i], rgb[i + 1], rgb[i + 2]]);
        }
      }
      break;
    }
    default: return false;
  }
  st.last = NAMES[sub];
  return true;
}

const perf = { handleMs: 0, frames: 0, renderMax: 0 };
chan.onmessage = (e) => {
  if (!e.data || e.data.to !== 'device') return;
  if (e.data.peek) {
    if (e.data.resetPerf) {
      perf.handleMs = 0;
      perf.frames = 0;
      perf.renderMax = 0;
    }
    // dev-only read-back for tools/erae-sim/check.js, never changes pixels
    chan.postMessage({
      to: 'host',
      peekReply: {
        pixels: Array.from(pixels),
        fingers: fingers.size,
        streaming: st.streaming,
        tag: st.tag,
        dropped: st.dropped,
        rx: st.rx,
        perf,
      },
    });
    return;
  }
  const t0 = performance.now();
  const m = e.data.bytes;
  st.rx++;
  note(logIn, $('logIn'), m);
  if (!handle(m)) st.dropped++;
  status();
  draw();
  perf.handleMs += performance.now() - t0;
  perf.frames++;
};

// ---- drawing: crisp round LEDs under a frosted diffuser, in a charcoal frame ----
// Layout in LED pitches (device is 402 x 277 mm, matrix fills nearly the whole body below a top strip).
const FRAME = 1;
const STRIP = 3.4;
const BODY_W = W + 2 * FRAME;
const BODY_H = H + STRIP + 2 * FRAME;
const fingers = new Map(); // pointerId -> { id: 8 bytes, x, y, z }
let pitch = 1;
let ox = 0;
let oy = 0;
let bx = 0;
let by = 0;
let queued = false;
let panel = null;
let dark = true;
const ledXY = (x, y) => [ox + (x + 0.5) * pitch, oy + (H - 1 - y + 0.5) * pitch]; // y = 0 is the bottom row
const SURFACE = {
  dark: ['#3b3b40', '#2f2f34'],
  room: ['#f1f1f2', '#e4e4e6'],
}; // dim room (photo 2), room light (photo 1)
// Decorative top strip: logo, 8 numbered round buttons, small LCD and wheel. Not wired to anything.
function drawStrip(p) {
  const top = by + FRAME * pitch;
  const mid = top + (STRIP * pitch) / 2;
  const ink = '#d8d8dc';
  const disc = (cx, cy, r, fill, stroke) => {
    p.beginPath();
    p.arc(cx, cy, r, 0, Math.PI * 2);
    p.fillStyle = fill;
    p.fill();
    if (stroke) {
      p.strokeStyle = stroke;
      p.lineWidth = 1;
      p.stroke();
    }
  };
  p.fillStyle = ink;
  p.textBaseline = 'alphabetic';
  p.font = `600 ${pitch * 1.5}px system-ui, sans-serif`;
  p.fillText('erae', bx + 1.6 * pitch, mid + pitch * 0.35);
  p.font = `${pitch * 0.42}px system-ui, sans-serif`;
  p.fillStyle = '#9a9aa2';
  p.fillText('Expressive Controller & Looper', bx + 1.6 * pitch, mid + pitch * 1.05);
  p.textAlign = 'center';
  p.textBaseline = 'middle';
  p.font = `${pitch * 0.4}px system-ui, sans-serif`;
  for (let i = 0; i < 8; i++) {
    const cx = bx + (11 + (i % 4) * 1.7) * pitch;
    const cy = mid + (i < 4 ? -0.8 : 0.8) * pitch;
    disc(cx, cy, pitch * 0.5, '#33333a', '#55555e');
    p.fillStyle = ink;
    p.fillText(String(i + 1), cx, cy);
  }
  // looper, octave and scale buttons
  for (let i = 0; i < 6; i++) disc(bx + (19.5 + i * 1.4) * pitch, mid, pitch * 0.32, '#33333a', '#55555e');
  disc(bx + (BODY_W - 7.6) * pitch, mid, pitch * 0.62, '#0e0e12', '#55555e'); // LCD
  disc(bx + (BODY_W - 3.3) * pitch, mid, pitch * 1.3, '#2c2c33', '#55555e'); // click wheel
  disc(bx + (BODY_W - 3.3) * pitch, mid, pitch * 0.5, '#1d1d22', '#44444c');
  p.save();
  p.translate(bx + (BODY_W - FRAME / 2) * pitch, oy + (H * pitch) / 2);
  p.rotate(Math.PI / 2);
  p.fillStyle = '#8a8a92';
  p.font = `${pitch * 0.5}px system-ui, sans-serif`;
  p.fillText('embodme', 0, 0);
  p.restore();
  p.textAlign = 'start';
}// Static layer: frame, strip and a smooth frosted surface. Unlit LEDs are invisible.
function buildPanel() {
  panel = document.createElement('canvas');
  panel.width = canvas.width;
  panel.height = canvas.height;
  const p = panel.getContext('2d');
  const c = SURFACE[dark ? 'dark' : 'room'];
  p.fillStyle = '#0b0b0e';
  p.fillRect(0, 0, panel.width, panel.height);
  p.fillStyle = '#1f1f24';
  p.beginPath();
  p.roundRect(bx, by, BODY_W * pitch, BODY_H * pitch, pitch * 1.6);
  p.fill();
  drawStrip(p);
  const g = p.createLinearGradient(ox, oy, ox, oy + H * pitch);
  g.addColorStop(0, c[0]);
  g.addColorStop(1, c[1]);
  p.fillStyle = g;
  p.beginPath();
  p.roundRect(ox, oy, W * pitch, H * pitch, pitch * 0.4);
  p.fill();
}
function drawLeds() {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(ox, oy, W * pitch, H * pitch, pitch * 0.4);
  ctx.clip();
  const lit = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit.push([x, y, pixels[i], pixels[i + 1], pixels[i + 2]]);
    }
  }
  // Halos first (additive in a dark room), then every core on top so the cores stay sharp.
  ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
  for (const [x, y, r, g, b] of lit) {
    const [cx, cy] = ledXY(x, y);
    const k = Math.max(r, g, b) / 255;
    const gr = ctx.createRadialGradient(cx, cy, pitch * 0.2, cx, cy, pitch);
    gr.addColorStop(0, `rgba(${r},${g},${b},${0.45 * k})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(cx, cy, pitch, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const [x, y, r, g, b] of lit) {
    const [cx, cy] = ledXY(x, y);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.arc(cx, cy, pitch * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function drawFingers() {
  for (const f of fingers.values()) {
    const cx = ox + f.x * pitch, cy = oy + (H - f.y) * pitch;
    ctx.beginPath();
    ctx.arc(cx, cy, pitch * 0.5, 0, Math.PI * 2);
    const lw = pitch * (0.08 + 0.14 * f.z); // pressure shows as ring thickness
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = lw + 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(15,15,25,0.8)';
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}
function draw() { // redraws only when the framebuffer or a finger changed, at most once per frame
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    const t0 = performance.now();
    queued = false;
    ctx.drawImage(panel, 0, 0);
    drawLeds();
    drawFingers();
    perf.renderMax = Math.max(perf.renderMax, performance.now() - t0);
  });
}
function resize() {
  const r = canvas.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * d));
  canvas.height = Math.max(1, Math.round(r.height * d));
  pitch = Math.min(canvas.width / (BODY_W + 0.6), canvas.height / (BODY_H + 0.6)); // equal pitch in X and Y
  bx = (canvas.width - BODY_W * pitch) / 2;
  by = (canvas.height - BODY_H * pitch) / 2;
  ox = bx + FRAME * pitch;
  oy = by + (FRAME + STRIP) * pitch;
  buildPanel();
  draw();
}
$('room').addEventListener('click', () => {
  dark = !dark;
  $('room').textContent = dark ? 'Dark room' : 'Room light';
  buildPanel();
  draw();
});
new ResizeObserver(resize).observe(canvas);

// ---- touch ----
// A mouse has no pressure, so the slider stands in for it: moving it while a finger is down is a Slide.
$('press').addEventListener('input', () => {
  $('pv').textContent = Number($('press').value).toFixed(2);
  for (const f of fingers.values()) touch(1, null, f, f);
});
function fingerMessage(action, f, x, y, z) {
  return encodeFinger(st.tag, action, 0, f.id, x, y, z);
}
function local(e) {
  const r = canvas.getBoundingClientRect();
  const d = canvas.width / r.width;
  const px = (e.clientX - r.left) * d;
  const py = (e.clientY - r.top) * d;
  return { x: (px - ox) / pitch, y: H - (py - oy) / pitch };
}
const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
function pressure(e) {
  return e && e.pressure !== 0 && e.pressure !== 0.5 ? e.pressure : Number($('press').value);
}
function touch(action, e, f, p) {
  f.x = p.x;
  f.y = p.y;
  f.z = pressure(e);
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
function releaseAll() {
  for (const id of [...fingers.keys()]) release(id, null);
}
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
  const f = fingers.get(e.pointerId);
  const p = local(e);
  if (f && inside(p)) touch(1, e, f, p);
});
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (e) => release(e.pointerId, e));
}
canvas.addEventListener('lostpointercapture', (e) => release(e.pointerId, null));
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAll();
});
status();