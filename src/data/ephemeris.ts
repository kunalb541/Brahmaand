/**
 * Solar-system ephemerides — Sun, Moon, and the 7 planets, computed client-side and honestly
 * display-grade:
 *
 *  • Planets: JPL "Keplerian Elements for Approximate Positions of the Planets" (Table 1,
 *    valid 1800–2050 AD; Standish/JPL SSD). Mean elements + linear rates → Kepler solve →
 *    heliocentric J2000 ecliptic → geocentric → J2000 equatorial. Accuracy: arcminutes
 *    across 1800–2050 (we use Earth–Moon-barycentre elements for Earth: ≲0.7′ extra).
 *  • Moon: truncated lunar theory (Schlyter's formulation: mean elements + the 12 largest
 *    longitude perturbations — evection, variation, yearly & parallactic equations… — and the
 *    5 largest in latitude). Accuracy ≈ 1–2′. Topocentric parallax (up to ~1°!) is applied
 *    when an observer location is set.
 *  • Sun: from the same theory (Earth–Sun geometry), precessed to J2000.
 *
 * Frames: our sky/imagery is ICRS/J2000, so everything is output in J2000 RA/Dec. The lunar/solar
 * theory natively yields ecliptic-of-date; we precess longitude by −50.29″/yr to J2000 before
 * converting with ε(J2000) = 23.43928°.
 *
 * Magnitudes: classic Müller/Meeus phase formulas (Astronomical Algorithms §41) — approximate,
 * labelled as such. NOT for photometric work; for display ordering only.
 *
 * Validated in ephemeris.test.ts against hard external anchors (the 2020-12-21 Jupiter–Saturn
 * great conjunction ≈ 6′, the 2017-08-21 solar-eclipse Sun–Moon conjunction) plus physical
 * invariants (heliocentric ranges, max elongations, lunar distance/latitude bounds).
 */

import { getObserver, lstDeg } from './observability';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const AU_KM = 149597870.7;
const EARTH_R_KM = 6378.137;
const EPS_J2000 = 23.43928 * DEG;

const rev = (x: number): number => x - 360 * Math.floor(x / 360);

function kepler(Mdeg: number, e: number): number {
  const M = rev(Mdeg) * DEG;
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let i = 0; i < 10; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

// ---- JPL approximate elements, J2000 ecliptic, T = Julian centuries from J2000 ----
//        a (AU)      e          I (°)       L (°)        ϖ (°)        Ω (°)   + rates /century
type El = [number, number, number, number, number, number, number, number, number, number, number, number];
const ELEMENTS: Record<string, El> = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
    0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], // EM barycentre
  mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503,
    -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
    0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.30589125],
};

/** Heliocentric J2000-ecliptic position (AU) from JPL approximate elements. */
function helio(name: keyof typeof ELEMENTS, T: number): [number, number, number, number] {
  const el = ELEMENTS[name]!;
  const a = el[0] + el[6] * T;
  const e = el[1] + el[7] * T;
  const I = (el[2] + el[8] * T) * DEG;
  const L = el[3] + el[9] * T;
  const w_ = el[4] + el[10] * T; // ϖ
  const O = (el[5] + el[11] * T) * DEG;
  const w = w_ * DEG - O; // ω = ϖ − Ω
  const E = kepler(L - w_, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(I), si = Math.sin(I);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  return [x, y, z, Math.hypot(xp, yp)]; // + heliocentric distance r
}

export interface BodyEphemeris {
  id: string;
  name: string;
  raDeg: number; // J2000
  decDeg: number; // J2000
  distAU: number; // geocentric (topocentric for the Moon when location set)
  distKm: number;
  angDiamDeg: number;
  magV: number | null; // approximate (Müller/Meeus); null for Sun/Moon
  /** Moon/inner planets: illuminated fraction 0..1. */
  illum: number;
  phaseAngleDeg: number;
  /** True when the topocentric parallax correction was applied (Moon + observer set). */
  topocentric: boolean;
}

const BODY_META: Record<string, { name: string; radiusKm: number; color: number }> = {
  sun: { name: 'Sun', radiusKm: 695700, color: 0xfff2c0 },
  moon: { name: 'Moon', radiusKm: 1737.4, color: 0xd8dce6 },
  mercury: { name: 'Mercury', radiusKm: 2439.7, color: 0xb5aa9e },
  venus: { name: 'Venus', radiusKm: 6051.8, color: 0xf2e3c0 },
  mars: { name: 'Mars', radiusKm: 3389.5, color: 0xe08050 },
  jupiter: { name: 'Jupiter', radiusKm: 69911, color: 0xd9b894 },
  saturn: { name: 'Saturn', radiusKm: 58232, color: 0xe6d3a0 },
  uranus: { name: 'Uranus', radiusKm: 25362, color: 0xa8d8e0 },
  neptune: { name: 'Neptune', radiusKm: 24622, color: 0x7aa0e8 },
};

// Müller/Meeus approximate visual magnitudes (i = phase angle in degrees)
function planetMag(id: string, r: number, d: number, i: number): number | null {
  const t = 5 * Math.log10(r * d);
  switch (id) {
    case 'mercury': return -0.42 + t + 0.038 * i - 0.000273 * i * i + 2e-6 * i * i * i;
    case 'venus': return -4.4 + t + 0.0009 * i + 0.000239 * i * i - 6.5e-7 * i * i * i;
    case 'mars': return -1.52 + t + 0.016 * i;
    case 'jupiter': return -9.4 + t + 0.005 * i;
    case 'saturn': return -8.88 + t + 0.044 * i; // ring term omitted (varies ±~1 mag)
    case 'uranus': return -7.19 + t;
    case 'neptune': return -6.87 + t;
    default: return null;
  }
}

/** Precession of ecliptic longitude from date → J2000 (−50.29″/yr), degrees. */
function precessLonToJ2000(lonDeg: number, jd: number): number {
  const years = (jd - 2451545.0) / 365.25;
  return lonDeg - 0.0139697 * years;
}

function eclToEq(lonDeg: number, latDeg: number, dist: number): { x: number; y: number; z: number } {
  const lon = lonDeg * DEG, lat = latDeg * DEG;
  const x = dist * Math.cos(lat) * Math.cos(lon);
  const y = dist * Math.cos(lat) * Math.sin(lon);
  const z = dist * Math.sin(lat);
  return { x, y: y * Math.cos(EPS_J2000) - z * Math.sin(EPS_J2000), z: y * Math.sin(EPS_J2000) + z * Math.cos(EPS_J2000) };
}

function toRaDec(v: { x: number; y: number; z: number }): { raDeg: number; decDeg: number; r: number } {
  const r = Math.hypot(v.x, v.y, v.z);
  return { raDeg: rev(Math.atan2(v.y, v.x) * RAD), decDeg: Math.asin(v.z / r) * RAD, r };
}

/**
 * Geocentric (Moon: topocentric when an observer is set) J2000 positions of all bodies at `unixMs`.
 */
export function solarSystemAt(unixMs: number): BodyEphemeris[] {
  const jd = unixMs / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const d = jd - 2451543.5; // Schlyter epoch for the lunar/solar theory

  const out: BodyEphemeris[] = [];

  // ---- Earth (EM barycentre) heliocentric, J2000 ecliptic ----
  const [ex, ey, ez] = helio('earth', T);

  // ---- Sun (geocentric = −Earth), J2000 ----
  const sunVec = { x: -ex, y: -ey, z: -ez };
  const sunEqv = {
    x: sunVec.x,
    y: sunVec.y * Math.cos(EPS_J2000) - sunVec.z * Math.sin(EPS_J2000),
    z: sunVec.y * Math.sin(EPS_J2000) + sunVec.z * Math.cos(EPS_J2000),
  };
  const sunRD = toRaDec(sunEqv);
  out.push({
    id: 'sun', name: 'Sun', raDeg: sunRD.raDeg, decDeg: sunRD.decDeg,
    distAU: sunRD.r, distKm: sunRD.r * AU_KM,
    angDiamDeg: 2 * Math.asin(BODY_META.sun!.radiusKm / (sunRD.r * AU_KM)) * RAD,
    magV: null, illum: 1, phaseAngleDeg: 0, topocentric: false,
  });

  // ---- Moon (Schlyter truncated theory, ecliptic of date → precess → J2000) ----
  {
    const Nm = rev(125.1228 - 0.0529538083 * d);
    const im = 5.1454;
    const wm = rev(318.0634 + 0.1643573223 * d);
    const am = 60.2666; // Earth radii
    const em = 0.0549;
    const Mm = rev(115.3654 + 13.0649929509 * d);
    const ws = rev(282.9404 + 4.70935e-5 * d);
    const Ms = rev(356.047 + 0.9856002585 * d);

    const E = kepler(Mm, em);
    const xv = am * (Math.cos(E) - em);
    const yv = am * Math.sqrt(1 - em * em) * Math.sin(E);
    const v = rev(Math.atan2(yv, xv) * RAD);
    let r = Math.hypot(xv, yv); // Earth radii

    const NmR = Nm * DEG, vw = (v + wm) * DEG, imR = im * DEG;
    const xh = r * (Math.cos(NmR) * Math.cos(vw) - Math.sin(NmR) * Math.sin(vw) * Math.cos(imR));
    const yh = r * (Math.sin(NmR) * Math.cos(vw) + Math.cos(NmR) * Math.sin(vw) * Math.cos(imR));
    const zh = r * Math.sin(vw) * Math.sin(imR);
    let lon = rev(Math.atan2(yh, xh) * RAD);
    let lat = Math.asin(zh / r) * RAD;

    // perturbations (deg): the dozen largest terms
    const Ls = rev(Ms + ws); // Sun mean longitude
    const Lm = rev(Mm + wm + Nm);
    const D = rev(Lm - Ls); // mean elongation
    const F = rev(Lm - Nm); // argument of latitude
    const s = (x: number): number => Math.sin(x * DEG);
    const c = (x: number): number => Math.cos(x * DEG);
    lon +=
      -1.274 * s(Mm - 2 * D) + 0.658 * s(2 * D) - 0.186 * s(Ms) - 0.059 * s(2 * Mm - 2 * D) -
      0.057 * s(Mm - 2 * D + Ms) + 0.053 * s(Mm + 2 * D) + 0.046 * s(2 * D - Ms) +
      0.041 * s(Mm - Ms) - 0.035 * s(D) - 0.031 * s(Mm + Ms) - 0.015 * s(2 * F - 2 * D) +
      0.011 * s(Mm - 4 * D);
    lat +=
      -0.173 * s(F - 2 * D) - 0.055 * s(Mm - F - 2 * D) - 0.046 * s(Mm + F - 2 * D) +
      0.033 * s(F + 2 * D) + 0.017 * s(2 * Mm + F);
    r += -0.58 * c(Mm - 2 * D) - 0.46 * c(2 * D);

    // → J2000 equatorial (precess the of-date longitude back to J2000 first)
    const moonEq = eclToEq(precessLonToJ2000(lon, jd), lat, r); // units: Earth radii
    let mx = moonEq.x, my = moonEq.y, mz = moonEq.z;

    // topocentric parallax (the Moon is close enough that the observer's position matters ~1°)
    const obs = getObserver();
    let topo = false;
    if (obs) {
      const lst = lstDeg(unixMs, obs.lonDeg) * DEG;
      const phi = obs.latDeg * DEG;
      mx -= Math.cos(phi) * Math.cos(lst);
      my -= Math.cos(phi) * Math.sin(lst);
      mz -= Math.sin(phi);
      topo = true;
    }
    const mrd = toRaDec({ x: mx, y: my, z: mz });
    const distKm = mrd.r * EARTH_R_KM;
    const distAU = distKm / AU_KM;

    // phase: exact angle Sun–Moon–Earth from the geocentric vectors (AU)
    const ms = { x: mx * (EARTH_R_KM / AU_KM), y: my * (EARTH_R_KM / AU_KM), z: mz * (EARTH_R_KM / AU_KM) };
    const sm = { x: sunEqv.x - ms.x, y: sunEqv.y - ms.y, z: sunEqv.z - ms.z };
    const em_ = { x: -ms.x, y: -ms.y, z: -ms.z };
    const dot = sm.x * em_.x + sm.y * em_.y + sm.z * em_.z;
    const pa = Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(sm.x, sm.y, sm.z) * Math.hypot(em_.x, em_.y, em_.z)))));
    out.push({
      id: 'moon', name: 'Moon', raDeg: mrd.raDeg, decDeg: mrd.decDeg,
      distAU, distKm,
      angDiamDeg: 2 * Math.asin(BODY_META.moon!.radiusKm / distKm) * RAD,
      magV: null, illum: (1 + Math.cos(pa)) / 2, phaseAngleDeg: pa * RAD, topocentric: topo,
    });
  }

  // ---- Planets ----
  for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const) {
    const [px, py, pz, rh] = helio(id, T);
    const g = { x: px - ex, y: py - ey, z: pz - ez }; // geocentric, J2000 ecliptic
    const eq = {
      x: g.x,
      y: g.y * Math.cos(EPS_J2000) - g.z * Math.sin(EPS_J2000),
      z: g.y * Math.sin(EPS_J2000) + g.z * Math.cos(EPS_J2000),
    };
    const rd = toRaDec(eq);
    const delta = rd.r;
    const rEarth = Math.hypot(ex, ey, ez);
    // phase angle via the triangle Sun–planet–Earth
    const cosI = (rh * rh + delta * delta - rEarth * rEarth) / (2 * rh * delta);
    const i = Math.acos(Math.max(-1, Math.min(1, cosI))) * RAD;
    out.push({
      id, name: BODY_META[id]!.name, raDeg: rd.raDeg, decDeg: rd.decDeg,
      distAU: delta, distKm: delta * AU_KM,
      angDiamDeg: 2 * Math.asin(BODY_META[id]!.radiusKm / (delta * AU_KM)) * RAD,
      magV: planetMag(id, rh, delta, i),
      illum: (1 + Math.cos(i * DEG)) / 2, phaseAngleDeg: i, topocentric: false,
    });
  }

  return out;
}

export const BODY_COLOR: Record<string, number> = Object.fromEntries(
  Object.entries(BODY_META).map(([k, v]) => [k, v.color]),
);

/** Angular separation between two RA/Dec points (degrees). */
export function angularSepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const a1 = ra1 * DEG, d1 = dec1 * DEG, a2 = ra2 * DEG, d2 = dec2 * DEG;
  const s = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin((a2 - a1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) * RAD;
}
