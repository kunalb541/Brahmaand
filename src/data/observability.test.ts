import { describe, it, expect } from 'vitest';
import {
  equatorialToHorizontal,
  horizontalToEquatorial,
  airmass,
  riseTransitSet,
  lstDeg,
  sunRaDec,
} from './observability';

// 2026-06-13 00:00 UTC
const T = Date.UTC(2026, 5, 13, 0, 0, 0);
const greenwich = { latDeg: 51.4778, lonDeg: 0 };

describe('observability', () => {
  it('airmass is 1 at zenith and grows toward the horizon', () => {
    expect(airmass(90)).toBeCloseTo(1.0, 3);
    expect(airmass(30)).toBeGreaterThan(1.9); // sec(60°)=2, KY slightly less
    expect(airmass(30)).toBeLessThan(2.1);
    expect(airmass(0)).toBe(Infinity);
  });

  it('a target at the observer latitude transits near the zenith (of-date self-consistent)', () => {
    // a J2000 object with Dec = latitude transits near (not exactly) the zenith — precession shifts
    // its apparent dec by ~arcmin between J2000 and now, which the frame reconciliation applies.
    const loc = { latDeg: 30, lonDeg: 0 };
    const rts = riseTransitSet(120, 30, loc, T);
    expect(rts.status).toBe('rises');
    expect(rts.maxAltDeg).toBeGreaterThan(89.6);
    expect(rts.maxAltDeg).toBeLessThanOrEqual(90);
    // self-consistency invariant: the computed transit altitude equals maxAltDeg (both of-date)
    const h = equatorialToHorizontal(120, 30, loc, rts.transitMs!);
    expect(h.altDeg).toBeCloseTo(rts.maxAltDeg, 2);
    expect(Math.abs(h.hourAngleDeg)).toBeLessThan(0.5); // ~0 at transit
  });

  it('J2000 ⇄ alt/az round-trips (EQJ→EQD and EQD→EQJ rotations cancel)', () => {
    const loc = { latDeg: 19.07, lonDeg: 72.87 };
    const ra0 = 83.6, dec0 = 22.0; // J2000
    const h = equatorialToHorizontal(ra0, dec0, loc, T);
    const back = horizontalToEquatorial(h.altDeg, h.azDeg, loc, T);
    expect(back.decDeg).toBeCloseTo(dec0, 4);
    const dRa = ((back.raDeg - ra0 + 540) % 360) - 180;
    expect(Math.abs(dRa)).toBeLessThan(2e-3);
  });

  it('marks circumpolar and never-rising targets', () => {
    const loc = { latDeg: 70, lonDeg: 0 };
    expect(riseTransitSet(0, 80, loc, T).status).toBe('circumpolar'); // high north
    expect(riseTransitSet(0, -80, loc, T).status).toBe('never'); // deep south, unseen from +70
  });

  it('LST advances ~360.99°/day (sidereal)', () => {
    const a = lstDeg(T, 0);
    const b = lstDeg(T + 86400000, 0);
    let d = ((b - a) % 360 + 360) % 360;
    expect(d).toBeCloseTo(0.9856 * 1, 1); // ~0.9856° more than a full turn
  });

  it('Sun sits near the summer-solstice declination in mid-June', () => {
    const s = sunRaDec(T);
    expect(s.decDeg).toBeGreaterThan(22.5); // ~+23.3° near solstice
    expect(s.decDeg).toBeLessThan(23.6);
  });

  it('transit altitude ≈ 90 − |lat − dec| (within precession) and is self-consistent', () => {
    const rts = riseTransitSet(180, 20, greenwich, T);
    const naive = 90 - Math.abs(51.4778 - 20); // J2000 approximation (58.5222)
    expect(rts.maxAltDeg).toBeGreaterThan(naive - 0.3); // of-date precession ≲ 0.2°
    expect(rts.maxAltDeg).toBeLessThan(naive + 0.3);
    const h = equatorialToHorizontal(180, 20, greenwich, rts.transitMs!);
    expect(h.altDeg).toBeCloseTo(rts.maxAltDeg, 2); // both of-date → match tightly
  });
});
