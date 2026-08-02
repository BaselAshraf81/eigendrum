# engine/ is generated. Do not edit anything in here.

Byte-identical copies of the verified solver, vendored from the repo root by
`npm run poki:sync`. `npm test` runs `npm run poki:check`, which fails if any
file here has drifted from its source.

To change engine behaviour, edit the original under `src/` at the repo root,
where the accuracy tests can see it, then re-run the sync. Editing a file here
would produce a solver that no test covers, and every accuracy claim the game
makes would silently stop being true.

| vendored | source |
| --- | --- |
| `poki-ready-copy/engine/math/linalg.js` | `src/math/linalg.js` |
| `poki-ready-copy/engine/math/sparse.js` | `src/math/sparse.js` |
| `poki-ready-copy/engine/math/banded.js` | `src/math/banded.js` |
| `poki-ready-copy/engine/math/eigen.js` | `src/math/eigen.js` |
| `poki-ready-copy/engine/geom/polygon.js` | `src/geom/polygon.js` |
| `poki-ready-copy/engine/geom/mesh.js` | `src/geom/mesh.js` |
| `poki-ready-copy/engine/fem/assemble.js` | `src/fem/assemble.js` |
| `poki-ready-copy/engine/fem/solve.js` | `src/fem/solve.js` |
| `poki-ready-copy/engine/audio/synth.js` | `src/audio/synth.js` |
| `poki-ready-copy/engine/audio/notes.js` | `src/audio/notes.js` |
| `poki-ready-copy/engine/app/presets.js` | `src/app/presets.js` |
| `poki-ready-copy/engine/app/draw.js` | `src/app/draw.js` |
| `poki-ready-copy/engine/app/canvas.js` | `src/app/canvas.js` |
| `poki-ready-copy/engine/styles/font.css` | `styles/font.css` |
