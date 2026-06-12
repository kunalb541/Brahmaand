import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';
import { SKY_RADIUS } from './skySphere';
import type { CatalogSource } from '../data/vizier';

/**
 * Renders VizieR catalogue sources as coloured dot markers on the sky sphere — several
 * catalogues at once for multiwavelength comparison (e.g. optical Gaia + IR 2MASS + X-ray
 * Chandra over the same field). Follows the camera (Earth/planetarium mode), like the sky.
 */

const R = SKY_RADIUS * 0.98; // in front of constellations, behind transient rings

const VERT = /* glsl */ `
  uniform float uSize;
  uniform float uPixScale;
  void main() {
    gl_PointSize = uSize * uPixScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    if (r > 1.0) discard;
    float a = (1.0 - smoothstep(0.55, 1.0, r)) * 0.85;       // soft filled dot
    a += (1.0 - smoothstep(0.82, 0.95, r)) * 0.0;
    gl_FragColor = vec4(uColor, a);
  }
`;

interface Layer {
  points: THREE.Points;
  sources: { src: CatalogSource; dir: THREE.Vector3 }[];
  name: string;
  color: number;
}

export class CatalogOverlay {
  private group = new THREE.Group();
  private layers = new Map<string, Layer>();
  private pixScale = 1;

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 15; // over stars, under transient rings (20)
    scene.add(this.group);
  }

  setPixelScale(h: number): void {
    this.pixScale = Math.max(h / 1080, 0.6);
    for (const l of this.layers.values()) (l.points.material as THREE.ShaderMaterial).uniforms.uPixScale!.value = this.pixScale;
  }
  setCenter(v: THREE.Vector3): void {
    this.group.position.copy(v);
  }
  setVisible(on: boolean): void {
    this.group.visible = on;
  }
  has(id: string): boolean {
    return this.layers.has(id);
  }
  get activeIds(): string[] {
    return [...this.layers.keys()];
  }

  /** Add/replace a catalogue layer. */
  setCatalog(id: string, name: string, color: number, sources: CatalogSource[]): void {
    this.remove(id);
    const n = sources.length;
    const pos = new Float32Array(n * 3);
    const items: { src: CatalogSource; dir: THREE.Vector3 }[] = [];
    const d = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const s = sources[i]!;
      raDecToWorld(s.raDeg * DEG2RAD, s.decDeg * DEG2RAD, d);
      pos[i * 3] = d.x * R;
      pos[i * 3 + 1] = d.y * R;
      pos[i * 3 + 2] = d.z * R;
      items.push({ src: s, dir: d.clone() });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSize: { value: 8 },
        uPixScale: { value: this.pixScale },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.layers.set(id, { points, sources: items, name, color });
  }

  remove(id: string): void {
    const l = this.layers.get(id);
    if (!l) return;
    this.group.remove(l.points);
    l.points.geometry.dispose();
    (l.points.material as THREE.Material).dispose();
    this.layers.delete(id);
  }

  clear(): void {
    for (const id of [...this.layers.keys()]) this.remove(id);
  }

  count(id: string): number {
    return this.layers.get(id)?.sources.length ?? 0;
  }

  /** Nearest source across all layers within maxDeg of a world direction. */
  pickNearest(dirWorld: THREE.Vector3, maxDeg: number): { catalog: string; src: CatalogSource } | null {
    let best: { catalog: string; src: CatalogSource } | null = null;
    let bestDot = Math.cos(maxDeg * DEG2RAD);
    for (const l of this.layers.values()) {
      for (const { src, dir } of l.sources) {
        const dot = dir.dot(dirWorld);
        if (dot > bestDot) {
          bestDot = dot;
          best = { catalog: l.name, src };
        }
      }
    }
    return best;
  }
}
