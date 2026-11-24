# Eigendrum on the Erae 2

This branch draws the live drum on the Erae's 42 x 24 LEDs. Nodal lines and colours move as the drum rings. A tap strikes the drum at that spot, and how hard you press sets how loud it is. Faders, preset buttons and a tension strip sit on either side. The sound still comes from the laptop.

## The surface

```
 cols 0-8          cols 9-32            cols 33-41
+--------+------------------------+------------+
| P  R  M|                        | F#  (note) |
| i  i  a|                        |            |
| t  n  l|          drum          | [] []   || |
| c  g  l|                        | [] []   || |
| h     e|                        | [] []   || |
|       t|                        | presets  tension
+--------+------------------------+------------+
```

- Pitch, ring-out and mallet faders: touch or slide up and down to set them. The sliders on screen follow, and the other way round.
- Drum: tap to strike. Pressure sets loudness. Several fingers make separate, overlapping strikes.
- Note: the lowest mode's nearest note. The octave is dropped when it does not fit.
- Presets: tap one to switch shape. The bright one is selected. Taps are ignored while a shape is solving.
- Tension: hold it and press harder to bend everything ringing up to 4 semitones. Lift and it eases back. This speeds the sound up rather than solving a new drum, so the ring also gets a little shorter. A press on one spot of the head, like a hand on a frame drum, is not built yet.

## Try it without an Erae

You need Node 20 or newer and Chrome or Opera.

1. Get the code and switch to this branch:

   ```
   git clone https://github.com/BaselAshraf81/eigendrum.git
   cd eigendrum
   git checkout feature/erae-midi
   ```

2. Run `npm run erae`. It starts a local server and opens one tab: Eigendrum, with a small `simulated erae` panel in the bottom-right corner. Leave the terminal open. Press Ctrl+C there to stop.
3. Click "connect erae".
4. In the simulated erae panel, use the mouse in place of your fingers:
   - Tap the drum to strike it.
   - Drag a fader to change pitch, ring-out or the mallet.
   - Tap a preset to switch shape.
   - Hold the tension strip and drag the pressure slider to bend the pitch. A mouse has no pressure, so the slider stands in for it.
5. `hide` folds the panel to its title bar and `open in own window` moves it to its own tab. On a narrow screen it starts folded.

## Try it with your Erae 2

1. In Erae Lab, add one API Zone at index 0 that covers the whole surface, and send the layout to the Erae. Plug the Erae in over USB.
2. Run `npm run erae -- --no-open`. It starts the server without opening any tabs. Then open `http://localhost:8080/` in Chrome or Opera. Not file://, and not Safari or Firefox, which have no Web MIDI with SysEx.
3. Click "connect erae" and allow the MIDI permission.

The line under the button tells you where you are:

- `erae connected, 42 x 24` means it worked.
- `erae not found`: no port with "erae" in its name. Check the cable and that the layout was sent.
- `no api zone: add one in erae lab`: zone 0 does not exist. Redo step 1.
- `erae did not answer`: the port is there but the Erae is not running the API.
- `midi access was blocked`: reset the permission in the site settings.
- `web midi needs https or localhost` and `web midi not available in this browser` need a different address or browser.

A zone narrower than 34 LEDs gets the drum alone, with no controls.

## What is tested

The simulator speaks the same SysEx bytes as the real device, and the picture only reaches it as those bytes. The byte code is checked against Embodme's Python reference and the vendor example in `tools/erae-sim/vendor/`. None of this has run on a real Erae yet.

Pixels and rectangles take 0 to 127 per channel, images 0 to 255 (Embodme's API PDF). If colours look wrong, start with the note at the top of `tools/erae-sim/sim.js` and the palettes in `src/app/erae/raster.js` and `controls.js`.

Checks: `npm test`, `node tools/erae-sim/check-codec.mjs`, and `http://localhost:8080/tools/erae-sim/check.html?sim` then "Run checks" (close any other simulator tab first).

## Where the code is

- `src/app/erae/`: the connect button, finger routing and 25 Hz LED frames (`index.js`), layout and controls (`layout.js`, `controls.js`), Web MIDI and SysEx (`link.js`, `codec.js`), and the drum's LED image (`raster.js`).
- `tools/erae-sim/`: the simulator and its checks. `start.mjs` is the `npm run erae` launcher.
