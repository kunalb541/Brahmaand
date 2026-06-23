import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { SKY_RADIUS } from './skySphere';
import { horizontalToEquatorial, type GeoLocation } from '../data/observability';

/**
 * Local horizon, the way Stellarium / Star Walk show it: a translucent GROUND hemisphere below the
 * horizon, a bright horizon line, and N / E / S / W (+ inter-cardinal) markers. It is built from the
 * observer's location + time, so it rotates correctly with the sky (the ground stays put while the
 * stars wheel over it). Works whether you look around by drag or by moving the phone.
 *
 * Implementation: a fixed lower-hemisphere mesh whose local +Y is re-aimed at the current ZENITH
 * every frame (so its lower half = the real ground), plus screen-projected cardinal labels.
 */

const R = SKY_RADIUS * 0.985; // just inside the imagery
const ZEN = new THREE.Vector3(); // current zenith (world)
const UP = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const camPos = new THREE.Vector3();

const CARDINALS: { az: number; label: string }[] = [
  { az: 0, label: 'N' }, { az: 45, label: 'NE' }, { az: 90, label: 'E' }, { az: 135, label: 'SE' },
  { az: 180, label: 'S' }, { az: 225, label: 'SW' }, { az: 270, label: 'W' }, { az: 315, label: 'NW' },
];

export class Horizon {
  readonly group = new THREE.Group();
  visible = false;
  private ground: THREE.Mesh;
  private ring: THREE.LineLoop;
  private labelBox: HTMLDivElement;
  private labels: { el: HTMLDivElement; dir: THREE.Vector3 }[] = [];

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    // ground = lower hemisphere (local y ≤ 0), translucent dark earth; drawn over the below-horizon
    // sky so it reads as solid ground without fully hiding it.
    const geo = new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0a0d14,
      transparent: true,
      opacity: 0.82,
      side: THREE.BackSide, // viewed from the centre
      depthWrite: false,
      depthTest: false,
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.renderOrder = 4;

    // bright horizon line (the rim of the hemisphere, local y = 0)
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
    }
    this.ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0x6fb0e0, transparent: true, opacity: 0.7, depthTest: false }),
    );
    this.ring.renderOrder = 5;

    this.group.add(this.ground, this.ring);
    this.group.renderOrder = 4;
    scene.add(this.group);

    // cardinal labels (screen-projected DOM, like the star labels)
    this.labelBox = document.createElement('div');
    this.labelBox.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;display:none';
    document.body.appendChild(this.labelBox);
    for (const c of CARDINALS) {
      const el = document.createElement('div');
      el.textContent = c.label;
      const major = c.label.length === 1;
      el.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);font:600 ' +
        (major ? '13px' : '10px') +
        ' system-ui,sans-serif;color:' +
        (major ? '#bcd8ff' : '#7f93b5') +
        ';text-shadow:0 0 4px #000,0 0 8px #000;white-space:nowrap';
      this.labelBox.appendChild(el);
      this.labels.push({ el, dir: new THREE.Vector3() });
    }
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.group.visible = on;
    this.labelBox.style.display = on ? 'block' : 'none';
  }

  setCenter(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  /** Re-aim the ground to the current zenith and project the cardinal labels. `unixMs` = sim time. */
  update(loc: GeoLocation, unixMs: number): void {
    if (!this.visible) return;
    // zenith direction in the world frame = horizon point straight up (alt 90)
    const z = horizontalToEquatorial(90, 0, loc, unixMs);
    ZEN.set(
      Math.cos(z.decDeg * DEG2RAD) * Math.sin(z.raDeg * DEG2RAD),
      Math.sin(z.decDeg * DEG2RAD),
      Math.cos(z.decDeg * DEG2RAD) * Math.cos(z.raDeg * DEG2RAD),
    );
    this.group.quaternion.setFromUnitVectors(UP, ZEN); // local +Y → zenith, so lower half = ground

    // cardinal directions (alt 0) → world → screen
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.getWorldPosition(camPos); // anchor cardinal labels at the (translated) camera, like the ground mesh
    for (let i = 0; i < CARDINALS.length; i++) {
      const e = horizontalToEquatorial(0, CARDINALS[i]!.az, loc, unixMs);
      const it = this.labels[i]!;
      it.dir.set(
        Math.cos(e.decDeg * DEG2RAD) * Math.sin(e.raDeg * DEG2RAD),
        Math.sin(e.decDeg * DEG2RAD),
        Math.cos(e.decDeg * DEG2RAD) * Math.cos(e.raDeg * DEG2RAD),
      );
      v.copy(it.dir).add(camPos).project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      it.el.style.display = on ? 'block' : 'none';
      if (on) {
        it.el.style.left = `${((v.x + 1) / 2) * w}px`;
        it.el.style.top = `${((1 - v.y) / 2) * h}px`;
      }
    }
  }
}
