import { describe, it, expect } from 'vitest';
import {
  equatorialToHorizontal,
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

  it('a target at the observer latitude transits near the zenith', () => {
    // an object with Dec = latitude reaches alt ≈ 90° at transit
    const loc = { latDeg: 30, lonDeg: 0 };
    const rts = riseTransitSet(120, 30, loc, T);
    expect(rts.maxAltDeg).toBeCloseTo(90, 6);
    expect(rts.status).toBe('rises');
    // at the computed transit, altitude should equal the max altitude
    const h = equatorialToHorizontal(120, 30, loc, rts.transitMs!);
    expect(h.altDeg).toBeCloseTo(90, 1);
    expect(Math.abs(h.hourAngleDeg)).toBeLessThan(0.5); // ~0 at transit
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

  it('transit altitude matches 90 − |lat − dec| for Greenwich', () => {
    const rts = riseTransitSet(180, 20, greenwich, T);
    expect(rts.maxAltDeg).toBeCloseTo(90 - Math.abs(51.4778 - 20), 6);
  });
});
