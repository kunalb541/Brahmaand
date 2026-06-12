import * as THREE from 'three';
import { TAU } from './angles';

/**
 * The single source of frame truth (see plan/PHASE-1-sky-sphere.md §1).
 *
 * World axes (Three.js, right-handed, Y-up):
 *   +Y = north celestial pole (Dec +90)
 *   +Z = vernal equinox (RA 0, Dec 0)
 *   +X = RA 90°, Dec 0
 *
 * Every module converts RA/Dec ↔ world through these functions so the sky imagery,
 * the constellation overlay, and the star markers stay aligned by construction.
 */

/** RA/Dec (radians) → world-frame unit vector. */
export function raDecToWorld(raRad: number, decRad: number, out: THREE.Vector3): THREE.Vector3 {
  const cd = Math.cos(decRad);
  return out.set(cd * Math.sin(raRad), Math.sin(decRad), cd * Math.cos(raRad));
}

/** World-frame unit vector → { raRad ∈ [0, 2π), decRad }. Allocation-free via out param. */
export function worldToRaDec(world: THREE.Vector3, out: { raRad: number; decRad: number }): void {
  out.decRad = Math.asin(THREE.MathUtils.clamp(world.y, -1, 1));
  const ra = Math.atan2(world.x, world.z);
  out.raRad = ra < 0 ? ra + TAU : ra;
}
