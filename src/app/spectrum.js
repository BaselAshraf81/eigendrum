/**
 * Two views of the same spectrum.
 *
 * The index lists every computed mode with its frequency and its ratio to the
 * fundamental, because the ratio is the number that actually characterises a
 * drum: 2, 3, 4 would be a string, and these are not. Each row is playable — it
 * sounds that one mode on its own, which is something no mallet can do.
 *
 * The comb puts them on a log-frequency axis. A bar measured from zero looks like
 * information but is not — at these frequencies eight consecutive modes differ by
 * a few percent of their length — whereas position on a log axis shows the
 * overtones crowding together as they climb, which is the character of the sound.
 *
 * Both views take an optional `drive`: how hard each mode was actually excited by
 * the last strike, normalised to the loudest. That is the quantity that connects
 * the two ideas in this app — a strike is not one mode, it is this mixture — so it
 * is drawn as a rule under each row and as tick height on the comb.
 */

import { freqToNote } from '../audio/notes.js';

export function renderSpectrum(container, freqs, selectedIndex, onSelect) {
  container.textContent = '';
  if (!freqs || !freqs.length) return;
  const f0 = freqs[0];

  freqs.forEach((f, i) => {
    const note = freqToNote(f);
    const li = document.createElement('li');

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mode-row';
    row.setAttribute('aria-pressed', String(i === selectedIndex));
    row.setAttribute(
      'aria-label',
      `play mode ${i + 1} alone, ${f.toFixed(1)} hertz, ` +
        `${(f / f0).toFixed(3)} times the lowest mode, nearest note ${note.name}${note.octave}`,
    );
    row.title = `Play mode ${i + 1} alone · ${f.toFixed(1)} Hz · ${note.label}`;

    const n = document.createElement('span');
    n.className = 'mode-n';
    n.textContent = String(i + 1).padStart(2, '0');

    const ratio = document.createElement('span');
    ratio.className = 'mode-ratio';
    ratio.textContent = `\u00D7${(f / f0).toFixed(3)}`;

    const hz = document.createElement('span');
    hz.className = 'mode-hz';
    hz.textContent = f.toFixed(1);

    // How hard the current sound drives this mode. Empty until something rings.
    const drive = document.createElement('span');
    drive.className = 'mode-drive';
    drive.style.transform = 'scaleX(0)';

    // Field first: it is absolutely positioned, so it takes no grid cell, and the
    // numbers that follow it paint on top.
    row.append(drive, n, ratio, hz);
    row.addEventListener('click', () => onSelect(i));
    li.append(row);
    container.append(li);
  });
}

export function setSelected(container, index) {
  [...container.querySelectorAll('.mode-row')].forEach((row, i) => {
    row.setAttribute('aria-pressed', String(i === index));
  });
}

/**
 * Updates the excitation rules in place, without rebuilding the list, so the
 * column does not lose its scroll position every time the drum is hit.
 */
export function setDrive(container, drive) {
  [...container.querySelectorAll('.mode-row')].forEach((row, i) => {
    const bar = row.querySelector('.mode-drive');
    if (!bar) return;
    const v = drive && drive[i] != null ? Math.max(0, Math.min(1, drive[i])) : 0;
    // A mode the strike could not reach is the interesting case, so it gets an
    // explicit stub: a measured zero should not look like missing data.
    const mute = Boolean(drive) && v < 0.04;
    bar.style.transform = `scaleX(${v.toFixed(4)})`;
    row.classList.toggle('is-mute', mute);

    const base = row.dataset.label || (row.dataset.label = row.title);
    row.title = mute ? `${base} \u00B7 silent in the last strike (nodal line)` : base;
  });
}

/**
 * @param {{axis: HTMLElement, lo: HTMLElement, hi: HTMLElement, caption: HTMLElement}} els
 * @param {number[]} freqs
 * @param {number} selectedIndex  -1 for none
 * @param {number[]|null} partner another drum's spectrum, drawn above the axis
 * @param {number[]|null} drive   per-mode excitation, scaling tick height
 */
export function renderComb(els, freqs, selectedIndex, partner = null, drive = null) {
  els.axis.textContent = '';
  if (!freqs || freqs.length < 2) {
    els.lo.textContent = '';
    els.hi.textContent = '';
    return;
  }

  const all = partner && partner.length ? freqs.concat(partner) : freqs;
  const low = Math.min(...all);
  const high = Math.max(...all);
  const a = Math.log2(low * 0.97);
  const b = Math.log2(high * 1.03);
  const span = b - a || 1;
  const pos = (f) => ((Math.log2(f) - a) / span) * 100;

  const tick = (f, cls, height = null) => {
    const t = document.createElement('span');
    t.className = cls ? `comb-tick ${cls}` : 'comb-tick';
    t.style.left = `${pos(f).toFixed(3)}%`;
    if (height !== null) t.style.height = `${height.toFixed(2)}rem`;
    els.axis.append(t);
  };

  if (partner && partner.length) for (const f of partner) tick(f, 'is-partner');
  freqs.forEach((f, i) => {
    // While something is ringing the comb becomes an amplitude spectrum: tick
    // height is how much of this sound that mode is actually contributing.
    const h = drive ? 0.12 + 1.15 * Math.max(0, Math.min(1, drive[i] || 0)) : null;
    tick(f, i === selectedIndex ? 'is-selected' : '', h);
  });

  els.lo.textContent = `${low.toFixed(0)} hz`;
  els.hi.textContent = `${high.toFixed(0)} hz`;
  els.caption.textContent = drive
    ? 'how much of this sound each mode is'
    : partner && partner.length
      ? 'where the overtones fall \u2014 the other drum above the line'
      : 'where the overtones fall';
}
