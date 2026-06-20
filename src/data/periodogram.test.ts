import { describe, it, expect } from 'vitest';
import { lombScargle, phaseFold } from './periodogram';

// deterministic pseudo-random so the test never flakes
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('Lomb–Scargle periodogram', () => {
  it('recovers the period of an unevenly-sampled noisy sinusoid', () => {
    const rand = rng(42);
    const P = 2.5; // days
    const t: number[] = [];
    const y: number[] = [];
    // 120 irregular samples over 60 days, with noise — like a survey light curve
    for (let i = 0; i < 120; i++) {
      const ti = 60 * rand();
      t.push(ti);
      y.push(15 + 0.6 * Math.sin((2 * Math.PI * ti) / P) + 0.05 * (rand() - 0.5));
    }
    const res = lombScargle(t, y, { minPeriod: 0.2, maxPeriod: 20 })!;
    expect(res).not.toBeNull();
    // recovered period within 2% of truth
    expect(Math.abs(res.bestPeriodDays - P) / P).toBeLessThan(0.02);
    // a real signal → essentially zero false-alarm probability
    expect(res.fap).toBeLessThan(1e-3);
  });

  it('recovers a short period on a LONG survey baseline (RR Lyrae over 1500 d)', () => {
    // regression for the fixed-grid undersampling bug: 0.329 d signal, ZTF-like 1500-day baseline
    const rand = rng(99);
    const P = 0.329; // days — RR Lyrae
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const ti = 1500 * rand();
      t.push(ti);
      y.push(16 + 0.5 * Math.sin((2 * Math.PI * ti) / P) + 0.05 * (rand() - 0.5));
    }
    const res = lombScargle(t, y, { minPeriod: 0.05, maxPeriod: 50 })!;
    // must land on the true period (within 0.5%), not an alias
    expect(Math.abs(res.bestPeriodDays - P) / P).toBeLessThan(0.005);
    expect(res.fap).toBeLessThan(1e-3);
  });

  it('reports a high false-alarm probability for pure noise', () => {
    const rand = rng(7);
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 80; i++) {
      t.push(60 * rand());
      y.push(15 + (rand() - 0.5)); // white noise, no period
    }
    const res = lombScargle(t, y, { minPeriod: 0.2, maxPeriod: 20 })!;
    expect(res.fap).toBeGreaterThan(0.1); // not significant
  });

  it('returns null when there are too few points', () => {
    expect(lombScargle([1, 2, 3], [1, 2, 3])).toBeNull();
  });

  it('phaseFold maps onto [0,1) with the right phase', () => {
    const ph = phaseFold([0, 1.25, 2.5, 3.75], 2.5, 0);
    expect(ph[0]).toBeCloseTo(0, 6);
    expect(ph[1]).toBeCloseTo(0.5, 6);
    expect(ph[2]).toBeCloseTo(0, 6);
    expect(ph[3]).toBeCloseTo(0.5, 6);
  });
});
