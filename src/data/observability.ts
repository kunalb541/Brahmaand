/**
 * Observability math for follow-up planning — accurate, no backend, no fake numbers.
 *
 * Given a target (RA, Dec, ICRS) + an observer (lat, lon) + a time, compute the altitude/azimuth,
 * airmass, and rise/transit/set times, plus an altitude-vs-time curve for the upcoming night and
 * the night (twilight) window from a low-precision Sun position.
 *
 * References:
 *  - Sidereal time: IAU 1982 GMST (Aoki et al. 1982), as in the USNO/Meeus formulation.
 *  - Alt/Az: standard spherical-astronomy hour-angle transform (Meeus, Astronomical Algorithms).
 *  - Airmass: Kasten & Young (1989), valid down to the horizon.
 *  - Sun: low-precision solar coordinates, USNO "Approximate Solar Coordinates" (~0.01° / ~1′),
 *    fine for twilight windows and a planning curve (NOT for ephemeris-grade work — labelled as such).
 *
 * Angles are radians internally; public results carry explicit units. Times are Unix ms (UTC).
 */

import * as Astronomy from 'astronomy-engine';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const SIDEREAL_MS_PER_DEG = (86164.0905 / 360) * 1000; // mean sidereal day per degree of LST advance

// FRAME RECONCILIATION: the world/catalog frame is J2000 ICRS, but sidereal time (GMST/LST) is
// referred to the equinox OF DATE. Differencing a J2000 RA against LST omits J2000→now precession
// (~46″/yr ≈ 0.34° by 2026), tilting the whole horizon/alt-az frame off the stars. We rotate RA/Dec
// between J2000 (EQJ) and equator-of-date (EQD) at the alt/az boundary. Matrices cached per minute
// (they drift ~arcsec/min). NOTE: the low-precision Sun (sunRaDec) is mean-equinox-OF-DATE already,
// so its alt/az must NOT be rotated — callers pass j2000=false for it.
let _rotBucket = NaN;
let _eqjEqd: number[][] = [];
let _eqdEqj: number[][] = [];
function ensureRot(unixMs: number): void {
  const bucket = Math.round(unixMs / 60000);
  if (bucket === _rotBucket) return;
  const time = Astronomy.MakeTime(new Date(bucket * 60000));
  _eqjEqd = Astronomy.Rotation_EQJ_EQD(time).rot;
  _eqdEqj = Astronomy.Rotation_EQD_EQJ(time).rot;
  _rotBucket = bucket;
}
function rotRaDec(raDeg: number, decDeg: number, m: number[][]): { raDeg: number; decDeg: number } {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
  const X = m[0]![0]! * x + m[1]![0]! * y + m[2]![0]! * z; // astronomy-engine RotateVector convention
  const Y = m[0]![1]! * x + m[1]![1]! * y + m[2]![1]! * z;
  const Z = m[0]![2]! * x + m[1]![2]! * y + m[2]![2]! * z;
  return {
    raDeg: ((Math.atan2(Y, X) * RAD) % 360 + 360) % 360,
    decDeg: Math.atan2(Z, Math.hypot(X, Y)) * RAD,
  };
}

export interface GeoLocation {
  latDeg: number;
  lonDeg: number; // east-positive
  label?: string;
}

function jd(unixMs: number): number {
  return unixMs / 86400000 + 2440587.5;
}

// ---- observer location (persisted; best-effort GPS) — accuracy: we only ever show numbers for a
//      KNOWN location, never a guessed one, and the label states the source ----
const LS_KEY = 'brahmaand.observer';
let observer: GeoLocation | null = (() => {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? (JSON.parse(s) as GeoLocation) : null;
  } catch {
    return null;
  }
})();

export function getObserver(): GeoLocation | null {
  return observer;
}
export function setObserver(loc: GeoLocation | null): void {
  observer = loc;
  try {
    if (loc) localStorage.setItem(LS_KEY, JSON.stringify(loc));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
/** Best-effort GPS fix → observer location (only overwrites if the user hasn't set one). */
export function acquireObserver(force = false): void {
  if (!('geolocation' in navigator) || (observer && !force)) return;
  navigator.geolocation.getCurrentPosition(
    (p) =>
      setObserver({
        latDeg: p.coords.latitude,
        lonDeg: p.coords.longitude,
        label: 'your location (GPS)',
      }),
    () => {
      /* denied → stays null; UI prompts to set manually */
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
  );
}

/** Greenwich Mean Sidereal Time, degrees [0,360). IAU 1982. */
export function gmstDeg(unixMs: number): number {
  const d = jd(unixMs) - 2451545.0;
  const t = d / 36525;
  let deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return ((deg % 360) + 360) % 360;
}

/** Local Sidereal Time, degrees [0,360). */
export function lstDeg(unixMs: number, lonDeg: number): number {
  return (((gmstDeg(unixMs) + lonDeg) % 360) + 360) % 360;
}

export interface HorizontalCoord {
  altDeg: number; // elevation above horizon
  azDeg: number; // from North through East [0,360)
  hourAngleDeg: number;
}

/** Equatorial (RA,Dec deg) → horizontal (alt,az deg) for observer/time. */
export function equatorialToHorizontal(
  raDeg: number,
  decDeg: number,
  loc: GeoLocation,
  unixMs: number,
  j2000 = true, // input is J2000 ICRS (stars/planets); pass false for of-date input (the Sun)
): HorizontalCoord {
  if (j2000) {
    ensureRot(unixMs);
    const od = rotRaDec(raDeg, decDeg, _eqjEqd); // J2000 → equator of date, to match LST
    raDeg = od.raDeg;
    decDeg = od.decDeg;
  }
  const lst = lstDeg(unixMs, loc.lonDeg);
  let H = lst - raDeg; // hour angle, degrees
  H = (((H + 180) % 360) + 360) % 360 - 180; // wrap to [-180,180]
  const Hr = H * DEG;
  const dec = decDeg * DEG;
  const lat = loc.latDeg * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(Hr);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // azimuth from North through East
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(Hr),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(Hr),
  );
  return {
    altDeg: alt * RAD,
    azDeg: ((az * RAD) % 360 + 360) % 360,
    hourAngleDeg: H,
  };
}

/** Horizontal (alt, az-from-N-through-E, deg) → equatorial (RA, Dec, deg) for observer/time. */
export function horizontalToEquatorial(
  altDeg: number,
  azDeg: number,
  loc: GeoLocation,
  unixMs: number,
): { raDeg: number; decDeg: number } {
  const alt = altDeg * DEG, az = azDeg * DEG, lat = loc.latDeg * DEG;
  const sinDec = Math.sin(lat) * Math.sin(alt) + Math.cos(lat) * Math.cos(alt) * Math.cos(az);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const H = Math.atan2(
    -Math.sin(az) * Math.cos(alt),
    Math.sin(alt) * Math.cos(lat) - Math.cos(alt) * Math.sin(lat) * Math.cos(az),
  );
  let ra = lstDeg(unixMs, loc.lonDeg) - H * RAD; // of-date RA (LST is of-date)
  ra = ((ra % 360) + 360) % 360;
  ensureRot(unixMs);
  return rotRaDec(ra, dec * RAD, _eqdEqj); // of-date → J2000, matching the world/catalog frame
}

/** Kasten & Young (1989) relative air mass for a true altitude (deg). Infinity below the horizon. */
export function airmass(altDeg: number): number {
  if (altDeg <= 0) return Infinity;
  return 1 / (Math.sin(altDeg * DEG) + 0.50572 * Math.pow(altDeg + 6.07995, -1.6364));
}

/** Low-precision geocentric Sun RA/Dec (deg). USNO approximate solar coordinates. */
export function sunRaDec(unixMs: number): { raDeg: number; decDeg: number } {
  const n = jd(unixMs) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  let ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  ra = ((ra * RAD) % 360 + 360) % 360;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  return { raDeg: ra, decDeg: dec };
}

export interface RiseTransitSet {
  /** 'circumpolar' = never sets, 'never' = never rises above the horizon limit. */
  status: 'rises' | 'circumpolar' | 'never';
  transitMs: number | null; // next upper transit
  riseMs: number | null;
  setMs: number | null;
  maxAltDeg: number; // altitude at transit (best of the night)
}

/**
 * Next transit + the rise/set bracketing it, for altitude limit `h0Deg`
 * (default -0.5667° ≈ standard refraction + semidiameter-free point source).
 */
export function riseTransitSet(
  raDeg: number,
  decDeg: number,
  loc: GeoLocation,
  unixMs: number,
  h0Deg = -0.5667,
): RiseTransitSet {
  // rotate the J2000 target to equator-of-date so RA matches LST (else transit/rise/set are off ~0.34°)
  ensureRot(unixMs);
  const od = rotRaDec(raDeg, decDeg, _eqjEqd);
  raDeg = od.raDeg;
  decDeg = od.decDeg;

  const lat = loc.latDeg * DEG;
  const dec = decDeg * DEG;
  const maxAlt = 90 - Math.abs(loc.latDeg - decDeg); // altitude at upper transit

  // next time LST == RA  (upper transit)
  const lst = lstDeg(unixMs, loc.lonDeg);
  let dLst = raDeg - lst;
  dLst = ((dLst % 360) + 360) % 360; // [0,360) → next transit ahead
  const transitMs = unixMs + dLst * SIDEREAL_MS_PER_DEG;

  // hour angle at the altitude limit
  const cosH0 =
    (Math.sin(h0Deg * DEG) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  if (cosH0 < -1) {
    return { status: 'circumpolar', transitMs, riseMs: null, setMs: null, maxAltDeg: maxAlt };
  }
  if (cosH0 > 1) {
    return { status: 'never', transitMs: null, riseMs: null, setMs: null, maxAltDeg: maxAlt };
  }
  const H0deg = Math.acos(cosH0) * RAD;
  return {
    status: 'rises',
    transitMs,
    riseMs: transitMs - H0deg * SIDEREAL_MS_PER_DEG,
    setMs: transitMs + H0deg * SIDEREAL_MS_PER_DEG,
    maxAltDeg: maxAlt,
  };
}

export interface NightWindow {
  sunsetMs: number | null; // sun alt crosses -0.833°
  sunriseMs: number | null;
  duskMs: number | null; // astronomical twilight ends, sun alt = -18°
  dawnMs: number | null;
}

/** The upcoming night around `unixMs` by scanning the Sun altitude (5-min steps over 24h). */
export function nightWindow(loc: GeoLocation, unixMs: number): NightWindow {
  const step = 5 * 60 * 1000;
  const sunAlt = (ms: number): number => {
    const s = sunRaDec(ms); // of-date apparent Sun → do NOT rotate to J2000
    return equatorialToHorizontal(s.raDeg, s.decDeg, loc, ms, /*j2000*/ false).altDeg;
  };
  // Anchor the 24h scan at the most-recent local solar noon (Sun near upper transit) so it ALWAYS
  // starts in daylight. Scanning forward from `unixMs` breaks at night: no sunset is seen, so the
  // gated dawn/sunrise are never detected → empty altitude curve. (CRITICAL fix.)
  const s0 = sunRaDec(unixMs);
  let dH = lstDeg(unixMs, loc.lonDeg) - s0.raDeg; // Sun hour angle now (deg)
  dH = ((dH % 360) + 360) % 360; // degrees since last solar transit
  const anchor = unixMs - dH * SIDEREAL_MS_PER_DEG;
  let sunsetMs: number | null = null,
    sunriseMs: number | null = null,
    duskMs: number | null = null,
    dawnMs: number | null = null;
  let prev = sunAlt(anchor);
  for (let t = anchor + step; t <= anchor + 24 * 3600 * 1000; t += step) {
    const a = sunAlt(t);
    if (sunsetMs === null && prev > -0.833 && a <= -0.833) sunsetMs = t;
    if (duskMs === null && prev > -18 && a <= -18) duskMs = t;
    if (sunsetMs !== null && dawnMs === null && prev <= -18 && a > -18) dawnMs = t;
    if (sunsetMs !== null && sunriseMs === null && prev <= -0.833 && a > -0.833) sunriseMs = t;
    prev = a;
  }
  return { sunsetMs, sunriseMs, duskMs, dawnMs };
}

/** Altitude (deg) samples of the target over [startMs,endMs] at `stepMin` minutes. */
export function altitudeCurve(
  raDeg: number,
  decDeg: number,
  loc: GeoLocation,
  startMs: number,
  endMs: number,
  stepMin = 10,
): { ms: number; altDeg: number }[] {
  const step = stepMin * 60 * 1000;
  const out: { ms: number; altDeg: number }[] = [];
  for (let t = startMs; t <= endMs; t += step) {
    out.push({ ms: t, altDeg: equatorialToHorizontal(raDeg, decDeg, loc, t).altDeg });
  }
  return out;
}
