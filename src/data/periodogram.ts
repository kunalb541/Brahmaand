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
  // Drop any non-finite samples first — a single NaN time or magnitude would otherwise poison the
  // mean/variance/Min/Max and yield a confidently-wrong "significant" period.
  const tt: number[] = [];
  const yy: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (Number.isFinite(t[i]) && Number.isFinite(y[i])) {
      tt.push(t[i]!);
      yy.push(y[i]!);
    }
  }
  const n = tt.length;
  if (n < 8) return null; // too few points for a meaningful period

  const tmin = Math.min(...tt);
  const tmax = Math.max(...tt);
  const baseline = tmax - tmin;
  if (!Number.isFinite(baseline) || baseline <= 0) return null;

  const minP = opts.minPeriod ?? 0.05; // ~72 min — fastest we bother searching
  const maxP = opts.maxPeriod ?? baseline; // can't constrain periods longer than the baseline
  if (!(minP > 0) || !(maxP > minP)) return null;
  const fMin = 1 / maxP;
  const fMax = 1 / minP;

  const mean = yy.reduce((a, b) => a + b, 0) / n;
  let varSum = 0;
  for (const v of yy) varSum += (v - mean) ** 2;
  const variance = varSum / (n - 1);
  if (!(variance > 0)) return null; // flat (or NaN) — no signal

  // normalised Lomb–Scargle power at one frequency (Press & Rybicki form)
  const lsPower = (f: number): number => {
    const w = 2 * Math.PI * f;
    let s2 = 0, c2 = 0;
    for (let i = 0; i < n; i++) {
      const a = 2 * w * (tt[i]! - tmin);
      s2 += Math.sin(a);
      c2 += Math.cos(a);
    }
    const tau = Math.atan2(s2, c2) / (2 * w);
    let cTerm = 0, cNorm = 0, sTerm = 0, sNorm = 0;
    for (let i = 0; i < n; i++) {
      const arg = w * (tt[i]! - tmin - tau);
      const c = Math.cos(arg);
      const s = Math.sin(arg);
      const dy = yy[i]! - mean;
      cTerm += dy * c;
      cNorm += c * c;
      sTerm += dy * s;
      sNorm += s * s;
    }
    return (0.5 * ((cTerm * cTerm) / (cNorm || 1e-12) + (sTerm * sTerm) / (sNorm || 1e-12))) / variance;
  };

  // Pass 1 — coarse scan across the whole band: localises the peak and gives the plotted periodogram.
  // Grid resolves the ~(fMax−fMin)·baseline independent frequencies (capped for runtime).
  const OVERSAMPLE = 6;
  const needed = Math.ceil(OVERSAMPLE * (fMax - fMin) * baseline);
  const coarse = opts.samples ?? Math.min(120000, Math.max(2000, needed));
  const periods = new Array<number>(coarse);
  const power = new Array<number>(coarse);
  let bestPower = -1;
  let bestFreq = fMin;
  for (let k = 0; k < coarse; k++) {
    const f = fMin + ((fMax - fMin) * k) / (coarse - 1);
    const p = lsPower(f);
    periods[k] = 1 / f;
    power[k] = p;
    if (p > bestPower) {
      bestPower = p;
      bestFreq = f;
    }
  }
  if (bestPower < 0 || !Number.isFinite(bestPower)) return null;

  // Pass 2 — refine around the coarse peak at fine resolution. A capped coarse grid samples the
  // peak's shoulder (underestimating power → wrong period and a deflated FAP); this recovers the apex.
  const df = (fMax - fMin) / (coarse - 1);
  const fLo = Math.max(fMin, bestFreq - 3 * df);
  const fHi = Math.min(fMax, bestFreq + 3 * df);
  const REF = 4000;
  for (let k = 0; k < REF; k++) {
    const f = fLo + ((fHi - fLo) * k) / (REF - 1);
    const p = lsPower(f);
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

/**
 * Off-main-thread Lomb–Scargle: spawns a one-shot module worker so a multi-second long-baseline
 * scan never blocks the render loop / VR frames. Falls back to the synchronous path if Workers
 * aren't available (old webview) or error. Resolves null if the AbortSignal fires first.
 */
export function lombScargleAsync(
  t: number[],
  y: number[],
  opts: { minPeriod?: number; maxPeriod?: number; samples?: number } = {},
  signal?: AbortSignal,
): Promise<LSResult | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./periodogram.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(lombScargle(t, y, opts)); // no Worker support → run inline
      return;
    }
    let settled = false;
    const done = (r: LSResult | null) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => done(null);
    worker.onmessage = (e) => done(e.data as LSResult | null);
    worker.onerror = () => done(lombScargle(t, y, opts)); // worker failed → inline fallback
    if (signal?.aborted) return done(null);
    signal?.addEventListener('abort', onAbort);
    worker.postMessage({ t, y, opts });
  });
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
