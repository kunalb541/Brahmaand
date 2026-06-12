import * as THREE from 'three';

const dir = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/**
 * Translates the camera rig through the star field in world space (parsecs). WASD = move
 * in the look plane, Q/E (or Space/Shift-Space) = down/up, Shift = boost. Speed scales
 * with distance from the Sun so it feels right both in the solar neighbourhood and far out.
 * Look direction still comes from LookControls (rotation); this only moves position.
 */
export class FlyControls {
  private keys = new Set<string>();
  baseSpeed = 6; // pc/s

  constructor(
    private rig: THREE.Object3D,
    private camera: THREE.PerspectiveCamera,
  ) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  get distFromSun(): number {
    return this.rig.position.length();
  }

  // touch joystick vector (−1..1): forward (y) + strafe (x), set by the on-screen pad
  touchFwd = 0;
  touchStrafe = 0;

  reset(): void {
    this.rig.position.set(0, 0, 0);
  }

  /** True while any movement input is active (used to gate planetarium↔space mode). */
  get moving(): boolean {
    const k = this.keys;
    return (
      ['w', 's', 'a', 'd', 'q', 'e', ' '].some((c) => k.has(c)) ||
      Math.abs(this.touchFwd) > 0.05 ||
      Math.abs(this.touchStrafe) > 0.05
    );
  }

  update(dt: number): void {
    const k = this.keys;
    let f = this.touchFwd;
    let s = this.touchStrafe;
    let u = 0;
    if (k.has('w')) f += 1;
    if (k.has('s')) f -= 1;
    if (k.has('d')) s += 1;
    if (k.has('a')) s -= 1;
    if (k.has('e') || k.has(' ')) u += 1;
    if (k.has('q')) u -= 1;
    if (!f && !s && !u) return;

    this.camera.getWorldDirection(dir);
    right.crossVectors(dir, up).normalize();
    const boost = k.has('shift') ? 8 : 1;
    const speed = this.baseSpeed * boost * (1 + this.distFromSun * 0.06);
    this.rig.position.addScaledVector(dir, f * speed * dt);
    this.rig.position.addScaledVector(right, s * speed * dt);
    this.rig.position.addScaledVector(up, u * speed * dt);
  }
}
