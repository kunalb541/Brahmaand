import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEG2RAD } from './angles';
import { raDecToWorld, worldToRaDec } from './frames';

const v = new THREE.Vector3();
const rd = { raRad: 0, decRad: 0 };

describe('frames', () => {
  it('NCP is world +Y', () => {
    raDecToWorld(0, Math.PI / 2, v);
    expect(v.y).toBeCloseTo(1, 12);
  });
  it('RA0/Dec0 (vernal equinox) is world +Z', () => {
    raDecToWorld(0, 0, v);
    expect(v.z).toBeCloseTo(1, 12);
    expect(v.x).toBeCloseTo(0, 12);
  });
  it('RA 90° / Dec 0 is world +X', () => {
    raDecToWorld(Math.PI / 2, 0, v);
    expect(v.x).toBeCloseTo(1, 12);
  });
  it('round-trips Vega (279.2347°, +38.7837°)', () => {
    raDecToWorld(279.2347 * DEG2RAD, 38.7837 * DEG2RAD, v);
    worldToRaDec(v, rd);
    expect(rd.raRad / DEG2RAD).toBeCloseTo(279.2347, 6);
    expect(rd.decRad / DEG2RAD).toBeCloseTo(38.7837, 6);
  });
});
