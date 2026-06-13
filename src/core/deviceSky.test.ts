import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { deviceLookEnu, enuToSkyDir } from './deviceSky';
import { raDecToWorld, worldToRaDec } from '../math/frames';

const DEG = Math.PI / 180;
const out = new THREE.Vector3();
const tmp = new THREE.Vector3();

// Observer: lat +19°, LST = 80° (arbitrary but fixed). Absolute (sky-registered) mode.
const LAT = 19 * DEG;
const LST = 80 * DEG;

/** World direction for horizon (alt,az N→E) at the test observer — independent reference impl. */
function refAltAzWorld(altDeg: number, azDeg: number): THREE.Vector3 {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const sinDec = Math.sin(LAT) * Math.sin(alt) + Math.cos(LAT) * Math.cos(alt) * Math.cos(az);
  const dec = Math.asin(THREE.MathUtils.clamp(sinDec, -1, 1));
  const sinH = (-Math.sin(az) * Math.cos(alt)) / Math.cos(dec);
  const cosH = (Math.sin(alt) - Math.sin(LAT) * sinDec) / (Math.cos(LAT) * Math.cos(dec));
  const ra = LST - Math.atan2(sinH, cosH);
  return raDecToWorld(ra, dec, new THREE.Vector3());
}

/** A look vector at altitude `alt`, azimuth `az` (deg), as horizon ENU. */
function enuAt(altDeg: number, azDeg: number): { E: number; N: number; U: number } {
  const a = altDeg * DEG;
  const z = azDeg * DEG;
  return { E: Math.sin(z) * Math.cos(a), N: Math.cos(z) * Math.cos(a), U: Math.sin(a) };
}

describe('deviceSky — sky registration (singularity-free)', () => {
  it('maps the zenith to (RA=LST, Dec=lat) — exactly', () => {
    enuToSkyDir(0, 0, 1, 0, 0, LAT, LST, out);
    const rd = { raRad: 0, decRad: 0 };
    worldToRaDec(out, rd);
    expect(rd.raRad).toBeCloseTo(LST, 5);
    expect(rd.decRad).toBeCloseTo(LAT, 5);
  });

  it('matches an independent alt/az→world reference across the whole sky', () => {
    for (let alt = 5; alt <= 85; alt += 20) {
      for (let az = 0; az < 360; az += 30) {
        const { E, N, U } = enuAt(alt, az);
        enuToSkyDir(E, N, U, 0, 0, LAT, LST, out);
        const ref = refAltAzWorld(alt, az);
        expect(out.angleTo(ref) * (180 / Math.PI)).toBeLessThan(0.01); // < 0.01° everywhere
      }
    }
  });

  it('TRACKS CONTINUOUSLY while moving — a full 360° pan has no spin/jump', () => {
    // sweep azimuth 0→360 at a fixed altitude; each 2° device step must move the view ~2°,
    // never a sudden jump (a spin would show up as a large angular delta between steps).
    let prev: THREE.Vector3 | null = null;
    let maxStep = 0;
    for (let az = 0; az <= 360; az += 2) {
      const { E, N, U } = enuAt(40, az);
      enuToSkyDir(E, N, U, 0, 0, LAT, LST, tmp);
      if (prev) maxStep = Math.max(maxStep, prev.angleTo(tmp) * (180 / Math.PI));
      prev = tmp.clone();
    }
    expect(maxStep).toBeLessThan(3); // ~2° input → ~2° output, never a spin
  });

  it('TRACKS CONTINUOUSLY through the ZENITH — the old spin case', () => {
    // tilt from the north horizon up over the zenith and down to the south horizon (alt 0→90→0
    // while azimuth flips N→S at the top). The old az/alt code spun here; this must stay smooth.
    let prev: THREE.Vector3 | null = null;
    let maxStep = 0;
    const path: [number, number][] = [];
    for (let alt = 2; alt <= 90; alt += 2) path.push([alt, 0]); // up the north meridian to zenith
    for (let alt = 90; alt >= 2; alt -= 2) path.push([alt, 180]); // through zenith, down the south
    for (const [alt, az] of path) {
      const { E, N, U } = enuAt(alt, az);
      enuToSkyDir(E, N, U, 0, 0, LAT, LST, tmp);
      if (prev) maxStep = Math.max(maxStep, prev.angleTo(tmp) * (180 / Math.PI));
      prev = tmp.clone();
    }
    expect(maxStep).toBeLessThan(3); // smooth across the zenith — no spin/flip (each step ~2°)
  });

  it('a yaw nudge rotates the whole sky (drag-to-align works)', () => {
    const { E, N, U } = enuAt(30, 45);
    enuToSkyDir(E, N, U, 0, 0, LAT, LST, out);
    enuToSkyDir(E, N, U, 10 * DEG, 0, LAT, LST, tmp); // +10° align
    const moved = out.angleTo(tmp) * (180 / Math.PI);
    expect(moved).toBeGreaterThan(3); // it actually moves
    expect(moved).toBeLessThan(20); // ~ a rotation, not a blow-up
  });

  it('relative mode (no GPS) tracks motion + altitude is real', () => {
    // pointing up (alt 90) → relative look is straight up (+Y); pointing at horizon → on the equator
    enuToSkyDir(0, 0, 1, 0, 0, null, null, out);
    expect(out.y).toBeCloseTo(1, 5); // up is up (gravity)
    enuToSkyDir(0, 1, 0, 0, 0, null, null, out); // north horizon, no align
    expect(out.y).toBeCloseTo(0, 5); // on the horizon
  });

  it('deviceLookEnu tracks tilt continuously + monotonically (no jumps while moving)', () => {
    // sweep the device tilt (beta) and confirm the look vector moves smoothly and in one direction
    // — i.e. tilting the phone keeps panning the view the same way, never jumping.
    let prev = deviceLookEnu(0, 0, 0, 0);
    let maxStep = 0;
    let monotonic = true;
    for (let b = 2; b <= 178; b += 2) {
      const cur = deviceLookEnu(0, b * DEG, 0, 0);
      const d = Math.hypot(cur.E - prev.E, cur.N - prev.N, cur.U - prev.U);
      maxStep = Math.max(maxStep, d);
      if (b <= 88 && cur.U < prev.U - 1e-6) monotonic = false; // U rises while tilting up
      prev = cur;
    }
    expect(maxStep).toBeLessThan(0.1); // ~2° device step → small, continuous look step
    expect(monotonic).toBe(true); // tilt keeps panning one way (pitch not inverted/jumpy)
  });
});
