# Erae 2 simulator

A browser stand-in for the Embodme Erae 2: a 42 x 24 LED grid with touch X, Y and pressure. It speaks the Erae API SysEx protocol, so host code written for the device runs against it unchanged.

Run `npm run erae`. It starts the server and opens Eigendrum with the simulator docked in the corner, so both stay visible. Browsers pause a hidden tab, so a separate simulator tab would freeze while you look at it.

By hand: `node tools/serve.mjs`, then open `http://localhost:8080/?sim`. The standalone page is `tools/erae-sim/sim.html`, and a second simulator on the same channel answers twice, so use one at a time. `demo.html?sim` is a small host using the vendor example.

Checks: `node tools/erae-sim/check-codec.mjs`, and `check.html?sim` then "Run checks".

See `ERAE.md` in the repo root.
