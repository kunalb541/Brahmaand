import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';

/** A few naked-eye landmarks (ICRS J2000, degrees). Doubles as an alignment check. */
const STARS: { name: string; ra: number; dec: number }[] = [
  { name: 'Sirius', ra: 101.287, dec: -16.716 },
  { name: 'Canopus', ra: 95.988, dec: -52.696 },
  { name: 'Betelgeuse', ra: 88.793, dec: 7.407 },
  { name: 'Rigel', ra: 78.634, dec: -8.202 },
  { name: 'Aldebaran', ra: 68.98, dec: 16.509 },
  { name: 'Vega', ra: 279.234, dec: 38.784 },
  { name: 'Capella', ra: 79.172, dec: 45.998 },
  { name: 'Arcturus', ra: 213.915, dec: 19.182 },
  { name: 'Procyon', ra: 114.825, dec: 5.225 },
  { name: 'Altair', ra: 297.696, dec: 8.868 },
  { name: 'Antares', ra: 247.352, dec: -26.432 },
  { name: 'Spica', ra: 201.298, dec: -11.161 },
  { name: 'Pollux', ra: 116.329, dec: 28.026 },
  { name: 'Deneb', ra: 310.358, dec: 45.28 },
  { name: 'Polaris', ra: 37.954, dec: 89.264 },
  { name: 'Fomalhaut', ra: 344.413, dec: -29.622 },
];

const v = new THREE.Vector3();
const camPos = new THREE.Vector3();

export class StarLabels {
  private container: HTMLDivElement;
  private labels: { el: HTMLDivElement; dir: THREE.Vector3 }[] = [];
  visible = true;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none';
    document.body.appendChild(this.container);
    for (const s of STARS) {
      const el = document.createElement('div');
      el.textContent = `✦ ${s.name}`;
      el.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);font:11px ui-monospace,monospace;' +
        'color:#ffe9b0;text-shadow:0 0 4px #000,0 0 8px #000;white-space:nowrap;opacity:.9';
      this.container.appendChild(el);
      const dir = new THREE.Vector3();
      raDecToWorld(s.ra * DEG2RAD, s.dec * DEG2RAD, dir);
      this.labels.push({ el, dir });
    }
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.container.style.display = on ? 'block' : 'none';
  }

  update(): void {
    if (!this.visible) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.getWorldPosition(camPos); // labels are anchored at the (translated) camera, like the markers
    for (const { el, dir } of this.labels) {
      v.copy(dir).add(camPos).project(this.camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (!onScreen) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = `${((v.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }
}
