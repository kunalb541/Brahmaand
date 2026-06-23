import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';

/**
 * Messier deep-sky objects (M1–M110) — positions/types from SIMBAD via tools/build-messier.mjs
 * (public/data/messier.json), never hand-typed. Rendered as screen-projected labels with a small
 * diamond marker; click → fly + identify (full SIMBAD panel). Labels declutter by zoom: at wide
 * fields only the famous showpieces, all 110 when zoomed in.
 */

interface MObj {
  m: number;
  ra: number;
  dec: number;
  otype: string;
  name: string;
}

/** SIMBAD otype → short human label (subset relevant to the Messier list). */
const OTYPE: Record<string, string> = {
  GlC: 'globular', OpC: 'open cluster', Cl: 'cluster', 'Cl*': 'cluster',
  G: 'galaxy', GiP: 'galaxy', GiG: 'galaxy', AGN: 'galaxy', Sy2: 'galaxy', SyG: 'galaxy',
  LIN: 'galaxy', SBG: 'galaxy', H2G: 'galaxy', EmG: 'galaxy', GiC: 'galaxy',
  PN: 'planetary neb.', HII: 'nebula', RNe: 'nebula', ISM: 'nebula', SNR: 'SNR',
  'As*': 'asterism', mul: 'double', '**': 'double',
};

// the wide-field "greatest hits" shown before you zoom in
const FAMOUS = new Set([1, 8, 13, 16, 17, 20, 27, 31, 33, 42, 44, 45, 51, 57, 81, 87, 101, 104]);

const v = new THREE.Vector3();
const camPos = new THREE.Vector3();

export class MessierLayer {
  private container: HTMLDivElement;
  private items: { el: HTMLDivElement; dir: THREE.Vector3; famous: boolean }[] = [];
  visible = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    onPick: (raDeg: number, decDeg: number, label: string) => void,
  ) {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;display:none';
    document.body.appendChild(this.container);

    fetch('data/messier.json')
      .then((r) => r.json())
      .then((j: { objects: MObj[] }) => {
        for (const o of j.objects) {
          const el = document.createElement('div');
          const kind = OTYPE[o.otype] ?? o.otype;
          el.textContent = `◇ M${o.m}`;
          el.title = `M${o.m} · ${kind} — click to inspect`;
          el.style.cssText =
            'position:absolute;transform:translate(-50%,-50%);font:10px ui-monospace,monospace;' +
            'color:#9fe0c0;text-shadow:0 0 4px #000,0 0 8px #000;white-space:nowrap;opacity:.85;' +
            'pointer-events:auto;cursor:pointer';
          el.addEventListener('click', () => onPick(o.ra, o.dec, `M${o.m}`));
          this.container.appendChild(el);
          const dir = new THREE.Vector3();
          raDecToWorld(o.ra * DEG2RAD, o.dec * DEG2RAD, dir);
          this.items.push({ el, dir, famous: FAMOUS.has(o.m) });
        }
      })
      .catch((e) => console.warn('messier catalogue failed to load', e));
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.container.style.display = on ? 'block' : 'none';
  }

  /** Project labels; declutter by FOV (famous-only when wide, everything when zoomed). */
  update(fovDeg: number): void {
    if (!this.visible) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const showAll = fovDeg < 35;
    this.camera.getWorldPosition(camPos); // anchor labels at the (translated) camera, like the markers
    for (const it of this.items) {
      if (!showAll && !it.famous) {
        it.el.style.display = 'none';
        continue;
      }
      v.copy(it.dir).add(camPos).project(this.camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      it.el.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        it.el.style.left = `${((v.x + 1) / 2) * w}px`;
        it.el.style.top = `${((1 - v.y) / 2) * h}px`;
      }
    }
  }
}
