/* Fake Web MIDI for the Erae 2 simulator. Include as a classic script BEFORE the host
 * page's own scripts. Active only when the page URL has ?sim, so the same page works
 * with a real Erae when ?sim is absent. Bytes sent to the output go to BroadcastChannel
 * 'erae-sim' (to the simulator page); bytes from the simulator arrive as midimessage. */
(function () {
  if (!/[?&]sim(=|&|$)/.test(location.search)) return;
  var NAME = 'Erae 2 MIDI (simulated)';
  var chan = new BroadcastChannel('erae-sim');

  class Port extends EventTarget {
    constructor(type, id) {
      super();
      this.id = id;
      this.name = NAME;
      this.manufacturer = 'Embodme';
      this.version = '';
      this.type = type;
      this.state = 'connected';
      this.connection = 'open';
      this._h = null;
    }
    open() { return Promise.resolve(this); }
    close() { return Promise.resolve(this); }
    get onmidimessage() { return this._h; }
    set onmidimessage(fn) {
      if (this._h) this.removeEventListener('midimessage', this._h);
      this._h = typeof fn === 'function' ? fn : null;
      if (this._h) this.addEventListener('midimessage', this._h);
    }
  }

  var input = new Port('input', 'erae-sim-in');
  var output = new Port('output', 'erae-sim-out');
  output.send = function (data) {
    chan.postMessage({ to: 'device', bytes: Array.from(data) });
  };
  output.clear = function () {};

  chan.onmessage = function (e) {
    if (!e.data || e.data.to !== 'host') return;
    var ev = new Event('midimessage');
    ev.data = new Uint8Array(e.data.bytes);
    input.dispatchEvent(ev);
  };

  var access = new EventTarget();
  access.inputs = new Map([[input.id, input]]);
  access.outputs = new Map([[output.id, output]]);
  access.sysexEnabled = true;
  access.onstatechange = null;

  navigator.requestMIDIAccess = function () { return Promise.resolve(access); };
})();
