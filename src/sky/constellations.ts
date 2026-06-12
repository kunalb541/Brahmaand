import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';
import { SKY_RADIUS } from './skySphere';

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const P = new THREE.Vector3();

interface GeoJson {
  features: { geometry: { type: string; coordinates: number[][][] } }[];
}

/**
 * Constellation stick figures from d3-celestial's GeoJSON (BSD-3, Olaf Frohn).
 * Coordinates are [lon, lat] in degrees; lon is RA (this dataset uses 0..360, but we
 * also accept the −180..180 convention). Built from raDecToWorld so the lines overlay
 * the imagery exactly. Lines are subdivided along great circles to avoid chords cutting
 * visibly inside the sphere.
 */
export async function createConstellationLines(url: string): Promise<THREE.LineSegments> {
  const geojson = (await (await fetch(url)).json()) as GeoJson;
  const positions: number[] = [];
  const R = SKY_RADIUS * 0.995;

  for (const f of geojson.features) {
    if (f.geometry.type !== 'MultiLineString') continue;
    for (const line of f.geometry.coordinates) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [lon1, lat1] = line[i]!;
        const [lon2, lat2] = line[i + 1]!;
        raDecToWorld(((lon1! + 360) % 360) * DEG2RAD, lat1! * DEG2RAD, A);
        raDecToWorld(((lon2! + 360) % 360) * DEG2RAD, lat2! * DEG2RAD, B);
        const steps = Math.max(1, Math.ceil((A.angleTo(B) / DEG2RAD) / 2));
        for (let s = 0; s < steps; s++) {
          for (const t of [s / steps, (s + 1) / steps]) {
            P.copy(A).lerp(B, t).normalize().multiplyScalar(R);
            positions.push(P.x, P.y, P.z);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x4a7fc0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = -50;
  lines.frustumCulled = false;
  return lines;
}
