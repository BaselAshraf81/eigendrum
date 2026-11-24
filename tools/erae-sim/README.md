# Erae 2 simulator

A browser stand-in for the Embodme Erae 2: a 42x24 LED grid (origin bottom-left) with touch X, Y and pressure. It speaks the Erae API SysEx protocol (Embodme's Python reference byte layouts), so host code written for the real device runs against it unchanged.

Run:
1. `node tools/serve.mjs`, then open `http://localhost:8080/tools/erae-sim/sim.html`.
2. In your host page, include `tools/erae-sim/midi-shim.js` as a classic script before your own scripts.
3. Open the host page with `?sim` (without it the shim is inactive and a real Erae is used).
4. `demo.html?sim` is a working example using Henry's unmodified `vendor/erae-api.js`.

Transport is a fake `navigator.requestMIDIAccess` plus BroadcastChannel `erae-sim`, so both tabs must be on the same origin.

Unverified (no hardware checked): colour scaling (7-bit scaled up by 2, anything above 0x7F taken as 8-bit), reply header placement (tag right after F0, as the Python reference), and how real pressure feels (slider here, or pen/force-touch pressure).
