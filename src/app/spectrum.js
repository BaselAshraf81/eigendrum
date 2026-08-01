/**
 * Two views of the same spectrum.
 *
 * The index lists every computed mode with its frequency and its ratio to the
 * fundamental, because the ratio is the number that actually characterises a
 * drum: 2, 3, 4 would be a string, and these are not.
 *
 * The comb puts them on a log-frequency axis. A bar measured from zero looks like
 * information but is not — at these frequencies eight consecutive modes differ by
 * a few percent of their length — whereas position on a log axis shows the
 * overtones crowding together as they climb, which is the character of the sound.
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
      `mode ${i + 1}, ${f.toFixed(1)} hertz, ${(f / f0).toFixed(3)} times the lowest mode, ` +
        `nearest note ${note.name}${note.octave}`,
    );
    row.title = `${f.toFixed(1)} Hz · ${note.label}`;

    const n = document.createElement('span');
    n.className = 'mode-n';
    n.textContent = String(i + 1).padStart(2, '0');

    const ratio = document.createElement('span');
    ratio.className = 'mode-ratio';
    ratio.textContent = `\u00D7${(f / f0).toFixed(3)}`;

    const hz = document.createElement('span');
    hz.className = 'mode-hz';
    hz.textContent = f.toFixed(1);

    row.append(n, ratio, hz);
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
 * @param {{axis: HTMLElement, lo: HTMLElement, hi: HTMLElement, caption: HTMLElement}} els
 * @param {number[]} freqs
 * @param {number} selectedIndex  -1 for none
 * @param {number[]|null} partner another drum's spectrum, drawn above the axis
 */
export function renderComb(els, freqs, selectedIndex, partner = null) {
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

  const tick = (f, cls) => {
    const t = document.createElement('span');
    t.className = cls ? `comb-tick ${cls}` : 'comb-tick';
    t.style.left = `${pos(f).toFixed(3)}%`;
    els.axis.append(t);
  };

  if (partner && partner.length) for (const f of partner) tick(f, 'is-partner');
  freqs.forEach((f, i) => tick(f, i === selectedIndex ? 'is-selected' : ''));

  els.lo.textContent = `${low.toFixed(0)} hz`;
  els.hi.textContent = `${high.toFixed(0)} hz`;
  els.caption.textContent =
    partner && partner.length
      ? 'where the overtones fall \u2014 the other drum above the line'
      : 'where the overtones fall';
}
