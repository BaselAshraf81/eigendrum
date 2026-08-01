/**
 * The mode index: one numbered row per computed mode.
 *
 * The bar length is the frequency as a fraction of the highest one, not a
 * normalised range, so the spacing of the spectrum is legible at a glance —
 * you can see the overtones bunching up, which is the whole character of a drum.
 * Rows are real buttons so the index is keyboard navigable.
 */

import { freqToNote } from '../audio/notes.js';

export function renderSpectrum(container, freqs, selectedIndex, onSelect) {
  container.textContent = '';
  if (!freqs || !freqs.length) return;
  const top = freqs[freqs.length - 1] || 1;

  freqs.forEach((f, i) => {
    const note = freqToNote(f);
    const li = document.createElement('li');

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mode-row';
    row.setAttribute('aria-pressed', String(i === selectedIndex));
    row.setAttribute(
      'aria-label',
      `mode ${i + 1}, ${f.toFixed(1)} hertz, nearest note ${note.name}${note.octave}`,
    );
    row.title = `${f.toFixed(1)} Hz · ${note.label}`;

    const n = document.createElement('span');
    n.className = 'mode-n';
    n.textContent = String(i + 1).padStart(2, '0');

    const bar = document.createElement('span');
    bar.className = 'mode-bar';
    bar.style.width = `${Math.max(4, (f / top) * 100).toFixed(1)}%`;

    const hz = document.createElement('span');
    hz.className = 'mode-hz';
    hz.textContent = f.toFixed(1);

    row.append(n, bar, hz);
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
