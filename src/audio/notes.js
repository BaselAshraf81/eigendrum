/**
 * Turning frequencies into things a musician can read, and measuring how
 * un-musical a drum's overtones are.
 */

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Nearest equal-tempered note to a frequency, plus the error in cents. */
export function freqToNote(freq, a4 = 440) {
  if (!(freq > 0)) return { name: '-', octave: 0, cents: 0, label: '-' };
  const midiExact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiExact);
  const cents = Math.round((midiExact - midi) * 100);
  const name = NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const sign = cents > 0 ? '+' : '';
  return {
    name,
    octave,
    cents,
    label: `${name}${octave}${cents === 0 ? '' : ` ${sign}${cents}\u00A2`}`,
  };
}

/**
 * How close the overtone ratios are to small whole numbers.
 *
 * A plucked string is (nearly) harmonic: its overtones sit at 2x, 3x, 4x the
 * fundamental, which is why it has a definite pitch. A drum is not: its ratios
 * are irrational, which is why a drum sounds like a thud rather than a note.
 * Returns a mean absolute deviation, in cents, from the nearest harmonic.
 */
export function harmonicity(freqs) {
  if (freqs.length < 2) return { centsOff: 0, verdict: 'single mode' };
  const f0 = freqs[0];
  let total = 0;
  let n = 0;
  for (let k = 1; k < freqs.length; k++) {
    const ratio = freqs[k] / f0;
    const nearest = Math.max(1, Math.round(ratio));
    total += Math.abs(1200 * Math.log2(ratio / nearest));
    n++;
  }
  const centsOff = total / n;
  const verdict =
    centsOff < 15
      ? 'almost harmonic — this shape has a real pitch'
      : centsOff < 60
        ? 'partly harmonic'
        : 'inharmonic — a thud rather than a note';
  return { centsOff, verdict };
}

/** Overtone ratios relative to the fundamental. */
export function ratios(freqs) {
  if (!freqs.length) return [];
  return Array.from(freqs, (f) => f / freqs[0]);
}
