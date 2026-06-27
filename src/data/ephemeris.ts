/**
 * Solar-system ephemerides — Sun, Moon and the 7 planets — computed client-side with
 * **astronomy-engine** (Don Cross, MIT), a VSOP87/ELP-based library validated to **arcseconds**
 * against JPL Horizons. This replaces the old "approximate elements + truncated lunar theory"
 * (which was ~arcminutes and, worse, omitted the JPL Table-2a terms → ~1° error for Uranus/Neptune).
 *
 * Output is **J2000 ICRS RA/Dec** (matching our sky frame), aberration-corrected, and TOPOCENTRIC
 * when an observer location is set (the Moon's parallax is up to ~1°). Magnitudes come from
 * astronomy-engine's Illumination (includes Saturn's ring tilt); the Moon's illuminated fraction
 * and phase angle are exact. Distances/angular sizes from the true geometry.
 *
 * Validated in ephemeris.test.ts against hard anchors (2020-12-21 great conjunction, 2017-08-21
 * eclipse) — now to far tighter tolerances than the old model allowed.
 */

import * as Astronomy from 'astronomy-engine';
import { getObserver } from './observability';

const RAD = 180 / Math.PI;
const AU_KM = 149597870.7;

export interface BodyEphemeris {
  id: string;
  name: string;
  raDeg: number; // J2000
  decDeg: number; // J2000
  distAU: number; // topocentric when a location is set, else geocentric
  distKm: number;
  angDiamDeg: number;
  magV: number | null; // apparent visual magnitude (null for Sun/Moon)
  /** Illuminated fraction 0..1 (exact). */
  illum: number;
  phaseAngleDeg: number;
  /** True when topocentric (observer location set). */
  topocentric: boolean;
}

// radiusKm = IAU volumetric mean radius (physical use). equatorialKm = IAU 1-bar equatorial radius:
// the apparent disk is dominated by the equatorial radius, so it's what JPL Horizons "Ang-diam" and
// the Astronomical Almanac report — using the mean radius would understate the gas giants by ~1″.
const BODY_META: Record<
  string,
  { name: string; radiusKm: number; equatorialKm: number; color: number; body: Astronomy.Body }
> = {
  sun: { name: 'Sun', radiusKm: 695700, equatorialKm: 695700, color: 0xfff2c0, body: Astronomy.Body.Sun },
  moon: { name: 'Moon', radiusKm: 1737.4, equatorialKm: 1737.4, color: 0xd8dce6, body: Astronomy.Body.Moon },
  mercury: { name: 'Mercury', radiusKm: 2439.7, equatorialKm: 2439.7, color: 0xb5aa9e, body: Astronomy.Body.Mercury },
  venus: { name: 'Venus', radiusKm: 6051.8, equatorialKm: 6051.8, color: 0xf2e3c0, body: Astronomy.Body.Venus },
  mars: { name: 'Mars', radiusKm: 3389.5, equatorialKm: 3396.2, color: 0xe08050, body: Astronomy.Body.Mars },
  jupiter: { name: 'Jupiter', radiusKm: 69911, equatorialKm: 71492, color: 0xd9b894, body: Astronomy.Body.Jupiter },
  saturn: { name: 'Saturn', radiusKm: 58232, equatorialKm: 60268, color: 0xe6d3a0, body: Astronomy.Body.Saturn },
  uranus: { name: 'Uranus', radiusKm: 25362, equatorialKm: 25559, color: 0xa8d8e0, body: Astronomy.Body.Uranus },
  neptune: { name: 'Neptune', radiusKm: 24622, equatorialKm: 24764, color: 0x7aa0e8, body: Astronomy.Body.Neptune },
};

const ORDER = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/** Arcsecond-accurate J2000 positions of Sun, Moon and planets at `unixMs`. */
export function solarSystemAt(unixMs: number): BodyEphemeris[] {
  const date = new Date(unixMs);
  const loc = getObserver();
  const observer = loc ? new Astronomy.Observer(loc.latDeg, loc.lonDeg, 0) : null;
  const out: BodyEphemeris[] = [];

  for (const id of ORDER) {
    const meta = BODY_META[id]!;
    // J2000 equatorial, aberration-corrected; topocentric when we know where the observer is.
    let raDeg: number, decDeg: number, distAU: number;
    if (observer) {
      const eq = Astronomy.Equator(meta.body, date, observer, /*ofdate*/ false, /*aberration*/ true);
      raDeg = eq.ra * 15;
      decDeg = eq.dec;
      distAU = eq.dist;
    } else {
      const eq = Astronomy.EquatorFromVector(Astronomy.GeoVector(meta.body, date, /*aberration*/ true));
      raDeg = eq.ra * 15;
      decDeg = eq.dec;
      distAU = eq.dist;
    }
    const distKm = distAU * AU_KM;

    let magV: number | null = null;
    let illum = 1;
    let phaseAngleDeg = 0;
    if (id !== 'sun') {
      const il = Astronomy.Illumination(meta.body, date);
      illum = il.phase_fraction;
      phaseAngleDeg = il.phase_angle;
      if (id !== 'moon') magV = il.mag; // planets: apparent mag (Saturn incl. ring tilt)
    }

    out.push({
      id,
      name: meta.name,
      raDeg: ((raDeg % 360) + 360) % 360,
      decDeg,
      distAU,
      distKm,
      angDiamDeg: 2 * Math.asin(meta.equatorialKm / distKm) * RAD, // equatorial disk (matches Horizons Ang-diam)
      magV,
      illum,
      phaseAngleDeg,
      topocentric: !!observer,
    });
  }
  return out;
}

export const BODY_COLOR: Record<string, number> = Object.fromEntries(
  Object.entries(BODY_META).map(([k, v]) => [k, v.color]),
);

/**
 * Lightweight geocentric J2000 RA/Dec for one body at an instant — positions only (no illumination
 * or distance), so it's cheap enough to call many times for drawing apparent-motion (orbit) trails.
 */
export function bodyRaDecAt(id: string, unixMs: number): { raDeg: number; decDeg: number } | null {
  const meta = BODY_META[id];
  if (!meta) return null;
  const eq = Astronomy.EquatorFromVector(Astronomy.GeoVector(meta.body, new Date(unixMs), true));
  return { raDeg: ((eq.ra * 15) % 360 + 360) % 360, decDeg: eq.dec };
}

/** Angular separation between two RA/Dec points (degrees). */
export function angularSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const DEG = Math.PI / 180;
  const a1 = ra1 * DEG, d1 = dec1 * DEG, a2 = ra2 * DEG, d2 = dec2 * DEG;
  const s = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin((a2 - a1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) * RAD;
}
