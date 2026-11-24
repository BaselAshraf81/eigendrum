/**
 * Web MIDI link to an Embodme Erae 2 running an API Zone. connect() must be
 * called from a click: it is the only place requestMIDIAccess is asked for.
 */
import { apiDisable, apiEnable, decodeReply, drawImage, zoneBoundaryRequest } from './codec.js';

const TAG = [0x45, 0x44, 0x52, 0x4d]; // "EDRM", echoed back at the start of every reply
const FALLBACK = { width: 42, height: 24 };

/** Why Web MIDI cannot work here, or null if it might. */
export function unavailableReason() {
  if (!window.isSecureContext) return 'web midi needs https or localhost';
  if (!navigator.requestMIDIAccess) return 'web midi not available in this browser';
  return null;
}

const isErae = (p) => /erae/i.test(p.name || '');
// The main "Erae 2 MIDI" port carries the API; an MPE port does not.
const pick = (ports) => [...ports.values()].filter(isErae).sort((a, b) => /mpe/i.test(a.name) - /mpe/i.test(b.name))[0];

export class EraeLink {
  constructor({ onFinger, onStatus }) {
    this.onFinger = onFinger;
    this.onStatus = onStatus;
    this.input = null;
    this.output = null;
    this.zone = null; // { width, height } once connected
  }

  get connected() {
    return !!this.zone;
  }

  async connect() {
    this.onStatus('looking for erae');
    let access;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      this.onStatus('midi access was blocked');
      return false;
    }
    const input = pick(access.inputs);
    const output = pick(access.outputs);
    if (!input || !output) {
      this.onStatus('erae not found');
      return false;
    }
    this.access = access;
    this.input = input;
    this.output = output;
    let gotZone;
    const zoneReply = new Promise((resolve) => (gotZone = resolve));
    input.onmidimessage = (e) => {
      const m = decodeReply(e.data, TAG);
      if (!m) return;
      if (m.kind === 'zone' && m.zone === 0) gotZone(m);
      else if (m.kind === 'finger' && m.checksumOk && this.zone) this.onFinger(m);
    };
    this.onState = (e) => {
      if (e.port && (e.port === this.input || e.port === this.output) && e.port.state === 'disconnected') {
        this.teardown();
        this.onStatus('erae disconnected');
      }
    };
    access.addEventListener('statechange', this.onState);
    output.send(apiEnable(TAG));
    output.send(zoneBoundaryRequest(0));
    const m = await Promise.race([zoneReply, new Promise((r) => setTimeout(() => r(null), 1000))]);
    // 0x7F means the zone does not exist; a real zone is at most 42 x 24.
    const ok = m && m.width > 0 && m.width < 0x7f && m.height > 0 && m.height < 0x7f;
    if (!this.output) return false; // unplugged while waiting
    this.zone = ok ? { width: m.width, height: m.height } : { ...FALLBACK };
    this.onStatus(`erae connected, ${this.zone.width} x ${this.zone.height}`);
    return true;
  }

  send(rgb) {
    if (!this.zone) return;
    try {
      this.output.send(drawImage(0, 0, 0, this.zone.width, this.zone.height, rgb));
    } catch {
      /* port went away; statechange reports it */
    }
  }

  disconnect() {
    try {
      this.output?.send(apiDisable());
    } catch {
      /* already gone */
    }
    this.teardown();
    this.onStatus('erae disconnected');
  }

  teardown() {
    if (this.input) this.input.onmidimessage = null;
    this.access?.removeEventListener('statechange', this.onState);
    this.input = this.output = this.zone = this.access = null;
  }
}
