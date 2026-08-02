/**
 * Progress storage that cannot throw.
 *
 * Incognito mode restricts localStorage, and every portal requires games to stay
 * playable there, so every access is guarded and falls back to memory for the
 * session. A player in a private window loses their progress when they close the
 * tab, which is the correct trade: the alternative is a game that refuses to start.
 *
 * CrazyGames serves games inside an iframe and says plainly that their Automatic
 * Progress Save does not work for iframe games: they cannot back up an origin they do
 * not control. Plain localStorage there is really just the tab's own scratch space.
 * Their Data Module is a drop-in replacement for exactly this reason, so where it is
 * available (see `platform.dataModule()`) it is the save that is actually kept, and
 * localStorage is kept alongside only as an immediate, synchronous local cache: it is
 * what `loadProgress()` can return before the portal has finished loading, with no
 * flash of an empty menu while that happens.
 */

import { dataModule } from './platform.js';

const KEY = 'nodal.progress.v1';
const memory = new Map();

let backing = null;
function store() {
  if (backing !== null) return backing;
  try {
    const probe = '__nodal_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    backing = localStorage;
  } catch {
    backing = false;
  }
  return backing;
}

/** True when progress will outlive the tab. The UI says so rather than pretending. */
export function isPersistent() {
  return store() !== false || dataModule() !== null;
}

const BLANK = { stars: {}, capstone: null };

function parse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Never trust stored shape: a hand-edited or half-written value must not be
    // able to break the game on load.
    return {
      stars: parsed && typeof parsed.stars === 'object' && parsed.stars ? parsed.stars : {},
      capstone: parsed?.capstone ?? null,
    };
  } catch {
    return null;
  }
}

/** The immediate, synchronous read: local cache only. Never waits on a portal. */
export function loadProgress() {
  const s = store();
  const raw = s ? s.getItem(KEY) : memory.get(KEY);
  return parse(raw) ?? { ...BLANK };
}

export function saveProgress(progress) {
  const raw = JSON.stringify(progress);
  const s = store();
  try {
    if (s) s.setItem(KEY, raw);
    else memory.set(KEY, raw);
  } catch {
    // Quota, or a private window that changed its mind. Keep the session alive.
    memory.set(KEY, raw);
  }
  // Best-effort: the actual save. Never awaited, since a slow or stuck portal must
  // not delay the local write the game already made.
  try {
    dataModule()?.setItem(KEY, raw);
  } catch {
    /* the local write above is what keeps the session alive */
  }
}

/**
 * Reconciles the local cache with the portal's save slot, once the portal is ready.
 *
 * Whichever side has actually recorded progress wins over an empty one, and if both
 * are empty this does nothing. Ties (both non-empty) prefer the portal's copy, since
 * that is the one meant to survive across sessions and devices; the local cache is
 * then overwritten to match so the two cannot silently diverge.
 *
 * Returns the reconciled progress, or null if there was nothing to reconcile.
 */
export function resyncProgress() {
  const remote = dataModule();
  if (!remote) return null;

  let remoteProgress = null;
  try {
    remoteProgress = parse(remote.getItem(KEY));
  } catch {
    return null;
  }
  const localProgress = loadProgress();
  const remoteEmpty = !remoteProgress || Object.keys(remoteProgress.stars).length === 0;
  const localEmpty = Object.keys(localProgress.stars).length === 0;

  if (remoteEmpty && localEmpty) return null;
  const winner = remoteEmpty ? localProgress : remoteProgress;
  saveProgress(winner);
  return winner;
}
