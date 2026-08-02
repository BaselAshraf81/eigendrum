/**
 * The measurement strip and the chapter rule.
 *
 * The strip is the game's honest channel: it says what every mode did, in numbers
 * and in field length, so nothing about a level requires hearing it. That is a
 * requirement rather than a nicety, since a web game is played muted more often
 * than not, and an audio-only puzzle would simply exclude a large part of the
 * audience.
 */

const MODE_COUNT = 12;

export function buildStrip(container) {
  container.replaceChildren(
    ...Array.from({ length: MODE_COUNT }, (_, k) => {
      const li = document.createElement('li');
      li.className = 'cell';

      const fill = document.createElement('span');
      fill.className = 'cell-fill';
      fill.style.transform = 'scaleX(0)';

      const n = document.createElement('span');
      n.className = 'cell-n';
      n.textContent = String(k + 1).padStart(2, '0');

      const v = document.createElement('span');
      v.className = 'cell-v';
      v.textContent = '-';

      li.append(fill, n, v);
      return li;
    }),
  );
}

/**
 * Paints one strike onto the strip.
 *
 * `targets` are the modes the level is about; they get the chrome field, because
 * chrome yellow means "the thing you are being asked about" everywhere else in
 * this world too. `quiet` is a measured fact, so it gets a full-ink stub rather
 * than dimmed text: a zero is a result and should not look like missing data.
 */
export function paintStrip(container, amps, targets = [], peak = 0) {
  const cells = container.children;
  const top = peak || Math.max(...Array.from(amps, Math.abs), 1e-12);
  const wanted = new Set(targets);

  for (let k = 0; k < cells.length; k++) {
    const cell = cells[k];
    const a = k < amps.length ? Math.abs(amps[k]) / top : 0;
    // The same threshold the silence objectives score three stars at, so a cell
    // labelled "silent" means what the game means by silent. At 0.04 a mode could be
    // called silent while only earning one mark for it.
    const quiet = a < 0.02;
    cell.classList.toggle('is-target', wanted.has(k));
    cell.classList.toggle('is-quiet', quiet && amps.length > 0);
    cell.querySelector('.cell-fill').style.transform = `scaleX(${a.toFixed(4)})`;
    cell.querySelector('.cell-v').textContent = amps.length
      ? quiet
        ? 'silent'
        : `${(a * 100).toFixed(0)}%`
      : '-';
  }
}

export function clearStrip(container, targets = []) {
  paintStrip(container, [], targets, 0);
}

/** One mark per level in the chapter, filled by best stars earned. */
export function buildProgress(container, count, starsFor) {
  container.replaceChildren(
    ...Array.from({ length: count }, (_, i) => {
      const li = document.createElement('li');
      li.className = 'pip';
      const stars = starsFor(i);
      if (stars > 0) li.classList.add('is-done');
      li.dataset.stars = String(stars);
      li.setAttribute(
        'aria-label',
        stars > 0 ? `Level ${i + 1}: ${stars} of 3` : `Level ${i + 1}: not yet`,
      );
      return li;
    }),
  );
}

export function markCurrent(container, index) {
  const kids = container.children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('is-here', i === index);
}

/** Three squares. Filled means earned. Text carries it too, for screen readers. */
export function starMarks(stars) {
  const wrap = document.createElement('span');
  wrap.className = 'stars';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    s.className = i < stars ? 'star is-on' : 'star';
    wrap.append(s);
  }
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = `${stars} of 3`;
  wrap.append(label);
  return wrap;
}
