/**
 * Progress storage that cannot throw.
 *
 * Incognito mode restricts localStorage, and Poki requires games to stay playable
 * there, so every access is guarded and falls back to memory for the session. A
 * player in a private window loses their progress when they close the tab, which
 * is the correct trade: the alternative is a game that refuses to start.
 */

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
  return store() !== false;
}

const BLANK = { stars: {}, capstone: null };

export function loadProgress() {
  const s = store();
  try {
    const raw = s ? s.getItem(KEY) : memory.get(KEY);
    if (!raw) return { ...BLANK };
    const parsed = JSON.parse(raw);
    // Never trust stored shape: a hand-edited or half-written value must not be
    // able to break the game on load.
    return {
      stars: parsed && typeof parsed.stars === 'object' && parsed.stars ? parsed.stars : {},
      capstone: parsed?.capstone ?? null,
    };
  } catch {
    return { ...BLANK };
  }
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
}
