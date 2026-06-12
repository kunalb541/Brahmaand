import * as THREE from 'three';
import { worldToRaDec } from '../math/frames';
import { formatDec, formatRa } from '../math/angles';

const ndc = new THREE.Vector3();
const camPos = new THREE.Vector3();
const rd = { raRad: 0, decRad: 0 };

/**
 * RA/Dec under the cursor. With the camera at the sphere centre the pointer direction
 * IS the sky direction — just unproject the NDC point (no mesh intersection needed).
 */
export class SkyReadout {
  private mouseX = -1;
  private mouseY = -1;
  private dir = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private el: HTMLElement,
    dom: HTMLElement,
  ) {
    dom.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  /** Pointer pixel → world-frame sky direction. False if no pointer position yet. */
  skyDirectionFromPointer(out: THREE.Vector3): boolean {
    if (this.mouseX < 0) return false;
    ndc.set(
      (this.mouseX / window.innerWidth) * 2 - 1,
      -(this.mouseY / window.innerHeight) * 2 + 1,
      0.5,
    );
    this.camera.getWorldPosition(camPos);
    out.copy(ndc).unproject(this.camera).sub(camPos).normalize();
    return true;
  }

  update(): void {
    if (!this.skyDirectionFromPointer(this.dir)) return;
    worldToRaDec(this.dir, rd);
    this.el.innerHTML = `RA ${formatRa(rd.raRad)}&nbsp;&nbsp;Dec ${formatDec(rd.decRad)}`;
  }
}
