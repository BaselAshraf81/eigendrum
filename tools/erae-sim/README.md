# Erae 2 simulator

A browser stand-in for the Embodme Erae 2: a 42 x 24 LED grid with touch X, Y and pressure. It speaks the Erae API SysEx protocol, so host code written for the device runs against it unchanged.

Run `npm run erae` to start the server and open the simulator and Eigendrum together. To open the simulator by hand, start the server with `node tools/serve.mjs` and open `http://localhost:8080/tools/erae-sim/sim.html`. A host page opened with `?sim` talks to it through `midi-shim.js` (a fake `navigator.requestMIDIAccess` over a BroadcastChannel, so both tabs share an origin). `demo.html?sim` is a small host using the vendor example in `vendor/`.

Checks:

- `node tools/erae-sim/check-codec.mjs` compares the byte code with the vendor example and, if found, Embodme's Python.
- `http://localhost:8080/tools/erae-sim/check.html?sim`, then "Run checks".

See `ERAE.md` in the repo root for the full steps.
