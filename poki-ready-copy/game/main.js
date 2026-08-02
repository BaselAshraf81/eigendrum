/**
 * Nodal. See GAME.md for the design and why the mechanic is what it is.
 *
 * The loop: a level names one or two modes and an objective. The player strikes
 * the drum once, the engine projects the mallet onto the real mode shapes, and the
 * result is scored against what the drum can actually do. Nothing is scripted and
 * no threshold is invented; every number on screen came out of the solver.
 */

import { PRESETS_BY_ID, GWW_A, GWW_B, normalizeShape } from '../engine/app/presets.js';
import { strikeAmplitudes, nodeWeights, decayTimes, fieldAtTime } from '../engine/audio/synth.js';
import {
  CHAPTERS,
  OBJECTIVES,
  levelModes,
  levelTitle,
  scoreStrike,
  solveSet,
} from './levels.js';
import { Plate, modeField, bothQuietField } from './plate.js';
import * as hud from './hud.js';
import * as audio from './audio.js';
import * as poki from './poki.js';
import { loadProgress, saveProgress, isPersistent } from './store.js';

const MODE_COUNT = 12;
const TARGET_NODES = 1200;
const HINT_MARKS = 14;

const el = (id) => document.getElementById(id);
const els = {
  game: el('game'),
  chapterName: el('chapter-name'),
  levelCount: el('level-count'),
  progress: el('progress'),
  tally: el('tally'),
  hint: el('btn-hint'),
  sound: el('btn-sound'),
  targetTitle: el('target-title'),
  targetVerb: el('target-verb'),
  targetNote: el('target-note'),
  drumNote: el('drum-note'),
  brief: el('brief'),
  verdict: el('verdict'),
  next: el('btn-next'),
  strip: el('strip'),
  curtain: el('curtain'),
  curtainKind: el('curtain-kind'),
  curtainTitle: el('curtain-title'),
  curtainCopy: el('curtain-copy'),
  onward: el('btn-onward'),
  replay: el('btn-replay'),
  solving: el('solving'),
  solvingFill: el('solving-fill'),
  solvingSub: el('solving-sub'),
};

const target = new Plate(el('target'));
const drum = new Plate(el('drum'));

// No JS reduced-motion branch is needed here, unlike the instrument: this game
// draws a strike as a single still figure and runs no animation loop at all, so the
// CSS transition clamp is the whole story.

const state = {
  chapter: 0,
  index: 0,
  level: null,
  drum: null,
  stats: null,
  weights: null,
  freqs: null,
  aim: { x: 0, y: 0 },
  strike: null,
  amps: null,
  marks: null,
  // The winning strike points for the current level. Must be cleared on every load:
  // a stale set would make the hint mark a previous drum's nodes, and a dishonest
  // hint is forbidden outright.
  winners: null,
  passed: false,
  busy: false,
  reqId: 0,
  // Bumped per load, so a reply that arrives after the player has moved on is
  // discarded instead of being applied under the new level's labels and scoring.
  generation: 0,
  usingKeyboard: false,
  progress: loadProgress(),
  capstone: null,
  phase: 'level', // 'level' | 'capstone' | 'done'
};

const worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
const pending = new Map();

worker.onmessage = ({ data }) => {
  if (data.progress !== undefined) {
    els.solvingFill.style.transform = `scaleX(${data.progress.toFixed(3)})`;
    return;
  }
  const resolve = pending.get(data.id);
  if (!resolve) return;
  pending.delete(data.id);
  resolve(data);
};
worker.onerror = (e) => poki.captureError(e.message || 'worker failed');

/** Solves a shape and builds its amplitude table. One request, one promise. */
function requestDrum(shapeId, polygon, align, mallet) {
  const id = ++state.reqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({
      id,
      shapeId,
      polygon,
      align,
      mallet,
      targetNodes: TARGET_NODES,
      modeCount: MODE_COUNT,
    });
  });
}

function shapePolygon(id) {
  if (id === 'gww-a') return { raw: GWW_A, pitch: 1 };
  if (id === 'gww-b') return { raw: GWW_B, pitch: 1 };
  const preset = PRESETS_BY_ID.get(id);
  return { raw: preset.polygon, pitch: preset.latticePitch || 0 };
}

// -------------------------------------------------------------------- progress

const levelKey = (c, i) => `${CHAPTERS[c].id}.${i}`;
const starsFor = (c, i) => state.progress.stars[levelKey(c, i)] || 0;
const totalStars = () =>
  Object.values(state.progress.stars).reduce((n, s) => n + s, 0) +
  (state.progress.capstone ? 3 : 0);

function recordStars(c, i, stars) {
  const key = levelKey(c, i);
  if ((state.progress.stars[key] || 0) >= stars) return;
  state.progress.stars[key] = stars;
  saveProgress(state.progress);
}

/** The furthest level the player has a right to be on. */
function firstUnfinished() {
  for (let c = 0; c < CHAPTERS.length; c++) {
    for (let i = 0; i < CHAPTERS[c].levels.length; i++) {
      if (starsFor(c, i) === 0) return { chapter: c, index: i };
    }
  }
  return null;
}

// ------------------------------------------------------------------ level load

async function loadLevel() {
  const chapter = CHAPTERS[state.chapter];
  const level = chapter.levels[state.index];
  state.level = level;
  state.phase = 'level';
  state.passed = false;
  state.strike = null;
  state.amps = null;
  state.marks = null;
  state.winners = null;
  state.busy = true;
  const gen = ++state.generation;

  const objective = OBJECTIVES[level.kind];
  const modes = levelModes(level);

  els.chapterName.textContent = chapter.name;
  els.levelCount.textContent = `${state.index + 1} / ${chapter.levels.length}`;
  els.targetTitle.textContent = levelTitle(level);
  els.targetVerb.textContent = objective.verb;
  els.brief.textContent = objective.brief(level);
  els.verdict.hidden = true;
  els.next.hidden = true;
  els.hint.disabled = true;
  els.drumNote.textContent = 'tap anywhere';
  hud.buildProgress(els.progress, chapter.levels.length, (i) => starsFor(state.chapter, i));
  hud.markCurrent(els.progress, state.index);
  hud.clearStrip(els.strip, modes);
  els.tally.textContent = String(totalStars());

  const { raw, pitch } = shapePolygon(level.shape);
  const { polygon, align } = normalizeShape(raw, pitch);

  // Say something true. "No formula exists" is false for the circle, square,
  // rectangle and triangle, whose spectra this repo solves in closed form, and those
  // are most of the levels. The mesh resolution is stated either way, because P1
  // eigenvalues are upper bounds and the interface may never imply exactness.
  const exact = PRESETS_BY_ID.get(level.shape)?.exact;
  showSolving(
    true,
    `${level.shape} - ${TARGET_NODES} unknowns; ` +
      (exact ? 'this outline also has a closed-form spectrum' : 'no formula exists for this outline'),
  );
  const reply = await requestDrum(level.shape, polygon, align, level.mallet);
  if (gen !== state.generation) return; // superseded by a newer load
  if (!reply.ok) {
    showSolving(false);
    fail(reply.error);
    return;
  }
  adoptDrum(reply);

  // Proof, at the moment of use: a level ships only if the drum itself contains a
  // point that would earn three stars.
  const winners = solveSet(level, state.stats, { limit: 400 });
  if (winners.length === 0) {
    showSolving(false);
    fail(`level ${levelKey(state.chapter, state.index)} has no winning strike`);
    return;
  }
  state.winners = winners;

  // A fresh drum is at rest, so it shows no field until the player strikes it.
  drum.setField(null, 1);
  target.setHidden(Boolean(level.blind));
  if (!level.blind) {
    const field =
      objective.field(level).kind === 'bothQuiet'
        ? bothQuietField(state.drum.modes, modes)
        : modeField(state.drum.modes, modes[0]);
    target.setField(field, 1);
    els.targetNote.textContent = objective.note;
  } else {
    target.setField(null, 1);
    els.targetNote.textContent = 'withheld - use the strip and your ears';
  }

  layout();
  showSolving(false);
  els.hint.disabled = false;
  state.busy = false;
  poki.gameplayStart();
}

function adoptDrum(reply) {
  state.drum = { mesh: reply.mesh, modes: reply.modes, eigenvalues: reply.eigenvalues };
  state.freqs = reply.freqs;
  state.weights = nodeWeights(reply.mesh);
  state.stats = {
    table: reply.table,
    peaks: reply.peaks,
    bestWake: reply.bestWake,
    globalPeak: reply.globalPeak,
    nodeCount: reply.nodeCount,
    modeCount: reply.modeCount,
  };
  target.setDrum(state.drum);
  drum.setDrum(state.drum);
  const c = centroidOf(reply.mesh.polygon);
  state.aim = c;
}

/**
 * The membrane at the instant the fundamental first reaches full swing, normalised
 * so the posterised ramp uses its whole range. A still figure rather than an
 * animation: this is the shape of the strike being scored, and nothing in this
 * world moves unless it is genuinely vibrating.
 */
function displacementField(amps, taus) {
  const out = new Float64Array(state.drum.mesh.nodeCount);
  fieldAtTime(state.drum.modes, amps, state.freqs, taus, 1 / (4 * state.freqs[0]), out);
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

function centroidOf(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/**
 * Something broke. Always leave a way forward.
 *
 * An earlier version wrote the message into the readout and stopped there, which
 * left `busy` set, the hint disabled and no button on screen: one worker throw
 * bricked the whole run.
 */
function fail(message) {
  poki.captureError(message);
  showSolving(false);
  state.busy = false;
  curtain({
    kind: 'that did not work',
    title: 'the drum would not solve',
    copy: `${message}. Nothing is lost, and your progress is saved. Try this drum again, or go back to the first one.`,
    action: 'try this drum again',
    onward: () => loadLevel(),
    replay: () => {
      state.chapter = 0;
      state.index = 0;
      loadLevel();
    },
    replayLabel: 'back to the start',
  });
}

function showSolving(on, sub) {
  if (sub) els.solvingSub.textContent = sub;
  if (on) els.solvingFill.style.transform = 'scaleX(0)';
  els.solving.hidden = !on;
}

// ----------------------------------------------------------------- the striking

function strikeAt(x, y) {
  if (state.busy || !state.drum) return;
  if (state.phase === 'capstone') return answerCapstone();
  if (!drum.board.containsShapePoint(x, y)) {
    els.drumNote.textContent = 'that is outside the drum';
    return;
  }

  const amps = strikeAmplitudes(
    state.drum.mesh,
    state.drum.modes,
    x,
    y,
    state.level.mallet,
    state.weights,
  );
  const result = scoreStrike(state.level, amps, state.stats);
  state.amps = amps;
  state.strike = { x, y, ok: result.stars > 0 };
  state.aim = { x, y };

  hud.paintStrip(els.strip, amps, levelModes(state.level), result.peak);

  // Show the mixture the player just made. Without this the drum answers a strike
  // with nothing but a ring marker, which throws away both the best feedback the
  // engine can give and the only view of the superposition being scored.
  const taus = decayTimes(state.freqs, 1.35, 0.55);
  drum.setField(displacementField(amps, taus), 1);
  audio.playStrike(state.freqs, amps, { taus });

  els.verdict.hidden = false;
  els.verdict.className = result.stars > 0 ? 'verdict is-good' : 'verdict is-bad';
  els.verdict.replaceChildren(hud.starMarks(result.stars), document.createTextNode(` ${result.say}`));
  els.drumNote.textContent = result.stars > 0 ? 'or strike again to do better' : 'strike again';

  if (result.stars > 0) {
    recordStars(state.chapter, state.index, result.stars);
    hud.buildProgress(els.progress, CHAPTERS[state.chapter].levels.length, (i) =>
      starsFor(state.chapter, i),
    );
    hud.markCurrent(els.progress, state.index);
    els.tally.textContent = String(totalStars());
    if (!state.passed) {
      state.passed = true;
      els.next.hidden = false;
      els.next.focus({ preventScroll: true });
    }
  }
  render();
}

function showHint() {
  if (!state.winners || !state.drum) return;
  const { nodes } = state.drum.mesh;
  // Spread the marks across the winning set rather than showing the first few,
  // which would all sit in one corner of the mesh ordering.
  const step = Math.max(1, Math.floor(state.winners.length / HINT_MARKS));
  const marks = [];
  for (let i = 0; i < state.winners.length && marks.length < HINT_MARKS; i += step) {
    const n = state.winners[i];
    marks.push({ x: nodes[n * 2], y: nodes[n * 2 + 1] });
  }
  state.marks = marks;
  els.hint.disabled = true;
  els.drumNote.textContent = 'the marks are places that would score full';
  render();
}

// ---------------------------------------------------------------------- advance

async function advance() {
  // Shut the door before awaiting anything. An ad break can take seconds, and a
  // second activation of this button used to increment the level twice and start two
  // concurrent loads whose replies could land out of order.
  if (state.busy) return;
  state.busy = true;
  els.next.hidden = true;

  const chapter = CHAPTERS[state.chapter];
  if (state.index + 1 < chapter.levels.length) {
    state.index += 1;
    // Signalled at every level boundary, which is what Poki asks for: they want as
    // many opportunities as possible and their own system decides when a player is
    // actually due one, so throttling here would only cost revenue.
    await adBreak();
    loadLevel();
    return;
  }
  if (state.chapter + 1 < CHAPTERS.length) {
    curtain({
      kind: 'chapter clear',
      title: chapter.name,
      copy: CHAPTERS[state.chapter + 1].premise,
      action: 'begin ' + CHAPTERS[state.chapter + 1].name,
      onward: async () => {
        state.chapter += 1;
        state.index = 0;
        // Poki wants breaks at natural pauses, and a chapter boundary is the only
        // real one this game has.
        await adBreak();
        loadLevel();
      },
    });
    return;
  }
  loadCapstone();
}

/**
 * An ad opportunity. Audio is silenced only if an ad actually starts, and through
 * `setSuspended` rather than the mute control, so a break never overwrites what the
 * player chose. Not every call shows an ad; Poki decides.
 */
function adBreak() {
  return poki.commercialBreak({
    onStart: () => audio.setSuspended(true),
    onEnd: () => audio.setSuspended(false),
  });
}

function curtain({ kind, title, copy, action, onward, replay = null, replayLabel = 'play it again' }) {
  poki.gameplayStop();
  els.curtainKind.textContent = kind;
  els.curtainTitle.textContent = title;
  els.curtainCopy.textContent = copy;
  els.onward.textContent = action;
  els.curtain.hidden = false;
  els.replay.hidden = !replay;
  els.replay.textContent = replayLabel;

  const close = (run) => () => {
    els.curtain.hidden = true;
    document.removeEventListener('keydown', trap, true);
    run();
  };
  els.onward.onclick = close(onward);
  els.replay.onclick = replay ? close(replay) : null;

  /**
   * A real modal: focus stays inside it and Tab wraps. Without this the masthead
   * tools and the drum behind the curtain were still reachable, so a keyboard player
   * could strike a drum they could not see. There is deliberately no Escape: every
   * curtain here is a decision, and none of them has a safe default.
   */
  function trap(event) {
    if (event.key !== 'Tab') return;
    const focusable = [els.onward, els.replay].filter((n) => !n.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !focusable.includes(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !focusable.includes(active))) {
      event.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', trap, true);
  els.onward.focus({ preventScroll: true });
}

// --------------------------------------------------------------------- capstone

/**
 * The examination, and the one level nobody can pass.
 *
 * The two drums are the Gordon-Webb-Wolpert pair: different outlines, identical
 * spectra. Whichever the player picks, the honest answer is that the question has
 * no answer, and they are credited rather than failed for finding out. The framing
 * is load-bearing, because an unwinnable level with sloppy copy reads as a bug.
 */
async function loadCapstone() {
  state.phase = 'capstone';
  state.busy = true;
  state.marks = null;
  state.strike = null;
  els.chapterName.textContent = 'the examination';
  els.levelCount.textContent = 'last';
  els.hint.disabled = true;
  els.next.hidden = true;
  els.verdict.hidden = true;
  els.targetTitle.textContent = 'drum I';
  els.targetVerb.textContent = 'was it this one?';
  els.drumNote.textContent = 'tap the drum you think made the sound';
  els.targetNote.textContent = 'tap this drum to answer';
  els.brief.textContent = 'One sound. Two drums. Tap the one that made it.';
  els.progress.replaceChildren();
  hud.clearStrip(els.strip, []);

  showSolving(true, 'solving both drums, so the comparison is measured');
  const a = normalizeShape(GWW_A, 1);
  const b = normalizeShape(GWW_B, 1);
  const [ra, rb] = [
    await requestDrum('gww-a', a.polygon, a.align, 0.055),
    await requestDrum('gww-b', b.polygon, b.align, 0.055),
  ];
  if (!ra.ok || !rb.ok) {
    showSolving(false);
    fail((ra.error || rb.error) ?? 'the pair failed to solve');
    return;
  }

  state.capstone = { a: ra, b: rb };
  state.drum = { mesh: ra.mesh, modes: ra.modes, eigenvalues: ra.eigenvalues };
  state.freqs = ra.freqs;
  state.weights = nodeWeights(ra.mesh);

  target.setDrum({ mesh: ra.mesh, modes: ra.modes });
  target.setHidden(false);
  target.setField(modeField(ra.modes, 0), 1);
  drum.setDrum({ mesh: rb.mesh, modes: rb.modes });
  drum.setHidden(false);
  drum.setField(modeField(rb.modes, 0), 1);
  els.drumNote.textContent = 'or tap this one';

  layout();
  showSolving(false);
  state.busy = false;

  // Play drum I's strike. It is also drum II's strike; that is the whole point.
  // The point is the node with the largest available peak rather than a hardcoded
  // coordinate, so it is guaranteed to lie inside this outline and to wake plenty.
  let best = 0;
  for (let i = 1; i < ra.peaks.length; i++) if (ra.peaks[i] > ra.peaks[best]) best = i;
  const amps = strikeAmplitudes(
    ra.mesh,
    ra.modes,
    ra.mesh.nodes[best * 2],
    ra.mesh.nodes[best * 2 + 1],
    0.055,
    state.weights,
  );
  hud.paintStrip(els.strip, amps, [], 0);
  audio.playStrike(ra.freqs, amps);
  poki.gameplayStart();
}

function answerCapstone() {
  if (!state.capstone) return;
  const { a, b } = state.capstone;
  let worst = 0;
  const n = Math.min(a.freqs.length, b.freqs.length);
  for (let k = 0; k < n; k++) {
    worst = Math.max(worst, Math.abs(a.freqs[k] - b.freqs[k]) / Math.max(1e-12, a.freqs[k]));
  }
  state.progress.capstone = true;
  saveProgress(state.progress);
  els.tally.textContent = String(totalStars());

  curtain({
    kind: 'no answer exists',
    title: 'you found the reason',
    copy:
      `Both drums made that sound. All ${n} frequencies agree to within ` +
      `${(worst * 100).toPrecision(2)}%, solved just now, on your machine. Mark Kac asked in 1966 ` +
      `whether the shape of a drum could be heard. In 1992 Gordon, Webb and Wolpert answered no, ` +
      `by building this pair. You did not get it wrong; nobody can get it right.`,
    action: 'what now',
    onward: () => {
      state.phase = 'done';
      curtain({
        kind: 'that is the end',
        // No free-play studio is claimed here. An earlier draft of this card offered
        // one, and it did not exist: promising a mode that was never built is exactly
        // the kind of thing this project is not allowed to do.
        title: `${totalStars()} resonances`,
        copy:
          'That is every drum in the game, including the one that cannot be solved. ' +
          'Go back for the levels you took one or two marks on: a cleaner strike is ' +
          'almost always available, and the drum will tell you by how much.',
        action: 'start again from the first drum',
        onward: () => {
          state.chapter = 0;
          state.index = 0;
          loadLevel();
        },
      });
    },
    replay: () => loadCapstone(),
  });
}

// ----------------------------------------------------------------------- render

function render() {
  const showMarks = state.marks && state.phase === 'level';
  target.draw();
  drum.draw({
    crosshair: state.usingKeyboard ? state.aim : null,
    marks: showMarks ? state.marks : null,
    strike: state.strike,
  });
}

function layout() {
  target.resize();
  drum.resize();
  render();
}

// ------------------------------------------------------------------------ input

function pointerStrike(event) {
  event.preventDefault();
  state.usingKeyboard = false;
  const p = drum.board.fromClient(event.clientX, event.clientY);
  strikeAt(p.x, p.y);
}

drum.canvas.addEventListener('pointerdown', pointerStrike);

// The capstone answers by tapping either plate, so the left one becomes live too.
target.canvas.addEventListener('pointerdown', (event) => {
  if (state.phase !== 'capstone') return;
  event.preventDefault();
  answerCapstone();
});

drum.canvas.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 0.008 : 0.03;
  const moves = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  if (moves[event.key]) {
    event.preventDefault();
    state.usingKeyboard = true;
    state.aim = { x: state.aim.x + moves[event.key][0], y: state.aim.y + moves[event.key][1] };
    render();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    state.usingKeyboard = true;
    strikeAt(state.aim.x, state.aim.y);
  }
});

els.next.addEventListener('click', advance);
els.hint.addEventListener('click', showHint);
els.sound.addEventListener('click', () => {
  const muted = !audio.isMuted();
  audio.setMuted(muted);
  els.sound.setAttribute('aria-pressed', String(muted));
  els.sound.textContent = muted ? 'sound off' : 'sound on';
});

let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(layout);
});
window.addEventListener('orientationchange', () => requestAnimationFrame(layout));

// -------------------------------------------------------------------------- boot

async function boot() {
  hud.buildStrip(els.strip);
  els.sound.setAttribute('aria-pressed', 'false');
  els.sound.textContent = 'sound on';
  if (!isPersistent()) {
    els.tally.title = 'Private window: progress lasts for this session only.';
  }

  // The SDK and the first solve run concurrently. Awaiting the SDK first would add
  // its whole advertising stack, measured at about 1.8s of network, in front of a
  // 380ms solve, for no benefit to the player.
  poki.loadingStart();
  const sdkReady = poki.initPoki();

  const resume = firstUnfinished();
  if (resume) {
    state.chapter = resume.chapter;
    state.index = resume.index;
  }

  // Everything already done in a previous session goes straight to the capstone
  // rather than making a returning player replay twenty-five levels.
  const firstScreen = resume ? loadLevel() : loadCapstone();

  await Promise.all([firstScreen, sdkReady]);
  poki.loadingFinished();

  // Deliberately no pre-roll. The documented flow puts a break between loading and
  // the first round, and testing it served a full-screen playable ad before the
  // player had seen a single thing, which is the worst possible first impression for
  // a game whose whole hook is "look at this shape". Breaks start from the first
  // level boundary instead, where the player has already been given something.
}

boot().catch((err) => {
  poki.captureError(err);
  fail(String((err && err.message) || err));
});
