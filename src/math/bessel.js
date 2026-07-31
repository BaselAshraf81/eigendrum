/**
 * Bessel functions of the first kind and their zeros.
 *
 * These exist for one reason: the circular drum has a closed-form spectrum. The
 * eigenvalues of the unit disk are exactly the squared zeros of J_m, so the
 * disk is the sharpest available test of whether the finite element solver is
 * telling the truth about curved boundaries.
 *
 * J0/J1 use the classic minimax rational approximations (accurate to roughly
 * 1e-8, far tighter than our discretisation error); higher orders use the
 * standard stable recurrence, upward when x > n and downward with
 * renormalisation otherwise.
 */

export function besselJ0(x) {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const p1 =
      57568490574.0 +
      y *
        (-13362590354.0 +
          y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    const p2 =
      57568490411.0 +
      y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
    return p1 / p2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 0.785398164;
  const p1 =
    1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const p2 =
    -0.1562499995e-1 +
    y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * -0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
}

export function besselJ1(x) {
  const ax = Math.abs(x);
  let ans;
  if (ax < 8) {
    const y = x * x;
    const p1 =
      x *
      (72362614232.0 +
        y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const p2 =
      144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return p1 / p2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 2.356194491;
  const p1 =
    1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const p2 =
    0.04687499995 +
    y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
  return x < 0 ? -ans : ans;
}

/** J_n(x) for integer n >= 0. */
export function besselJ(n, x) {
  if (n < 0) throw new RangeError('besselJ expects n >= 0');
  if (n === 0) return besselJ0(x);
  if (n === 1) return besselJ1(x);
  if (x < 0) return (n % 2 === 0 ? 1 : -1) * besselJ(n, -x);
  if (x === 0) return 0;

  const ax = Math.abs(x);
  const tox = 2 / ax;

  if (ax > n) {
    // Upward recurrence is stable in this regime.
    let bjm = besselJ0(ax);
    let bj = besselJ1(ax);
    for (let j = 1; j < n; j++) {
      const bjp = j * tox * bj - bjm;
      bjm = bj;
      bj = bjp;
    }
    return bj;
  }

  // Miller's downward recurrence with renormalisation.
  const ACC = 160;
  const BIGNO = 1e10;
  const BIGNI = 1e-10;
  const m = 2 * Math.floor((n + Math.floor(Math.sqrt(ACC * n))) / 2);
  let jsum = false;
  let sum = 0;
  let bjp = 0;
  let bj = 1;
  let ans = 0;
  for (let j = m; j > 0; j--) {
    const bjm = j * tox * bj - bjp;
    bjp = bj;
    bj = bjm;
    if (Math.abs(bj) > BIGNO) {
      bj *= BIGNI;
      bjp *= BIGNI;
      ans *= BIGNI;
      sum *= BIGNI;
    }
    if (jsum) sum += bj;
    jsum = !jsum;
    if (j === n) ans = bjp;
  }
  sum = 2 * sum - bj;
  return ans / sum;
}

/** d/dx J_n(x), via the standard identity. */
export function besselJPrime(n, x) {
  if (n === 0) return -besselJ1(x);
  return (besselJ(n - 1, x) - besselJ(n + 1, x)) / 2;
}

const zeroCache = new Map();

/**
 * The first `count` positive zeros of J_m, ascending.
 *
 * Deliberately found by scanning for sign changes and then bisecting, rather
 * than by Newton from an asymptotic guess. Newton is a trap here: for high
 * orders J_m is astronomically small near the origin (J_30(0.1) is about
 * 1e-70), so a Newton step that overshoots towards zero lands somewhere that
 * *looks* like a root to any residual test. Scanning cannot make that mistake.
 *
 * Consecutive zeros of J_m are more than pi apart, so a step of 0.05 cannot skip
 * a pair. All positive zeros satisfy j_{m,1} > m, which bounds where to start.
 */
export function besselJZeros(m, count) {
  const cached = zeroCache.get(m);
  if (cached && cached.length >= count) return cached.slice(0, count);

  const found = [];
  const step = 0.05;
  let x = m === 0 ? 1e-6 : 0.9 * m;
  let fPrev = besselJ(m, x);

  while (found.length < count && x < 5000) {
    const xNext = x + step;
    const fNext = besselJ(m, xNext);
    if (fPrev === 0) {
      found.push(x);
    } else if (fPrev * fNext < 0) {
      let lo = x;
      let hi = xNext;
      let flo = fPrev;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        const fmid = besselJ(m, mid);
        if (fmid === 0) {
          lo = mid;
          hi = mid;
          break;
        }
        if (flo * fmid < 0) hi = mid;
        else {
          lo = mid;
          flo = fmid;
        }
      }
      found.push((lo + hi) / 2);
    }
    x = xNext;
    fPrev = fNext;
  }

  zeroCache.set(m, found);
  return found.slice(0, count);
}

/** The k-th positive zero of J_m (k starting at 1). */
export function besselJZero(m, k) {
  if (k < 1) throw new RangeError('besselJZero expects k >= 1');
  return besselJZeros(m, k)[k - 1];
}
