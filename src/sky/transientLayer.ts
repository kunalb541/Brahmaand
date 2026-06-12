import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';
import { SKY_RADIUS } from './skySphere';
import { ageDays, type Transient } from '../data/transients';

/**
 * Renders live transient alerts as ring markers on the celestial sphere, coloured by age
 * (recent = cyan, fading to orange over ~30 days). Follows the camera like the sky sphere
 * so it stays "at infinity" in planetarium mode. Supports nearest-marker picking.
 */

const R = SKY_RADIUS * 0.985; // just inside the sky, in front of constellations/stars

const MARKER_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uPixScale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixScale;
    gl_Position = projectionMatrix * mv;
  }
`;

const MARKER_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    if (r > 1.0) discard;
    // hollow ring + faint centre dot
    float ring = smoothstep(0.55, 0.72, r) * (1.0 - smoothstep(0.86, 1.0, r));
    float dot = 1.0 - smoothstep(0.0, 0.22, r);
    float a = clamp(ring + dot * 0.7, 0.0, 1.0);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

function ageColor(days: number, out: THREE.Color): THREE.Color {
  // 0d cyan → 30d orange
  const t = Math.min(Math.max(days / 30, 0), 1);
  return out.setRGB(0.2 + 0.8 * t, 0.9 - 0.4 * t, 1.0 - 0.9 * t);
}

export class TransientLayer {
  private group = new THREE.Group();
  private points: THREE.Points | null = null;
  private mat: THREE.ShaderMaterial;
  private items: { t: Transient; dir: THREE.Vector3 }[] = [];

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 20; // over sky, stars, constellations
    scene.add(this.group);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      uniforms: { uPixScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }

  setPixelScale(drawingBufferHeight: number): void {
    this.mat.uniforms.uPixScale!.value = Math.max(drawingBufferHeight / 1080, 0.6);
  }

  setCenter(v: THREE.Vector3): void {
    this.group.position.copy(v);
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  get count(): number {
    return this.items.length;
  }

  setTransients(list: Transient[], nowMs: number): void {
    this.dispose();
    this.items = list.map((t) => {
      const dir = new THREE.Vector3();
      raDecToWorld(t.raDeg * DEG2RAD, t.decDeg * DEG2RAD, dir);
      return { t, dir };
    });
    if (!this.items.length) return;

    const n = this.items.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const { t, dir } = this.items[i]!;
      pos[i * 3] = dir.x * R;
      pos[i * 3 + 1] = dir.y * R;
      pos[i * 3 + 2] = dir.z * R;
      ageColor(ageDays(t.lastMjd, nowMs), c);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = 16 + Math.min(t.ndet, 40) * 0.4; // more detections → bigger marker
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** Nearest transient within `maxDeg` of a world-frame direction, or null. */
  pickNearest(dirWorld: THREE.Vector3, maxDeg: number): Transient | null {
    let best: Transient | null = null;
    let bestDot = Math.cos(maxDeg * DEG2RAD);
    for (const { t, dir } of this.items) {
      const d = dir.dot(dirWorld);
      if (d > bestDot) {
        bestDot = d;
        best = t;
      }
    }
    return best;
  }

  private dispose(): void {
    if (this.points) {
      this.group.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
  }
}
