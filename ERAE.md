# Eigendrum on the Erae 2

This branch draws the live drum on the Erae's 42 x 24 LEDs. Nodal lines and colours move as the drum rings. A finger tap on the surface strikes the drum at that spot, and how hard you press sets how loud it is. The sound still comes from the laptop. The Erae is only the picture and the mallet.

## Try it without an Erae

You need Node 20 or newer and Chrome or Opera.

1. In the repo folder, run `node tools/serve.mjs`. It serves on port 8080.
2. Open `http://localhost:8080/tools/erae-sim/sim.html`. This is a fake Erae. Leave the tab open.
3. In a second tab of the same browser, open `http://localhost:8080/?sim` and click "connect erae". Click inside the drum on the simulator tab. The LEDs show the drum and the laptop plays the strike.

## Try it with your Erae 2

1. In Erae Lab, add one API Zone at index 0 that covers the whole surface, and send the layout to the Erae.
2. Plug the Erae in over USB.
3. Run `node tools/serve.mjs` and open `http://localhost:8080/` in Chrome or Opera. Not file://, and not Safari or Firefox, which have no Web MIDI with SysEx.
4. Click "connect erae" and allow the MIDI permission. The Erae should switch to the drum picture.

The line under the button tells you where you are:

- `erae connected, 42 x 24` means it worked.
- `erae not found` means the browser sees no port with "erae" in its name. Check the cable and that the layout was sent.
- `no api zone: add one in erae lab` means the Erae answered, but zone 0 does not exist. Redo step 1.
- `erae did not answer` means the port is there but the Erae is not running the API.
- `midi access was blocked` means the permission was refused. Reset it in the site settings.
- `web midi needs https or localhost` and `web midi not available in this browser` need a different address or browser.
- `erae disconnected` means you clicked again or pulled the cable.

## What is tested

The simulator speaks the same SysEx bytes as the real device, and the drum picture only ever reaches it as those bytes. The byte code is also checked against Embodme's Python reference and against the vendor example in `tools/erae-sim/vendor/`. None of this has run on a real Erae yet.

The colour rule comes from Embodme's API PDF: pixels and rectangles take 0 to 127 per channel, images take 0 to 255. If the picture looks too dark, too bright or the wrong colour, start with the note at the top of `tools/erae-sim/sim.js` and the palette in `src/app/erae/raster.js`.

To run the checks:

- `npm test` for the whole project.
- `node tools/erae-sim/check-codec.mjs` for the byte code.
- `http://localhost:8080/tools/erae-sim/check.html?sim`, then "Run checks", for the simulator. Close other simulator tabs first.

## Where the code is

- `src/app/erae/index.js` is the glue: the connect button, taps to strikes, and sending LED frames 25 times a second.
- `src/app/erae/link.js` talks Web MIDI to the Erae.
- `src/app/erae/codec.js` builds and reads the SysEx messages.
- `src/app/erae/raster.js` turns the drum field into an LED image.
- `tools/erae-sim/` is the simulator and its checks.

If something is off on the real device, first press connect and watch the status line, then open the browser console. A SysEx byte layout that differs from the simulator is the most likely cause, and it lives in `codec.js`.

## Next

Several fingers striking at once, and changing the head's tension by pressing on it. Neither is built.
