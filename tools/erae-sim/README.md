# Erae 2 simulator

A browser stand-in for the Embodme Erae 2: a 42x24 LED grid (origin bottom-left) with touch X, Y and pressure. It speaks the Erae API SysEx protocol (Embodme's Python reference byte layouts), so host code written for the real device runs against it unchanged.

Run:
1. `node tools/serve.mjs`, then open `http://localhost:8080/tools/erae-sim/sim.html`.
2. In your host page, include `tools/erae-sim/midi-shim.js` as a classic script before your own scripts.
3. Open the host page with `?sim` (without it the shim is inactive and a real Erae is used).
4. `demo.html?sim` is a working example using Henry's unmodified `vendor/erae-api.js`.

Transport is a fake `navigator.requestMIDIAccess` plus BroadcastChannel `erae-sim`, so both tabs must be on the same origin.

Colour rule (Erae API V2 Rev 004 PDF, Python reference, Henry's JS): SetPixel and DrawRectangle carry 7-bit channels (0-127, shifted up by 1 bit); DrawImage is bitized and carries full 8-bit RGB (the PDF example sends 0xFF). No auto-detect. Unverified on hardware: this rule, reply tag placement, and how real pressure feels.
The LED picture is written only by decoded SysEx (header, 7-bit unbitize, XOR checksum, size checks); touches leave only as encoded Finger Stream SysEx. Both are in the hex log.

Checks: run `node tools/erae-sim/check-codec.mjs` (codec vs Henry's JS and Embodme's Python, no server needed).
Then serve with `node tools/serve.mjs`, open `http://localhost:8080/tools/erae-sim/check.html?sim` and press Run checks (it hosts the simulator in a frame, so close other sim.html tabs first).

Using it with a real Erae 2:
1. In Erae Lab, place one API Zone at index 0 in a layout and send it to the Erae.
2. Connect the Erae over USB.
3. Open eigendrum in Chrome or Opera over https or localhost (Web MIDI with SysEx needs a secure context).
4. Press 'connect erae' and allow MIDI access. Touches in the zone strike the drum; pressure sets loudness.
