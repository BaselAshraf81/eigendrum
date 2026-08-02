/**
 * Nodal. See GAME.md for the design and why the mechanic is what it is.
 *
 * Three ways in, one engine:
 *   play  chapters, scored against what the drum can actually do
 *   draw  trace an outline and hear the drum it would be
 *   free  every built-in shape, every control
 *
 * Nothing is scripted and no threshold is invented; every number on screen came out
 * of the solver. Force is the one input that is deliberately *not* scored, because in
 * a linear membrane it scales every mode equally: it is loudness, not timbre, and the
 * third tutorial beat exists to teach exactly that.
 */

import { PRESETS_BY_ID, GWW_A, GWW_B, normalizeShape } from '../engine/app/presets.js';
import { strikeAmplitudes, nodeWeights, decayTimes, fieldAtTime } from '../engine/audio/synth.js';
import {
  CHAPTERS,
  OBJECTIVES,
  levelBrief,
  levelModes,
  levelTitle,
  scoreStrike,
  solveSet,
} from './levels.js';
import {
  MALLETS,
  MALLETS_BY_ID,
  DEFAULT_MALLET,
  malletRadius,
  unlockedMallets,
  forceFor,
  CHARGE_MS,
} from './mallets.js';
import { Plate, modeField, bothQuietField } from './plate.js';
import { Sandbox } from './sandbox.js';
import { requestDrum, setProgressHandler } from './solve.js';
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
  home: el('btn-home'),
  cellTarget: el('cell-target'),
  targetTitle: el('target-title'),
  targetVerb: el('target-verb'),
  targetNote: el('target-note'),
  drumTitle: el('drum-title'),
  drumVerb: el('drum-verb'),
  drumNote: el('drum-note'),
  brief: el('brief'),
  verdict: el('verdict'),
  next: el('btn-next'),
  strip: el('strip'),
  tray: el('tray'),
  trayShapesGroup: el('tray-shapes-group'),
  trayShapes: el('tray-shapes'),
  trayMallets: el('tray-mallets'),
  dialPitch: el('dial-pitch'),
  dialDecay: el('dial-decay'),
  btnSand: el('btn-sand'),
  restart: el('btn-restart'),
  figPrev: el('fig-prev'),
  figNext: el('fig-next'),
  figName: el('fig-name'),
  homeScreen: el('home'),
  wayPlay: el('way-play'),
  wayPlayMeta: el('way-play-meta'),
  wayDraw: el('way-draw'),
  wayFree: el('way-free'),
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
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  mode: 'home', // 'home' | 'play' | 'draw' | 'free'
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
  taus: null,
  t0: 0,
  ringing: false,
  previousAmps: null,
  marks: null,
  winners: null,
  // Every strike made on the current drum, so a player hunting a hidden nodal line
  // can see their own measurements converge on it.
  history: [],
  passed: false,
  busy: false,
  generation: 0,
  usingKeyboard: false,
  mallet: DEFAULT_MALLET,
  charge: null,
  progress: loadProgress(),
  capstone: null,
  phase: 'level',
};

setProgressHandler((p) => {
  els.solvingFill.style.transform = `scaleX(${p.toFixed(3)})`;
});

const sandbox = new Sandbox({ plate: drum, els, showSolving, onLeave: goHome });

function showSolving(on, sub) {
  if (sub) els.solvingSub.textContent = sub;
  if (on) els.solvingFill.style.transform = 'scaleX(0)';
  els.solving.hidden = !on;
}

// -------------------------------------------------------------------- progress

const levelKey = (c, i) => `${CHAPTERS[c].id}.${i}`;
const starsFor = (c, i) => state.progress.stars[levelKey(c, i)] || 0;
const totalStars = () =>
  Object.values(state.progress.stars).reduce((n, s) => n + s, 0) + (state.progress.capstone ? 3 : 0);

/** Chapters fully cleared, which is what decides the tools you own. */
function chaptersCleared() {
  let n = 0;
  for (let c = 0; c < CHAPTERS.length; c++) {
    if (CHAPTERS[c].levels.every((_, i) => starsFor(c, i) > 0)) n += 1;
    else break;
  }
  return n;
}

function recordStars(c, i, stars) {
  const key = levelKey(c, i);
  if ((state.progress.stars[key] || 0) >= stars) return;
  state.progress.stars[key] = stars;
  saveProgress(state.progress);
}

function firstUnfinished() {
  for (let c = 0; c < CHAPTERS.length; c++) {
    for (let i = 0; i < CHAPTERS[c].levels.length; i++) {
      if (starsFor(c, i) === 0) return { chapter: c, index: i };
    }
  }
  return null;
}

// ------------------------------------------------------------------------ modes

function setMode(mode) {
  state.mode = mode;
  els.game.dataset.mode = mode;
  els.homeScreen.hidden = mode !== 'home';
  els.cellTarget.hidden = mode !== 'play';
  els.tray.hidden = mode === 'home';
  els.hint.hidden = mode !== 'play';
  els.next.hidden = true;
  els.home.hidden = mode === 'home';
  els.progress.hidden = mode !== 'play';
  els.tally.hidden = mode !== 'play';
  if (mode !== 'play') {
    els.verdict.hidden = true;
    els.progress.replaceChildren();
  }
}

function goHome() {
  sandbox.leave();
  state.ringing = false;
  state.busy = false;
  poki.gameplayStop();
  setMode('home');
  const resume = firstUnfinished();
  els.chapterName.textContent = 'nodal';
  els.levelCount.textContent = '';
  const atStart = resume && resume.chapter === 0 && resume.index === 0;
  els.wayPlayMeta.textContent = resume
    ? atStart
      ? 'starts with three taps that cannot be failed'
      : `continue: ${CHAPTERS[resume.chapter].name}, ${resume.index + 1} of ${CHAPTERS[resume.chapter].levels.length}`
    : 'every drum cleared';
  // Saved progress used to make the opening unreachable: "play" resumes wherever you
  // left off, so anyone returning skipped the three teaching beats permanently and had
  // no way back to them. Offered here whenever the player is past them.
  els.restart.hidden = Boolean(atStart);
}

async function enterSandbox(kind) {
  setMode(kind);
  buildTrayForPlay(false);
  await sandbox.enter(kind);
  poki.gameplayStart();
}

/**
 * The tray in play mode carries mallets only, and only once more than one is owned.
 * Shapes and dials belong to the sandbox modes; a level's pitch and ring-out are
 * fixed so that two players' scores mean the same thing.
 */
function buildTrayForPlay(show) {
  if (!show) return;
  els.trayShapesGroup.hidden = true;
  const owned = unlockedMallets(chaptersCleared());
  els.tray.hidden = owned.length < 2;
  els.trayMallets.replaceChildren(
    ...owned.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = m.name;
      b.title = m.blurb;
      b.setAttribute('aria-pressed', String(m.id === state.mallet));
      b.onclick = () => {
        if (state.busy || m.id === state.mallet) return;
        state.mallet = m.id;
        loadLevel();
      };
      return b;
    }),
  );
  // Only the mallet group is relevant here.
  for (const group of els.tray.querySelectorAll('.tray-group')) {
    group.hidden = group !== els.trayMallets.parentElement;
  }
}

// ------------------------------------------------------------------ level load

async function loadLevel() {
  setMode('play');
  const chapter = CHAPTERS[state.chapter];
  const level = chapter.levels[state.index];
  state.level = level;
  state.phase = 'level';
  state.passed = false;
  state.strike = null;
  state.amps = null;
  state.marks = null;
  state.winners = null;
  state.ringing = false;
  state.charge = null;
  state.history = [];
  state.busy = true;
  const gen = ++state.generation;

  const objective = OBJECTIVES[level.kind];
  const modes = levelModes(level);

  els.chapterName.textContent = chapter.name;
  els.levelCount.textContent = `${state.index + 1} / ${chapter.levels.length}`;
  els.targetTitle.textContent = levelTitle(level);
  els.targetVerb.textContent = objective.verb;
  els.drumTitle.textContent = 'the drum';
  els.drumVerb.textContent = 'strike it';
  els.brief.textContent = levelBrief(level);
  els.verdict.hidden = true;
  els.next.hidden = true;
  els.hint.disabled = true;
  els.drumNote.textContent = 'tap to strike, or hold and release to hit harder';
  hud.buildProgress(els.progress, chapter.levels.length, (i) => starsFor(state.chapter, i));
  hud.markCurrent(els.progress, state.index);
  hud.clearStrip(els.strip, modes);
  els.tally.textContent = String(totalStars());
  buildTrayForPlay(true);

  const { raw, pitch } = shapePolygon(level.shape);
  const { polygon, align } = normalizeShape(raw, pitch);
  const exact = PRESETS_BY_ID.get(level.shape)?.exact;

  showSolving(
    true,
    `${level.shape} - ${TARGET_NODES} unknowns; ` +
      (exact ? 'this outline also has a closed-form spectrum' : 'no formula exists for this outline'),
  );
  const reply = await requestDrum({
    shapeId: level.shape,
    polygon,
    align,
    mallet: malletRadius(state.mallet),
    targetNodes: TARGET_NODES,
    modeCount: MODE_COUNT,
  });
  if (gen !== state.generation) return;
  if (!reply.ok) {
    showSolving(false);
    fail(reply.error);
    return;
  }
  adoptDrum(reply);

  // Proof at the moment of use. Empty with the starting tool would be a broken
  // level; empty with a tool the player chose is a fact about that tool, and the
  // difference matters because only one of them is a bug.
  const winners = solveSet(level, state.stats, { limit: 400 });
  if (winners.length === 0) {
    showSolving(false);
    if (state.mallet === DEFAULT_MALLET) {
      fail(`level ${levelKey(state.chapter, state.index)} has no winning strike`);
      return;
    }
    els.verdict.hidden = false;
    els.verdict.className = 'verdict is-bad';
    els.verdict.textContent =
      `The ${MALLETS_BY_ID.get(state.mallet).name} cannot do this one: it is too wide to ` +
      `excite a ripple that fine, anywhere on this drum. Pick a narrower tool.`;
  }
  state.winners = winners;

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
    // Honest about the method. An earlier version said "use the strip and your ears",
    // and the ears half was simply false: nobody can hear whether one particular mode
    // out of twelve is silent inside a chord. The strip half is true and is the whole
    // technique, so it says that and nothing more.
    // Say what the squares are, on the plate the player is looking at for help. An
    // unexplained mark is worse than no mark.
    els.targetNote.textContent = 'withheld - each square is a strike you made, smaller means quieter';
    els.drumNote.textContent = 'strike, read the marked bar, move, strike again';
  }

  layout();
  showSolving(false);
  els.hint.disabled = winners.length === 0;
  state.busy = false;
  poki.gameplayStart();
}

function shapePolygon(id) {
  if (id === 'gww-a') return { raw: GWW_A, pitch: 1 };
  if (id === 'gww-b') return { raw: GWW_B, pitch: 1 };
  const preset = PRESETS_BY_ID.get(id);
  return { raw: preset.polygon, pitch: preset.latticePitch || 0 };
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
  state.aim = centroidOf(reply.mesh.polygon);
}

/** The membrane's displacement at time t, unnormalised. */
function fieldAt(amps, taus, t) {
  const out = new Float64Array(state.drum.mesh.nodeCount);
  fieldAtTime(state.drum.modes, amps, state.freqs, taus, t, out);
  return out;
}

function peakOf(values) {
  let peak = 0;
  for (let i = 0; i < values.length; i++) peak = Math.max(peak, Math.abs(values[i]));
  return peak;
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

function fail(message) {
  poki.captureError(message);
  showSolving(false);
  state.busy = false;
  curtain({
    kind: 'that did not work',
    title: 'the drum would not solve',
    copy: `${message}. Nothing is lost, and your progress is saved.`,
    action: 'try this drum again',
    onward: () => loadLevel(),
    replay: () => goHome(),
    replayLabel: 'back to the menu',
  });
}

// ----------------------------------------------------------------- the striking

function strikeAt(x, y, force = 1) {
  if (state.busy || !state.drum) return;
  if (state.phase === 'capstone') return answerCapstone();
  if (!drum.board.containsShapePoint(x, y)) {
    els.drumNote.textContent = 'that is outside the drum';
    return;
  }

  // Unit force for scoring, so a score measures position and nothing else.
  const unit = strikeAmplitudes(
    state.drum.mesh,
    state.drum.modes,
    x,
    y,
    malletRadius(state.mallet),
    state.weights,
  );
  const result = scoreStrike(state.level, unit, state.stats, {
    force,
    previous: state.previousAmps,
  });

  const heard = new Float64Array(unit.length);
  for (let k = 0; k < unit.length; k++) heard[k] = unit[k] * force;

  state.amps = heard;
  state.taus = decayTimes(state.freqs, 1.35, 0.55);
  // One reference amplitude for the whole ring-out, measured at the moment the
  // fundamental first reaches full swing. Re-normalising per frame would peg the
  // maximum at 1.0 forever, which made the animation invisible: the pattern moved
  // but every colour band stayed exactly where it was.
  state.refAmp = peakOf(fieldAt(heard, state.taus, 1 / (4 * state.freqs[0]))) || 1;
  state.strike = { x, y, ok: result.stars > 0 };
  state.aim = { x, y };
  state.t0 = performance.now();
  state.ringing = true;

  let peak = 0;
  for (let k = 0; k < heard.length; k++) peak = Math.max(peak, Math.abs(heard[k]));
  hud.paintStrip(els.strip, heard, levelModes(state.level), peak, state.freqs);
  audio.playStrike(state.freqs, heard, { taus: state.taus });

  els.verdict.hidden = false;
  els.verdict.className = result.stars > 0 ? 'verdict is-good' : 'verdict is-bad';
  els.verdict.replaceChildren(hud.starMarks(result.stars), document.createTextNode(` ${result.say}`));
  // Report the force every time, and say what to do about it. The charge ring on the
  // plate is invisible as an affordance: nothing tells you holding is even an option
  // until a number appears and changes when you hold longer.
  const pct = Math.round(force * 100);
  els.drumNote.textContent =
    force < 0.99
      ? `struck at ${pct}% force - hold before releasing to hit harder`
      : 'struck at full force';

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
  state.previousAmps = unit;

  // Keep the measurement on the plate, but only where the diagram is withheld.
  //
  // These marks exist to replace information the player cannot see. On a level that
  // shows the mode's pattern they replace nothing, and a trail of unexplained squares
  // accumulating over a diagram that already gives the answer is just litter. `miss`
  // is normalised so 0 is perfect for whichever objective this is, which lets one
  // encoding serve them all: the smaller the mark, the better that spot was.
  if (state.level.blind && state.level.kind !== 'tutorial') {
    const miss =
      state.level.kind === 'silence' || state.level.kind === 'double'
        ? Math.min(1, result.value / 0.12)
        : Math.max(0, 1 - result.value);
    state.history.push({ x, y, miss, scored: result.stars > 0 });
    if (state.history.length > 24) state.history.shift();
  }
}

function showHint() {
  if (!state.winners || !state.winners.length || !state.drum) return;
  const { nodes } = state.drum.mesh;
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
  if (state.busy) return;
  state.busy = true;
  els.next.hidden = true;
  state.previousAmps = null;

  const chapter = CHAPTERS[state.chapter];
  if (state.index + 1 < chapter.levels.length) {
    state.index += 1;
    await adBreak();
    loadLevel();
    return;
  }
  if (state.chapter + 1 < CHAPTERS.length) {
    const nextChapter = CHAPTERS[state.chapter + 1];
    const earned = MALLETS.find((m) => m.unlockedAt === state.chapter + 1);
    curtain({
      kind: earned ? 'chapter clear, new tool' : 'chapter clear',
      title: chapter.name,
      copy: earned
        ? `${nextChapter.premise}\n\nYou also picked up a ${earned.name}. ${earned.blurb}`
        : nextChapter.premise,
      action: 'begin ' + nextChapter.name,
      onward: async () => {
        state.chapter += 1;
        state.index = 0;
        await adBreak();
        loadLevel();
      },
    });
    return;
  }
  loadCapstone();
}

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

async function loadCapstone() {
  setMode('play');
  state.phase = 'capstone';
  state.busy = true;
  state.marks = null;
  state.strike = null;
  state.ringing = false;
  els.chapterName.textContent = 'the examination';
  els.levelCount.textContent = 'last';
  els.hint.disabled = true;
  els.next.hidden = true;
  els.verdict.hidden = true;
  els.targetTitle.textContent = 'drum I';
  els.targetVerb.textContent = 'was it this one?';
  els.drumTitle.textContent = 'drum II';
  els.drumVerb.textContent = 'or this one?';
  els.drumNote.textContent = 'tap the drum you think made the sound';
  els.targetNote.textContent = 'tap this drum to answer';
  els.brief.textContent = 'One sound. Two drums. Tap the one that made it.';
  els.progress.replaceChildren();
  hud.clearStrip(els.strip, []);
  els.tray.hidden = true;

  showSolving(true, 'solving both drums, so the comparison is measured');
  const a = normalizeShape(GWW_A, 1);
  const b = normalizeShape(GWW_B, 1);
  const opts = { mallet: malletRadius(DEFAULT_MALLET), targetNodes: TARGET_NODES, modeCount: MODE_COUNT };
  const ra = await requestDrum({ shapeId: 'gww-a', polygon: a.polygon, align: a.align, ...opts });
  const rb = await requestDrum({ shapeId: 'gww-b', polygon: b.polygon, align: b.align, ...opts });
  if (!ra.ok || !rb.ok) {
    showSolving(false);
    fail(ra.error || rb.error || 'the pair failed to solve');
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

  layout();
  showSolving(false);
  state.busy = false;

  let best = 0;
  for (let i = 1; i < ra.peaks.length; i++) if (ra.peaks[i] > ra.peaks[best]) best = i;
  const amps = strikeAmplitudes(
    ra.mesh,
    ra.modes,
    ra.mesh.nodes[best * 2],
    ra.mesh.nodes[best * 2 + 1],
    malletRadius(DEFAULT_MALLET),
    state.weights,
  );
  hud.paintStrip(els.strip, amps, [], 0, ra.freqs);
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
      curtain({
        kind: 'that is the end',
        title: `${totalStars()} resonances`,
        copy:
          'That is every drum in the game, including the one that cannot be solved. Draw mode and ' +
          'free mode are open from the menu, and the levels you took one or two marks on are still ' +
          'there: a cleaner strike is almost always available.',
        action: 'back to the menu',
        onward: () => goHome(),
      });
    },
    replay: () => loadCapstone(),
  });
}

// ----------------------------------------------------------------------- render

function render() {
  if (state.mode === 'draw' || state.mode === 'free') {
    sandbox.render(state.charge);
    return;
  }
  target.draw();
  drum.draw({
    crosshair: state.usingKeyboard && !state.ringing ? state.aim : null,
    marks: state.marks && state.phase === 'level' ? state.marks : null,
    strike: state.strike,
    history: state.phase === 'level' ? state.history : null,
    charge: state.charge,
  });
}

function layout() {
  target.resize();
  drum.resize();
  render();
}

/**
 * The membrane, animated.
 *
 * The instrument's own rule applies: motion means something is genuinely vibrating.
 * A ringing drum *is* vibrating, so an animated ring-out is both more honest and far
 * easier to read than the single frozen frame this used to draw. Reduced motion holds
 * the peak instead, which keeps the information and drops the movement.
 */
function frame(now) {
  // Charging is reported in words in every mode. The ring closing on the aim point is
  // invisible as an affordance on its own: a number that moves while you hold is what
  // tells a player that holding does anything at all.
  if (state.charge) {
    state.charge.t = Math.min(1, (now - state.charge.start) / CHARGE_MS);
    els.drumNote.textContent = `${Math.round(forceFor(now - state.charge.start) * 100)}% force - release to strike`;
  }

  if (state.mode === 'draw' || state.mode === 'free') {
    sandbox.frame(now, reducedMotion);
    if (state.charge) sandbox.render(state.charge);
    requestAnimationFrame(frame);
    return;
  }

  if (state.charge) {
    render();
  } else if (state.ringing && state.amps) {
    const elapsed = (now - state.t0) / 1000;
    const maxTau = Math.max(...state.taus);
    if (elapsed > maxTau * 3.2) {
      state.ringing = false;
      drum.setField(null, 1);
      render();
    } else {
      const t = reducedMotion ? Math.min(elapsed, 1 / (4 * state.freqs[0])) : elapsed;
      drum.setField(fieldAt(state.amps, state.taus, t), 1 / state.refAmp);
      render();
    }
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------------ input

/** Hold to charge. Releasing strikes with whatever force has accumulated. */
function beginCharge(x, y) {
  state.charge = { x, y, t: 0, start: performance.now() };
}

function releaseCharge() {
  if (!state.charge) return 1;
  const force = forceFor(performance.now() - state.charge.start);
  state.charge = null;
  return force;
}

drum.canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  drum.canvas.setPointerCapture?.(event.pointerId);
  state.usingKeyboard = false;

  if (state.mode === 'draw' && !sandbox.drum) {
    sandbox.beginStroke(drum.board.fromClientDraw(event.clientX, event.clientY));
    return;
  }
  const p = drum.board.fromClient(event.clientX, event.clientY);
  if (state.mode === 'play' && state.phase === 'capstone') {
    strikeAt(p.x, p.y, 1);
    return;
  }
  beginCharge(p.x, p.y);
});

drum.canvas.addEventListener('pointermove', (event) => {
  if (state.mode === 'draw' && sandbox.drawing) {
    sandbox.extendStroke(drum.board.fromClientDraw(event.clientX, event.clientY));
  }
});

const endPointer = (event) => {
  if (state.mode === 'draw' && sandbox.drawing) {
    sandbox.endStroke();
    return;
  }
  if (!state.charge) return;
  const { x, y } = state.charge;
  const force = releaseCharge();
  if (state.mode === 'play') strikeAt(x, y, force);
  else sandbox.strikeAt(x, y, force);
};
drum.canvas.addEventListener('pointerup', endPointer);
drum.canvas.addEventListener('pointercancel', () => {
  state.charge = null;
  sandbox.drawing = false;
});

target.canvas.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'play' || state.phase !== 'capstone') return;
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
    if (state.mode === 'play' && state.phase === 'capstone') {
      answerCapstone();
    } else if (!state.charge && !event.repeat) {
      beginCharge(state.aim.x, state.aim.y);
    }
  }
});

drum.canvas.addEventListener('keyup', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!state.charge) return;
  const { x, y } = state.charge;
  const force = releaseCharge();
  if (state.mode === 'play') strikeAt(x, y, force);
  else sandbox.strikeAt(x, y, force);
});

els.next.addEventListener('click', advance);
els.hint.addEventListener('click', showHint);
els.home.addEventListener('click', goHome);
els.wayPlay.addEventListener('click', () => {
  const resume = firstUnfinished();
  if (resume) {
    state.chapter = resume.chapter;
    state.index = resume.index;
    loadLevel();
  } else {
    loadCapstone();
  }
});
els.restart.addEventListener('click', () => {
  // Replays from the opening without discarding anything already earned.
  state.chapter = 0;
  state.index = 0;
  loadLevel();
});
els.wayDraw.addEventListener('click', () => enterSandbox('draw'));
els.wayFree.addEventListener('click', () => enterSandbox('free'));
els.btnSand.addEventListener('click', () => sandbox.toggleSand());
els.figPrev.addEventListener('click', () => sandbox.stepFigure(-1));
els.figNext.addEventListener('click', () => sandbox.stepFigure(1));
els.dialPitch.addEventListener('input', () => sandbox.setPitch(Number(els.dialPitch.value)));
els.dialDecay.addEventListener('input', () => sandbox.setDecay(Number(els.dialDecay.value)));

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

  // The SDK and the game load concurrently. Awaiting the SDK first would put its
  // whole advertising stack, measured at about 1.8s of network, in front of the menu.
  poki.loadingStart();
  const sdkReady = poki.initPoki();
  goHome();
  requestAnimationFrame(frame);
  await sdkReady;
  poki.loadingFinished();
}

boot().catch((err) => {
  poki.captureError(err);
  fail(String((err && err.message) || err));
});
