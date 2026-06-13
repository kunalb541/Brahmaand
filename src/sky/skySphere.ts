import * as THREE from 'three';
import { TAU } from '../math/angles';
import { raDecToWorld } from '../math/frames';

export const SKY_RADIUS = 500; // world units; depth is irrelevant for the sky

/**
 * Inside-out celestial sphere whose UVs are generated from raDecToWorld — the SAME
 * convention used by the constellation overlay and star markers — so a plate-carrée
 * (CAR) all-sky image in ICRS lands correctly and the overlays sit on the right stars
 * by construction, with no rotation calibration needed.
 *
 * Image convention (CDS hips2fits CAR, ICRS, centred RA 0):
 *   - top row  = Dec +90  →  v = dec/π + 0.5      (with default texture flipY = true)
 *   - centre   = RA 0;  RA increases eastward (leftward) → u = 0.5 − ra/2π
 *     (u runs monotonically 0.5 → −0.5 around the sphere; wrapS = RepeatWrapping handles it)
 */
function buildSkyGeometry(radius: number, lon = 128, lat = 64): THREE.BufferGeometry {
  const verts = (lon + 1) * (lat + 1);
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const dir = new THREE.Vector3();

  let p = 0;
  let q = 0;
  for (let j = 0; j <= lat; j++) {
    const dec = -Math.PI / 2 + (j / lat) * Math.PI;
    for (let i = 0; i <= lon; i++) {
      const ra = (i / lon) * TAU;
      raDecToWorld(ra, dec, dir).multiplyScalar(radius);
      pos[p++] = dir.x;
      pos[p++] = dir.y;
      pos[p++] = dir.z;
      uv[q++] = 0.5 - ra / TAU;
      uv[q++] = dec / Math.PI + 0.5;
    }
  }

  const idx: number[] = [];
  for (let j = 0; j < lat; j++) {
    for (let i = 0; i < lon; i++) {
      const a = j * (lon + 1) + i;
      const b = a + lon + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

export function createSkySphere(texture: THREE.Texture): THREE.Mesh {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;

  const geo = buildSkyGeometry(SKY_RADIUS);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    // DoubleSide: buildSkyGeometry's winding (u mirrored for inside-view RA) makes the
    // inside-visible faces FRONT faces, so BackSide culled the whole sphere (the base sky
    // never rendered). DoubleSide is winding-agnostic — same choice as the HiPS tiles.
    side: THREE.DoubleSide,
    depthWrite: false,
    transparent: true, // opacity is driven by the planetarium↔space mode fade
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false; // camera sits inside
  return mesh;
}
