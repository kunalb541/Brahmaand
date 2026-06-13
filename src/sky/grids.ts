import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';
import { SKY_RADIUS } from './skySphere';

/**
 * Reference grids & lines (a Stellarium-style planetarium staple), drawn as great/small circles on
 * the celestial sphere in the world frame — accurate by construction (every vertex is a real
 * RA/Dec → world point):
 *   • Equatorial (ICRS/J2000) grid — meridians every 1ʰ, parallels every 15°, equator emphasised.
 *   • Ecliptic — the Sun/planet path (obliquity 23.4393°).
 *   • Galactic equator — the Milky Way plane (J2000 galactic→ICRS rotation).
 *
 * Horizon (alt/az) grid is intentionally NOT here: it depends on observer location + time and so
 * lives with the observability layer (a follow-up). Lines sit just inside the sphere to avoid
 * z-fighting with the imagery and constellation lines.
 */

const R = SKY_RADIUS * 0.992;
const v = new THREE.Vector3();

/** Push a polyline (as LineSegments pairs) sampled from a (t)→(raRad,decRad) parametric curve. */
function arc(
  pos: number[],
  fn: (t: number) => [number, number],
  t0: number,
  t1: number,
  steps: number,
): void {
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const [ra, dec] = fn(t);
    raDecToWorld(ra, dec, v).multiplyScalar(R);
    if (i > 0) pos.push(px, py, pz, v.x, v.y, v.z);
    px = v.x; py = v.y; pz = v.z;
  }
}

function lineSegs(pos: number[], color: number, opacity: number): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  return new THREE.LineSegments(geo, mat);
}

/** Equatorial grid: RA meridians (every 15°) + Dec parallels (every 15°). Equator returned separately. */
export function createEquatorialGrid(): THREE.LineSegments {
  const pos: number[] = [];
  for (let raDeg = 0; raDeg < 360; raDeg += 15) {
    const ra = raDeg * DEG2RAD;
    arc(pos, (d) => [ra, d * DEG2RAD], -88, 88, 90);
  }
  for (let decDeg = -75; decDeg <= 75; decDeg += 15) {
    if (decDeg === 0) continue; // equator drawn brighter, separately
    const dec = decDeg * DEG2RAD;
    arc(pos, (r) => [r * DEG2RAD, dec], 0, 360, 180);
  }
  return lineSegs(pos, 0x3f6f9f, 0.42);
}

/** Celestial equator (Dec = 0), emphasised. */
export function createEquator(): THREE.LineSegments {
  const pos: number[] = [];
  arc(pos, (r) => [r * DEG2RAD, 0], 0, 360, 360);
  return lineSegs(pos, 0x6fbcff, 0.7);
}

/** Ecliptic (β = 0, obliquity ε). */
export function createEcliptic(): THREE.LineSegments {
  const eps = 23.4393 * DEG2RAD;
  const pos: number[] = [];
  arc(
    pos,
    (lonDeg) => {
      const lon = lonDeg * DEG2RAD;
      const dec = Math.asin(Math.sin(eps) * Math.sin(lon));
      const ra = Math.atan2(Math.cos(eps) * Math.sin(lon), Math.cos(lon));
      return [ra, dec];
    },
    0,
    360,
    360,
  );
  return lineSegs(pos, 0xe6b85c, 0.75); // gold — the Sun/planet road
}

// J2000 Galactic → ICRS rotation (transpose of the IAU A_G matrix).
function galacticToRaDec(lDeg: number, bDeg: number): [number, number] {
  const l = lDeg * DEG2RAD, b = bDeg * DEG2RAD;
  const xg = Math.cos(b) * Math.cos(l), yg = Math.cos(b) * Math.sin(l), zg = Math.sin(b);
  const xe = -0.0548755604 * xg + 0.4941094279 * yg - 0.867666149 * zg;
  const ye = -0.8734370902 * xg - 0.44482963 * yg - 0.1980763734 * zg;
  const ze = -0.4838350155 * xg + 0.7469822445 * yg + 0.4559837762 * zg;
  return [Math.atan2(ye, xe), Math.asin(Math.max(-1, Math.min(1, ze)))];
}

/** Galactic equator (b = 0) — the Milky Way mid-plane. */
export function createGalacticEquator(): THREE.LineSegments {
  const pos: number[] = [];
  arc(pos, (lDeg) => galacticToRaDec(lDeg, 0), 0, 360, 360);
  return lineSegs(pos, 0x8f7fd0, 0.6); // violet
}
