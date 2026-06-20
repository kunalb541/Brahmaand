import { describe, it, expect, afterEach } from 'vitest';
import { solarSystemAt, angularSepDeg } from './ephemeris';
import { setObserver } from './observability';

const body = (ms: number, id: string) => solarSystemAt(ms).find((b) => b.id === id)!;

afterEach(() => setObserver(null));

describe('ephemeris — hard external anchors', () => {
  it('reproduces the 2020-12-21 Jupiter–Saturn great conjunction (~6 arcmin)', () => {
    const t = Date.UTC(2020, 11, 21, 18, 0, 0);
    const j = body(t, 'jupiter');
    const s = body(t, 'saturn');
    const sep = angularSepDeg(j.raDeg, j.decDeg, s.raDeg, s.decDeg);
    expect(sep).toBeGreaterThan(0.08); // true value ≈ 0.102° at this instant
    expect(sep).toBeLessThan(0.13); // arcsecond-accurate engine lands right on it
  });

  it('reproduces the 2017-08-21 total solar eclipse (geocentric near-conjunction, new moon)', () => {
    const t = Date.UTC(2017, 7, 21, 18, 26, 0);
    const sun = body(t, 'sun');
    const moon = body(t, 'moon');
    expect(angularSepDeg(sun.raDeg, sun.decDeg, moon.raDeg, moon.decDeg)).toBeLessThan(0.7);
    expect(moon.illum).toBeLessThan(0.02); // new moon
  });

  it('eclipse, topocentric from the totality path → Sun/Moon nearly coincident', () => {
    setObserver({ latDeg: 36.97, lonDeg: -87.5 }); // Hopkinsville, KY — greatest-eclipse region
    const t = Date.UTC(2017, 7, 21, 18, 25, 0);
    const sun = body(t, 'sun');
    const moon = body(t, 'moon');
    expect(moon.topocentric).toBe(true);
    expect(angularSepDeg(sun.raDeg, sun.decDeg, moon.raDeg, moon.decDeg)).toBeLessThan(0.25);
  });

  it('half a synodic month after the eclipse the Moon is full', () => {
    const t = Date.UTC(2017, 7, 21, 18, 26, 0) + 14.765 * 86400000;
    expect(body(t, 'moon').illum).toBeGreaterThan(0.97);
  });
});

describe('ephemeris — physical invariants', () => {
  const start = Date.UTC(2026, 0, 1);

  it('Sun near +23.4° dec at the June solstice; angular diameter ~0.53°', () => {
    const s = body(Date.UTC(2026, 5, 21, 12, 0, 0), 'sun');
    expect(s.decDeg).toBeGreaterThan(23.2);
    expect(s.angDiamDeg).toBeGreaterThan(0.51);
    expect(s.angDiamDeg).toBeLessThan(0.55);
  });

  it('Moon stays in physical distance/declination bounds over a month (geocentric)', () => {
    for (let i = 0; i < 30; i++) {
      const m = body(start + i * 86400000, 'moon');
      expect(m.distKm).toBeGreaterThan(350000);
      expect(m.distKm).toBeLessThan(411000);
      expect(Math.abs(m.decDeg)).toBeLessThan(29.6); // ≤ ε + lunar inclination
      expect(m.illum).toBeGreaterThanOrEqual(0);
      expect(m.illum).toBeLessThanOrEqual(1);
    }
  });

  it('Mercury & Venus respect maximum-elongation limits (scan 20 months)', () => {
    let maxV = 0, maxM = 0;
    for (let i = 0; i < 600; i += 2) {
      const t = start + i * 86400000;
      const sun = body(t, 'sun');
      const v = body(t, 'venus');
      const me = body(t, 'mercury');
      maxV = Math.max(maxV, angularSepDeg(sun.raDeg, sun.decDeg, v.raDeg, v.decDeg));
      maxM = Math.max(maxM, angularSepDeg(sun.raDeg, sun.decDeg, me.raDeg, me.decDeg));
    }
    expect(maxV).toBeGreaterThan(44); // a greatest elongation occurs in any 584-day window
    expect(maxV).toBeLessThan(48.5); // physical limit ≈ 47.8°
    expect(maxM).toBeGreaterThan(17);
    expect(maxM).toBeLessThan(28.6); // physical limit ≈ 28.3°
  });

  it('planet brightnesses are in sane ranges', () => {
    const t = start;
    const v = body(t, 'venus');
    const j = body(t, 'jupiter');
    expect(v.magV!).toBeLessThan(-3.5); // Venus always brighter than −3.5
    expect(j.magV!).toBeLessThan(-1.5); // Jupiter always brighter than −1.5
    expect(body(t, 'neptune').magV!).toBeGreaterThan(7); // Neptune never naked-eye
  });
});
