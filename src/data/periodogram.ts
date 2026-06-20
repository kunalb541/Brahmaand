/**
 * Lomb–Scargle periodogram — the standard tool for finding periods in UNEVENLY-sampled time
 * series, which is exactly what survey light curves (ZTF, Rubin/LSST, ATLAS…) are. This is the
 * workhorse of time-domain research: variable-star classification, eclipsing binaries, RR Lyrae /
 * Cepheid period–luminosity work, rotation periods, etc.
 *
 * Implementation follows Press & Rybicki / Horne & Baliunas (the classic normalised form). Pure,
 * dependency-free, unit-tested against a synthetic sinusoid. No backend — runs in the browser on
 * the photometry already fetched from the broker.
 */

export interface LSResult {
  periods: number[]; // days, ascending in frequency (so descending here is fine for plotting)
  power: number[]; // normalised Lomb–Scargle power at each period
  bestPeriodDays: number;
  bestPower: number;
  /** Horne–Baliunas false-alarm probability of the peak (≈0 = highly significant). */
  fap: number;
  nPoints: number;
}

/**
 * @param t  observation times (days, e.g. MJD)
 * @param y  measurements (e.g. magnitudes)
 */
export function lombScargle(
  t: number[],
  y: number[],
  opts: { minPeriod?: number; maxPeriod?: number; samples?: number } = {},
): LSResult | null {
  const n = t.length;
  if (n < 8) return null; // too few points for a meaningful period

  const tmin = Math.min(...t);
  const tmax = Math.max(...t);
  const baseline = tmax - tmin;
  if (baseline <= 0) return null;

  const minP = opts.minPeriod ?? 0.05; // ~72 min — fastest we bother searching
  const maxP = opts.maxPeriod ?? baseline; // can't constrain periods longer than the baseline
  const fMin = 1 / maxP;
  const fMax = 1 / minP;
  // CRITICAL: the grid must resolve the peak width (≈1/baseline), i.e. sample each of the
  // ~(fMax−fMin)·baseline independent frequencies several times. A fixed grid silently misses
  // the true peak on long survey baselines (e.g. a 0.33 d RR Lyrae over 1500 d → wrong period).
  const OVERSAMPLE = 6;
  const needed = Math.ceil(OVERSAMPLE * (fMax - fMin) * baseline);
  const samples = opts.samples ?? Math.min(120000, Math.max(2000, needed));

  const mean = y.reduce((a, b) => a + b, 0) / n;
  let varSum = 0;
  for (const v of y) varSum += (v - mean) ** 2;
  const variance = varSum / (n - 1);
  if (variance === 0) return null; // flat — no signal

  const periods = new Array<number>(samples);
  const power = new Array<number>(samples);
  let bestPower = -1;
  let bestFreq = fMin;

  for (let k = 0; k < samples; k++) {
    const f = fMin + ((fMax - fMin) * k) / (samples - 1);
    const w = 2 * Math.PI * f;
    // time offset τ that makes the sine/cosine sums orthogonal
    let s2 = 0, c2 = 0;
    for (let i = 0; i < n; i++) {
      const a = 2 * w * (t[i]! - tmin);
      s2 += Math.sin(a);
      c2 += Math.cos(a);
    }
    const tau = Math.atan2(s2, c2) / (2 * w);
    let cTerm = 0, cNorm = 0, sTerm = 0, sNorm = 0;
    for (let i = 0; i < n; i++) {
      const arg = w * (t[i]! - tmin - tau);
      const c = Math.cos(arg);
      const s = Math.sin(arg);
      const dy = y[i]! - mean;
      cTerm += dy * c;
      cNorm += c * c;
      sTerm += dy * s;
      sNorm += s * s;
    }
    const p =
      (0.5 *
        ((cTerm * cTerm) / (cNorm || 1e-12) + (sTerm * sTerm) / (sNorm || 1e-12))) /
      variance;
    periods[k] = 1 / f;
    power[k] = p;
    if (p > bestPower) {
      bestPower = p;
      bestFreq = f;
    }
  }

  // Horne–Baliunas: M ≈ number of independent frequencies over the searched band
  const M = Math.max(1, Math.round((fMax - fMin) * baseline));
  const fap = 1 - Math.pow(1 - Math.exp(-bestPower), M);

  return { periods, power, bestPeriodDays: 1 / bestFreq, bestPower, fap, nPoints: n };
}

/** Fold times onto a period → phase in [0,1). */
export function phaseFold(t: number[], period: number, t0?: number): number[] {
  const ref = t0 ?? Math.min(...t);
  return t.map((ti) => {
    let ph = ((ti - ref) / period) % 1;
    if (ph < 0) ph += 1;
    return ph;
  });
}
