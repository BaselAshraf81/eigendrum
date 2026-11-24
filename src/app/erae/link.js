/**
 * Web MIDI link to an Embodme Erae 2 running an API Zone. connect() must be
 * called from a click: it is the only place requestMIDIAccess is asked for.
 */
import { apiDisable, apiEnable, decodeReply, drawImage, zoneBoundaryRequest } from './codec.js';

const TAG = [0x45, 0x44, 0x52, 0x4d]; // "EDRM", echoed back at the start of every reply
// The one API Zone we draw into and listen to. Erae Lab numbers zones from 0.
export const ZONE = 0;
// A plugged-in Erae answers in a few milliseconds, so a second of silence means
// it is not running the API.
const REPLY_TIMEOUT_MS = 1000;
// The device answers a zone boundary request for a zone that is not in the layout with 0x7F.
const NO_ZONE = 0x7f;

/** Why Web MIDI cannot work here, or null if it might. */
export function unavailableReason() {
  if (!window.isSecureContext) return 'web midi needs https or localhost';
  if (!navigator.requestMIDIAccess) return 'web midi not available in this browser';
  return null;
}

// The main "Erae 2 MIDI" port carries the API; the MPE port does not.
function pick(ports) {
  const eraes = [...ports.values()].filter((p) => /erae/i.test(p.name || ''));
  return eraes.find((p) => !/mpe/i.test(p.name)) ?? eraes[0];
}

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
    let timer;
    const answer = new Promise((resolve) => {
      this.gotZone = resolve;
      timer = setTimeout(resolve, REPLY_TIMEOUT_MS, null);
    });
    input.onmidimessage = (e) => {
      const m = decodeReply(e.data, TAG);
      if (!m) return;
      if (m.kind === 'zone' && m.zone === ZONE) this.gotZone(m);
      else if (m.kind === 'finger' && m.checksumOk && this.zone) this.onFinger(m);
    };
    this.onState = (e) => {
      if (e.port && (e.port === this.input || e.port === this.output) && e.port.state === 'disconnected') {
        this.teardown();
        this.onStatus('erae disconnected');
      }
    };
    access.addEventListener('statechange', this.onState);
    try {
      output.send(apiEnable(TAG));
      output.send(zoneBoundaryRequest(ZONE));
    } catch {
      clearTimeout(timer);
      this.teardown();
      this.onStatus('could not talk to erae');
      return false;
    }
    const m = await answer;
    clearTimeout(timer);
    if (!this.output) return false; // unplugged while waiting; statechange has said so
    if (!m) {
      this.release();
      this.onStatus('erae did not answer');
      return false;
    }
    if (m.width === NO_ZONE) {
      this.release();
      this.onStatus('no api zone: add one in erae lab');
      return false;
    }
    this.zone = { width: m.width, height: m.height };
    this.onStatus(`erae connected, ${m.width} x ${m.height}`);
    return true;
  }
  send(rgb) {
    if (!this.zone) return;
    this.output.send(drawImage(ZONE, 0, 0, this.zone.width, this.zone.height, rgb));
  }
  disconnect() {
    this.release();
    this.onStatus('erae disconnected');
  }
  /** Leaves API mode so the Erae goes back to its own layout, then lets go of the ports. */
  release() {
    const { output } = this;
    this.teardown();
    output?.send(apiDisable());
  }
  teardown() {
    if (this.input) this.input.onmidimessage = null;
    this.access?.removeEventListener('statechange', this.onState);
    this.input = this.output = this.zone = this.access = null;
  }
}
