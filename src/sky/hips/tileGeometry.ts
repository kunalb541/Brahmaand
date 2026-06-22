import * as THREE from 'three';

/**
 * Build a subdivided quad mesh for one HEALPix cell from its 4 world-frame corners.
 * Positions come from bilinear interpolation of the corners, re-normalised onto the
 * sphere (exact enough at the orders we stream tiles for — small cells). UVs map the
 * square tile image onto the quad.
 *
 * UV orientation is the one calibration knob (one of 8 possible UV orientations). It is
 * settled empirically against the base equirect sphere; see ORIENT below.
 */

// Calibrated orientation: index 0..7 selecting one of the 8 square symmetries.
// 0:(u,v) 1:(v,u) 2:(1-u,v) 3:(u,1-v) 4:(1-u,1-v) 5:(1-v,u) 6:(v,1-u) 7:(1-v,1-u)
export const ORIENT: number = 4;

function uvFromAB(a: number, b: number): [number, number] {
  switch (ORIENT) {
    case 1: return [b, a];
    case 2: return [1 - a, b];
    case 3: return [a, 1 - b];
    case 4: return [1 - a, 1 - b];
    case 5: return [1 - b, a];
    case 6: return [b, 1 - a];
    case 7: return [1 - b, 1 - a];
    default: return [a, b];
  }
}

const tmpBottom = new THREE.Vector3();
const tmpTop = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/** corners arranged around the perimeter (healpix-ts cornersNest order). */
export function buildTileGeometry(
  corners: THREE.Vector3[],
  n: number,
  radius: number,
): THREE.BufferGeometry {
  const c0 = corners[0]!;
  const c1 = corners[1]!;
  const c2 = corners[2]!;
  const c3 = corners[3]!;

  const verts = (n + 1) * (n + 1);
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);

  let p = 0;
  let q = 0;
  for (let j = 0; j <= n; j++) {
    const b = j / n;
    for (let i = 0; i <= n; i++) {
      const a = i / n;
      // bilinear over the 4 corners (perimeter order c0→c1→c2→c3)
      tmpBottom.copy(c0).lerp(c1, a); // edge c0→c1
      tmpTop.copy(c3).lerp(c2, a); // edge c3→c2
      tmpP.copy(tmpBottom).lerp(tmpTop, b).normalize().multiplyScalar(radius);
      pos[p++] = tmpP.x;
      pos[p++] = tmpP.y;
      pos[p++] = tmpP.z;
      const [u, vv] = uvFromAB(a, b);
      uv[q++] = u;
      uv[q++] = vv;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * (n + 1) + i;
      const kb = k + n + 1;
      idx.push(k, kb, k + 1, k + 1, kb, kb + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
