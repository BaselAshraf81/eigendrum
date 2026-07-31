/**
 * The mode list: one row per computed mode, showing its frequency, the nearest
 * note, and a bar scaled by frequency. Rows are real buttons so the whole
 * spectrum is keyboard navigable.
 */

import { freqToNote } from '../audio/notes.js';

export function renderSpectrum(container, freqs, selectedIndex, onSelect) {
  container.textContent = '';
  if (!freqs || !freqs.length) return;

  const max = freqs[freqs.length - 1] || 1;
  const min = freqs[0] || 1;

  freqs.forEach((f, i) => {
    const note = freqToNote(f);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mode-row';
    row.setAttribute('aria-pressed', String(i === selectedIndex));
    row.setAttribute(
      'aria-label',
      `Mode ${i + 1}, ${f.toFixed(1)} hertz, nearest note ${note.name}${note.octave}`,
    );

    const idx = document.createElement('span');
    idx.className = 'mode-index';
    idx.textContent = String(i + 1);

    const bar = document.createElement('span');
    bar.className = 'mode-bar';
    const fill = document.createElement('span');
    // Scale against the fundamental so the first bar is always visible.
    const frac = max > min ? (f - min) / (max - min) : 0;
    fill.style.width = `${(12 + 88 * frac).toFixed(1)}%`;
    bar.appendChild(fill);

    const freq = document.createElement('span');
    freq.className = 'mode-freq';
    freq.textContent = `${f.toFixed(1)} Hz`;

    row.append(idx, bar, freq);
    row.addEventListener('click', () => onSelect(i));
    container.appendChild(row);
  });
}

export function setSelected(container, index) {
  [...container.children].forEach((row, i) => {
    row.setAttribute('aria-pressed', String(i === index));
  });
}
