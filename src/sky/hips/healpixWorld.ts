import * as THREE from 'three';
import {
  cornersNest,
  order2nside,
  queryDiscInclusiveNest,
} from 'healpix-ts';

/**
 * Bridges healpix-ts (which works in the HEALPix vector frame, +Z = north pole) to our
 * world frame (+Y = NCP). The mapping is the same swizzle as the Gaia pipeline:
 *   world.(x,y,z) = healpix.(y,z,x)
 * because a HEALPix vector is (cosDec·cosRA, cosDec·sinRA, sinDec) and
 * raDecToWorld is (cosDec·sinRA, sinDec, cosDec·cosRA).
 */

const TILE_WIDTH = 512;

/** HEALPix unit vector [x,y,z] → world Vector3. */
export function hpVecToWorld(v: number[], out: THREE.Vector3): THREE.Vector3 {
  return out.set(v[1]!, v[2]!, v[0]!);
}

/** World unit vector → HEALPix vector array [x,y,z]. */
export function worldToHpVec(w: THREE.Vector3): [number, number, number] {
  return [w.z, w.x, w.y];
}

/** The 4 corner directions of a NESTED cell, in world frame (order as healpix-ts returns). */
export function cellCornersWorld(order: number, ipix: number): THREE.Vector3[] {
  const nside = order2nside(order);
  const cs = cornersNest(nside, ipix) as number[][];
  return cs.map((c) => hpVecToWorld(c, new THREE.Vector3()));
}

/** Angular size (radians) of one tile pixel at order K — never trust hips_pixel_scale. */
function tilePixRad(order: number): number {
  const cellRad = Math.sqrt((4 * Math.PI) / (12 * 4 ** order)); // ≈ 58.63°/2^K
  return cellRad / TILE_WIDTH;
}

/**
 * Pick the HiPS order where one tile pixel ≈ one screen pixel (doc 03 §7).
 * Clamped to [minOrder, maxOrder].
 */
export function pickOrder(
  fovYRad: number,
  viewportHeightPx: number,
  minOrder: number,
  maxOrder: number,
): number {
  const screenPixRad = fovYRad / viewportHeightPx;
  let k = minOrder;
  while (k < maxOrder && tilePixRad(k) > screenPixRad) k++;
  return Math.max(minOrder, Math.min(maxOrder, k));
}

/**
 * NESTED cells intersecting a cone (world-frame axis + half-angle). Over-fetches a few
 * edge cells (harmless); holes are not. Used to decide which tiles to load.
 */
export function visibleCells(
  order: number,
  axisWorld: THREE.Vector3,
  halfAngleRad: number,
): number[] {
  const nside = order2nside(order);
  // Margin scaled to ~1.5 cells so we don't over-fetch a fixed 1° halo at high orders
  // (a fixed margin balloons tile counts into the hundreds at order 9).
  const cellRad = Math.sqrt((4 * Math.PI) / (12 * 4 ** order));
  const margin = Math.min(0.02, 1.5 * cellRad);
  const radius = Math.min(halfAngleRad + margin, Math.PI / 2 - 0.01);
  const hp = worldToHpVec(axisWorld);
  const out: number[] = [];
  queryDiscInclusiveNest(nside, hp, radius, (p: number) => out.push(p));
  return out;
}
