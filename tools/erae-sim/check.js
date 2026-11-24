// Checks for the Erae 2 simulator. Classic script. Outgoing bytes are built here byte by byte from the spec
// and replies are decoded here, following Python receive_midi_message. It does not import the simulator's codec.
(function () {
  const W = 42, H = 24;
  const PREFIX = [0x00, 0x21, 0x50, 0x00, 0x01, 0x00, 0x02]; // Embodme id, Erae family, Erae 2 member
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const frame = $('sim');

  // ---- independent byte building (7-bit packing: group of 7 bytes -> 1 MSB byte + 7 low bytes) ----
  function pack7(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i += 7) {
      const n = Math.min(7, bytes.length - i);
      let msb = 0;
      for (let j = 0; j < n; j++) if (bytes[i + j] & 0x80) msb |= 1 << (6 - j);
      out.push(msb);
      for (let j = 0; j < n; j++) out.push(bytes[i + j] & 0x7f);
    }
    return out;
  }
  const sum = (a) => { let c = 0; for (const b of a) c ^= b; return c; };
  // F0 | 00 21 50 | 00 01 | 00 02 | device | network 01 | service 01 | api 04 | command | payload | F7. Device 01, or 7F for AllCall.
  function cmd(code, payload, o) {
    o = o || {};
    return [0xf0, ...(o.member || PREFIX), o.dev === undefined ? 0x01 : o.dev, o.service === undefined ? 0x01 : o.service, 0x04, code, ...payload, 0xf7];
  }
  const enable = (tag) => cmd(0x01, tag);
  const disable = () => cmd(0x02, []);
  const zoneReq = (z) => cmd(0x10, [z]);
  const versionReq = (tag) => cmd(0x7f, tag);
  const clearZone = (z) => cmd(0x20, [z]);
  const setPixel = (z, x, y, r, g, b, o) => cmd(0x21, [z, x, y, r, g, b], o);
  const rect = (z, x, y, w, h, r, g, b) => cmd(0x22, [z, x, y, w, h, r, g, b]);
  function image(z, x, y, w, h, rgb, o) { // rgb = flat 8-bit bytes, w*h*3 of them
    o = o || {};
    let wire = pack7(rgb);
    let ck = sum(wire);
    if (o.cut) { wire = wire.slice(0, -1); ck = sum(wire); }
    if (o.badByte) { wire[3] |= 0x80; ck = sum(wire); }
    if (o.badSum) ck ^= 0x01;
    return cmd(0x23, [z, x, y, w, h, ...wire, ck], o);
  }

  // ---- decoder, same steps as the Python reference ----
  const bitized7size = (n) => Math.floor(n / 7) * 8 + (n % 7 > 0 ? 1 + (n % 7) : 0);
  function unpack7(w) {
    const out = [];
    for (let i = 0; i < w.length; i += 8) for (let j = 0; j < 7; j++) if (j + 1 + i < w.length) out.push(((w[i] << (j + 1)) & 0x80) | w[i + j + 1]);
    return out;
  }
  function decode(msg, prefix) {
    msg = Array.from(msg);
    if (msg[0] !== 0xf0 || msg[msg.length - 1] !== 0xf7) return null;
    const s = msg.slice(1, -1);
    if (!(s.length > prefix.length && prefix.every((v, i) => s[i] === v))) return null;
    let o = prefix.length;
    if (s[o] === 0x7f) {
      o++;
      const r = {};
      if (s[o] === 0x01) { o++; r.kind = 'zone'; r.zone = s[o]; o++; r.width = s[o]; o++; r.height = s[o]; }
      if (s[o] === 0x02) { o++; r.kind = 'version'; r.version = s[o]; }
      return r;
    }
    const action = s[o] & 0x07; o++;
    const zone = s[o]; o++;
    const idw = s.slice(o, o + bitized7size(8)); o += bitized7size(8);
    const xyz = s.slice(o, o + bitized7size(12)); o += bitized7size(12);
    const ck = s[o];
    const idb = unpack7(idw), v = new DataView(new Uint8Array(unpack7(xyz)).buffer);
    return { kind: 'finger', action, zone, id: new DataView(new Uint8Array(idb).buffer).getBigUint64(0, true).toString(),
      x: v.getFloat32(0, true), y: v.getFloat32(4, true), z: v.getFloat32(8, true), ckOk: ck === sum(xyz) };
  }

  // ---- transport: shim for host messages, own channel for the dev peek ----
  const raw = new BroadcastChannel('erae-sim');
  const inbox = [], peeks = [];
  let out = null;
  raw.onmessage = (e) => { if (e.data && e.data.peekReply) peeks.push(e.data.peekReply); };
  async function connect() {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    out = [...access.outputs.values()][0];
    [...access.inputs.values()][0].addEventListener('midimessage', (e) => { if (e.data.length) inbox.push(Array.from(e.data)); });
  }
  const send = (b) => out.send(b);
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  async function waitFor(fn, ms) {
    const t = performance.now();
    for (;;) {
      const r = fn();
      if (r) return r;
      if (performance.now() - t > (ms || 1500)) return null;
      await sleep(5);
    }
  }
  let bar = 0;
  async function barrier() { // a version reply with a unique tag proves every earlier message was handled
    const tag = [0x55, ++bar & 0x7f, (bar >> 7) & 0x7f];
    send(versionReq(tag));
    const want = [0xf0, ...tag, 0x7f, 0x02, 0x02, 0xf7];
    if (!(await waitFor(() => inbox.some((m) => eq(m, want)), 4000))) throw new Error('barrier reply missing');
  }
  async function peek(reset) {
    await barrier();
    const n = peeks.length;
    raw.postMessage({ to: 'device', peek: true, resetPerf: !!reset });
    if (!(await waitFor(() => peeks.length > n, 2000))) throw new Error('peek reply missing');
    return peeks[peeks.length - 1];
  }

  // ---- expected framebuffer model (colour rule: 7-bit commands shift up one bit, DrawImage is raw 8-bit) ----
  let model = new Uint8Array(W * H * 3);
  const mput = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) model.set(c, (y * W + x) * 3); };
  const x2 = (r, g, b) => [r * 2, g * 2, b * 2];
  const diff = (px) => {
    const bad = [];
    for (let i = 0; i < model.length; i++) if (px[i] !== model[i]) { bad.push(i); if (bad.length > 3) break; }
    return bad.map((i) => `(${(i / 3 | 0) % W},${(i / 3 / W) | 0})ch${i % 3} got ${px[i]} want ${model[i]}`).join('; ');
  };
  const same = (px) => !diff(px);
  async function resetDevice() {
    send(clearZone(0)); model.fill(0);
    await barrier();
  }

  // ---- layout of the simulator canvas (from sim.js constants) so touches land on known LEDs ----
  const win = () => frame.contentWindow;
  const canvas = () => win().document.getElementById('led');
  function geom() { // canvas pixel maths as in sim.js resize(): equal LED pitch, body is 44 x 29.4 pitches
    const r = canvas().getBoundingClientRect(), cw = Math.round(r.width * (win().devicePixelRatio || 1)), ch = Math.round(r.height * (win().devicePixelRatio || 1));
    const P = Math.min(cw / 44.6, ch / 30.0), d = cw / r.width;
    return { r, d, P, ox: (cw - 44 * P) / 2 + P, oy: (ch - 29.4 * P) / 2 + 4.4 * P };
  }
  const at = (g, px, py) => [g.r.left + px / g.d, g.r.top + py / g.d]; // canvas pixels to client coordinates
  const ledPoint = (x, y) => { const g = geom(); return at(g, g.ox + (x + 0.5) * g.P, g.oy + (H - (y + 0.5)) * g.P); };
  function ptr(type, id, [cx, cy]) {
    canvas().dispatchEvent(new (win().PointerEvent)(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, clientX: cx, clientY: cy }));
  }
  function setPressure(v) {
    const el = win().document.getElementById('press');
    el.value = String(v);
    el.dispatchEvent(new (win().Event)('input', { bubbles: true }));
  }
  const fingersSince = (n) => inbox.slice(n).map((m) => decode(m, TAG)).filter((d) => d && d.kind === 'finger');

  let TAG = [0x40, 0x41, 0x42, 0x43];
  const rows = [];
  const touchLog = []; // finger messages and their decodes, for check 21
  const checks = [];
  const add = (id, name, fn) => checks.push({ id, name, fn });

  const gradient = () => {
    const a = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a.push(x * 6, y * 10, 255 - x * 6);
    return a;
  };

  // ---- command checks ----
  add(2, 'VersionRequest before enable uses its own tag', async () => {
    send(disable()); await barrier();
    const tag = [0x10, 0x11, 0x12, 0x13, 0x14];
    send(versionReq(tag));
    const want = [0xf0, ...tag, 0x7f, 0x02, 0x02, 0xf7];
    const ok = await waitFor(() => inbox.find((m) => eq(m, want)));
    return [!!ok, ok ? 'reply ' + ok.map((b) => b.toString(16)).join(' ') : 'no reply with that tag'];
  });
  add(1, 'API enable with tag, then VersionRequest', async () => {
    TAG = [64, 65, 66, 67];
    send(enable(TAG)); await barrier();
    const n = inbox.length;
    send(versionReq(TAG));
    const want = [0xf0, ...TAG, 0x7f, 0x02, 0x02, 0xf7];
    const ok = await waitFor(() => inbox.slice(n).find((m) => eq(m, want)));
    const p = await peek();
    const d = ok && decode(ok, TAG);
    return [!!ok && p.streaming && eq(p.tag, TAG) && d.version === 2, `streaming ${p.streaming} tag ${p.tag} version ${d && d.version}`];
  });
  add(3, 'ZoneBoundaryRequest zone 0 is 42 x 24, zone 5 is 7F 7F', async () => {
    let n = inbox.length;
    send(zoneReq(0));
    const a = await waitFor(() => inbox.slice(n).find((m) => decode(m, TAG) && decode(m, TAG).kind === 'zone'));
    n = inbox.length;
    send(zoneReq(5));
    const b = await waitFor(() => inbox.slice(n).find((m) => decode(m, TAG) && decode(m, TAG).kind === 'zone'));
    const okA = a && eq(a, [0xf0, ...TAG, 0x7f, 0x01, 0x00, 0x2a, 0x18, 0xf7]);
    const okB = b && eq(b, [0xf0, ...TAG, 0x7f, 0x01, 0x05, 0x7f, 0x7f, 0xf7]);
    return [!!okA && !!okB, `zone0 ${a} zone5 ${b}`];
  });
  add(4, 'Clear zone 0 sets every pixel to 0', async () => {
    send(rect(0, 0, 0, 42, 24, 100, 100, 100)); await barrier();
    send(clearZone(0)); model.fill(0);
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(5, 'SetPixel at the four corners, origin bottom-left, 7-bit colour doubled', async () => {
    await resetDevice();
    const pts = [[0, 0, 10, 20, 30], [41, 0, 40, 50, 60], [0, 23, 70, 80, 90], [41, 23, 100, 110, 127]];
    for (const [x, y, r, g, b] of pts) { send(setPixel(0, x, y, r, g, b)); mput(x, y, x2(r, g, b)); }
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(6, 'SetPixel out of range changes nothing', async () => {
    await resetDevice();
    send(setPixel(0, 3, 3, 9, 9, 9)); mput(3, 3, x2(9, 9, 9));
    send(setPixel(0, 42, 0, 127, 0, 0)); send(setPixel(0, 0, 24, 0, 127, 0)); send(setPixel(0, 127, 127, 0, 0, 127));
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(7, 'DrawRectangle partly off the edge is clipped', async () => {
    await resetDevice();
    send(rect(0, 38, 20, 8, 8, 5, 100, 60));
    for (let y = 20; y < 28; y++) for (let x = 38; x < 46; x++) mput(x, y, x2(5, 100, 60));
    send(rect(0, 0, 0, 3, 2, 127, 0, 1));
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) mput(x, y, x2(127, 0, 1));
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(8, 'DrawImage 42x24 gradient, row 0 at y0, rows upward, raw 8-bit', async () => {
    await resetDevice();
    const g = gradient();
    send(image(0, 0, 0, 42, 24, g));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mput(x, y, [x * 6, y * 10, 255 - x * 6]);
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(9, 'DrawImage 5x3 at (10,7) changes only that area', async () => {
    await resetDevice();
    send(rect(0, 0, 0, 42, 24, 20, 20, 20)); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mput(x, y, x2(20, 20, 20));
    const rgb = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { rgb.push(200 + c, 100 + r * 20, 3 + c * 50); mput(10 + c, 7 + r, [200 + c, 100 + r * 20, 3 + c * 50]); }
    send(image(0, 10, 7, 5, 3, rgb));
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(10, 'DrawImage of 1008 pixels accepted, 1010 dropped (1009 is prime, no w x h <= 127 fits)', async () => {
    await resetDevice();
    const g = gradient();
    send(image(0, 0, 0, 42, 24, g));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mput(x, y, [x * 6, y * 10, 255 - x * 6]);
    let p = await peek();
    const ok1 = same(p.pixels), d0 = p.dropped, detail1 = diff(p.pixels);
    const big = new Array(101 * 10 * 3).fill(0x7f);
    send(image(0, 0, 0, 101, 10, big));
    p = await peek();
    return [ok1 && p.dropped === d0 + 1 && same(p.pixels), `1008: ${detail1 || 'ok'}; dropped ${d0} -> ${p.dropped}; ${diff(p.pixels) || 'fb unchanged'}`];
  });
  add(11, 'Bad DrawImage variants are dropped without touching pixels', async () => {
    await resetDevice();
    const rgb = Array.from({ length: 45 }, (_, i) => 100 + i);
    const variants = [
      ['wrong checksum', image(0, 0, 0, 5, 3, rgb, { badSum: 1 })],
      ['wrong length', image(0, 0, 0, 5, 3, rgb, { cut: 1 })],
      ['data byte above 7F', image(0, 0, 0, 5, 3, rgb, { badByte: 1 })],
      ['wrong member byte', image(0, 0, 0, 5, 3, rgb, { member: [0x00, 0x21, 0x50, 0x00, 0x01, 0x00, 0x01] })],
      ['wrong service byte', image(0, 0, 0, 5, 3, rgb, { service: 0x02 })],
    ];
    let d = (await peek()).dropped, ok = true, detail = [];
    for (const [name, msg] of variants) {
      send(msg);
      const p = await peek();
      const good = p.dropped === d + 1 && same(p.pixels);
      if (!good) { ok = false; detail.push(`${name}: dropped ${d}->${p.dropped} ${diff(p.pixels)}`); }
      d = p.dropped;
    }
    return [ok, detail.join(' | ') || 'all five dropped'];
  });
  add(12, 'Device id 7F (AllCall) is accepted like 01', async () => {
    await resetDevice();
    send(setPixel(0, 1, 1, 10, 20, 30, { dev: 0x7f })); mput(1, 1, x2(10, 20, 30));
    send(setPixel(0, 2, 1, 11, 21, 31, { dev: 0x01 })); mput(2, 1, x2(11, 21, 31));
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });
  add(13, 'Commands to zone 3 change no pixels', async () => {
    await resetDevice();
    send(rect(0, 0, 0, 4, 4, 30, 30, 30)); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) mput(x, y, x2(30, 30, 30));
    send(setPixel(3, 10, 10, 50, 50, 50)); send(rect(3, 0, 0, 42, 24, 60, 60, 60)); send(clearZone(3));
    send(image(3, 0, 0, 2, 2, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    const p = await peek();
    return [same(p.pixels), diff(p.pixels)];
  });

  // ---- touch checks ----
  add(15, 'Click, move, release: actions 0,1,2, same id, position and pressure decode', async () => {
    send(enable(TAG)); await barrier(); await resetDevice();
    setPressure(0.62);
    const n = inbox.length;
    ptr('pointerdown', 1, ledPoint(5, 7)); ptr('pointermove', 1, ledPoint(20, 12)); ptr('pointerup', 1, ledPoint(20, 12));
    await barrier();
    const f = fingersSince(n);
    touchLog.push(...inbox.slice(n).filter((m) => decode(m, TAG) && decode(m, TAG).kind === 'finger').map((m) => ({ m, d: decode(m, TAG) })));
    if (f.length !== 3) return [false, `got ${f.length} finger messages`];
    const want = [[0, 5.5, 7.5], [1, 20.5, 12.5], [2, 20.5, 12.5]];
    const bad = f.map((d, i) => [d.action === want[i][0] && Math.abs(d.x - want[i][1]) < 0.01 && Math.abs(d.y - want[i][2]) < 0.01 && d.z === Math.fround(0.62) && d.ckOk && d.id === f[0].id && d.zone === 0, d])
      .filter(([ok]) => !ok).map(([, d]) => `action ${d.action} x ${d.x} y ${d.y} z ${d.z} id ${d.id}`);
    return [!bad.length, bad.join(' | ') || `x ${f[0].x.toFixed(3)} y ${f[0].y.toFixed(3)} z ${f[0].z}`];
  });
  add(16, 'Pressure slider 0, 0.37, 1.0 decodes as z', async () => {
    const res = [];
    for (const v of [0, 0.37, 1.0]) {
      setPressure(v);
      const n = inbox.length;
      ptr('pointerdown', 1, ledPoint(8, 8)); ptr('pointerup', 1, ledPoint(8, 8));
      await barrier();
      const f = fingersSince(n);
      touchLog.push(...inbox.slice(n).filter((m) => decode(m, TAG) && decode(m, TAG).kind === 'finger').map((m) => ({ m, d: decode(m, TAG) })));
      res.push([f.length === 2 && f.every((d) => d.z === Math.fround(v)), `slider ${v}: z ${f.map((d) => d.z)}`]);
    }
    return [res.every((r) => r[0]), res.map((r) => r[1]).join('; ')];
  });
  add(17, 'Two pointers at once: two ids, both released, 0 fingers after', async () => {
    setPressure(0.5);
    const n = inbox.length;
    ptr('pointerdown', 1, ledPoint(3, 3)); ptr('pointerdown', 2, ledPoint(30, 15));
    const mid = await peek();
    ptr('pointerup', 1, ledPoint(3, 3)); ptr('pointerup', 2, ledPoint(30, 15));
    const p = await peek();
    const f = fingersSince(n);
    touchLog.push(...inbox.slice(n).filter((m) => decode(m, TAG) && decode(m, TAG).kind === 'finger').map((m) => ({ m, d: decode(m, TAG) })));
    const downs = f.filter((d) => d.action === 0), ups = f.filter((d) => d.action === 2);
    const ok = downs.length === 2 && downs[0].id !== downs[1].id && ups.length === 2 && ups.every((u) => downs.some((d) => d.id === u.id)) && mid.fingers === 2 && p.fingers === 0;
    return [ok, `down ${downs.length} up ${ups.length} fingers mid ${mid.fingers} end ${p.fingers}`];
  });
  add(18, 'Second pointerdown on the same pointerId releases the first finger', async () => {
    const n = inbox.length;
    ptr('pointerdown', 1, ledPoint(4, 4)); ptr('pointerdown', 1, ledPoint(9, 9));
    const mid = await peek();
    ptr('pointerup', 1, ledPoint(9, 9));
    const p = await peek();
    const f = fingersSince(n).map((d) => `${d.action}:${d.id}`);
    const a = fingersSince(n);
    const ok = a.length === 4 && a[0].action === 0 && a[1].action === 2 && a[1].id === a[0].id && a[2].action === 0 && a[2].id !== a[0].id && mid.fingers === 1 && p.fingers === 0;
    return [ok, `sequence ${f.map((s) => s.split(':')[0]).join(',')} fingers mid ${mid.fingers} end ${p.fingers}`];
  });
  add(19, 'Window blur and pointercancel send a Release and leave 0 fingers', async () => {
    let n = inbox.length;
    ptr('pointerdown', 1, ledPoint(6, 6));
    win().dispatchEvent(new (win().Event)('blur'));
    let p = await peek(); let a = fingersSince(n);
    const okBlur = a.length === 2 && a[1].action === 2 && p.fingers === 0;
    n = inbox.length;
    ptr('pointerdown', 1, ledPoint(6, 6)); ptr('pointercancel', 1, ledPoint(6, 6));
    p = await peek(); a = fingersSince(n);
    const okCancel = a.length === 2 && a[1].action === 2 && p.fingers === 0;
    return [okBlur && okCancel, `blur ok ${okBlur}, cancel ok ${okCancel}`];
  });
  add(20, 'Pointer outside the zone sends no finger message', async () => {
    const g = geom(), n = inbox.length;
    const pts = [at(g, g.ox + 20 * g.P, g.oy - 1.5 * g.P), at(g, g.ox - 0.5 * g.P, g.oy + 10 * g.P), at(g, g.ox + 20 * g.P, g.oy + 24.5 * g.P)];
    for (const pt of pts) { ptr('pointerdown', 1, pt); ptr('pointerup', 1, pt); }
    const p = await peek();
    return [fingersSince(n).length === 0 && p.fingers === 0, `finger messages ${fingersSince(n).length}`];
  });
  add(14, 'EndFingerDataStreaming turns streaming off, touches are no longer sent', async () => {
    send(disable());
    const p = await peek();
    const n = inbox.length;
    ptr('pointerdown', 1, ledPoint(5, 5)); ptr('pointerup', 1, ledPoint(5, 5));
    const p2 = await peek();
    send(enable(TAG)); await barrier();
    return [!p.streaming && fingersSince(n).length === 0 && p2.fingers === 0, `streaming ${p.streaming}, finger messages ${fingersSince(n).length}`];
  });
  add(21, "Henry's fingerstream() parses the same action, x, y, z and a stable id per touch", async () => {
    if (typeof fingerstream !== 'function' || !touchLog.length) return [false, 'no parser or no messages'];
    const bad = [], idsByTouch = [];
    let cur = [];
    for (const { m, d } of touchLog) {
      const t = new ETouch();
      const ok = fingerstream(Uint8Array.from(m), TAG, t);
      if (!ok) { bad.push('parser rejected a message'); continue; }
      if (t.action !== d.action || t.zone !== d.zone || Math.abs(t.x - d.x) > 1e-6 || Math.abs(t.y - d.y) > 1e-6 || Math.abs(t.z - d.z) > 1e-6) bad.push(`action ${t.action}/${d.action} x ${t.x}/${d.x} y ${t.y}/${d.y} z ${t.z}/${d.z}`);
      cur.push([d.id, String(t.finger_id), d.action]);
    }
    // group by our decoded id: his id must be constant inside a group and differ between groups
    const map = new Map();
    for (const [id, his] of cur) { if (!map.has(id)) map.set(id, new Set()); map.get(id).add(his); }
    for (const [id, set] of map) if (set.size !== 1) bad.push(`id ${id} maps to ${set.size} values`);
    const all = [...map.values()].map((s) => [...s][0]);
    if (new Set(all).size !== all.length) bad.push('two touches share his id');
    return [!bad.length, bad.slice(0, 3).join(' | ') || `${touchLog.length} messages, ${map.size} touches`];
  });

  // ---- throughput ----
  add(22, '300 full frames flat out, then 30 per second for 5 s', async () => {
    await resetDevice();
    const frameBytes = (i) => { const a = []; for (let k = 0; k < W * H; k++) a.push((i * 7 + k) & 0xff, (i + k * 3) & 0xff, (k * 5) & 0xff); return a; };
    const start = await peek(true);
    const msgs = [];
    for (let i = 0; i < 450; i++) msgs.push(image(0, 0, 0, 42, 24, frameBytes(i)));
    for (let i = 0; i < 300; i++) send(msgs[i]);
    await barrier();
    const mid = await peek();
    const t0 = performance.now();
    for (let i = 0; i < 150; i++) {
      send(msgs[300 + i]);
      await sleep(Math.max(0, t0 + (i + 1) * (1000 / 30) - performance.now()));
    }
    const secs = (performance.now() - t0) / 1000;
    await sleep(100);
    const last = frameBytes(449);
    for (let i = 0; i < W * H; i++) mput(i % W, (i / W) | 0, [last[i * 3], last[i * 3 + 1], last[i * 3 + 2]]);
    const end = await peek();
    const frames = end.rx - start.rx - 3; // minus barrier messages and the clear
    const avg = end.perf.handleMs / end.perf.frames;
    const render = end.perf.renderMax;
    const ok = end.dropped === start.dropped && mid.dropped === start.dropped && frames === 450 && same(end.pixels);
    return [ok && avg < 16, `frames decoded ${frames}/450 in ${secs.toFixed(1)} s paced, dropped ${end.dropped - start.dropped}, final frame ${same(end.pixels) ? 'exact' : diff(end.pixels)}; avg handle ${avg.toFixed(2)} ms/message, worst render ${render ? render.toFixed(1) + ' ms' : 'n/a (no rAF)'}${render >= 16 ? ' OVER 16 ms' : ''}`];
  });

  async function run() {
    const body = document.querySelector('#table tbody'), log = $('log');
    body.innerHTML = ''; log.textContent = ''; $('state').textContent = 'running';
    $('run').disabled = true;
    try {
      if (!out) await connect();
      await waitFor(() => frame.contentWindow && frame.contentWindow.document.getElementById('led') && geomReady(), 5000);
      await sleep(300);
    } catch (e) { log.textContent += 'setup failed: ' + e + '\n'; }
    rows.length = 0; touchLog.length = 0;
    for (const c of checks) {
      let ok = false, detail = '';
      try { [ok, detail] = await c.fn(); } catch (e) { detail = 'threw ' + (e && e.message || e); }
      rows.push({ id: c.id, name: c.name, ok, detail });
      if (!ok) log.textContent += `#${c.id} ${c.name}\n  ${detail}\n`;
    }
    rows.sort((a, b) => a.id - b.id);
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const [t, cls] of [[r.id], [r.name], [r.ok ? 'PASS' : 'FAIL', r.ok ? 'PASS' : 'FAIL'], [r.detail]]) {
        const td = document.createElement('td'); td.textContent = t; if (cls) td.className = cls; tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    window.checkResults = rows;
    $('state').textContent = `done: ${rows.filter((r) => r.ok).length}/${rows.length} passed`;
    $('run').disabled = false;
  }
  function geomReady() { try { return canvas().getBoundingClientRect().width > 100; } catch (e) { return false; } }
  $('run').addEventListener('click', run);
})();
