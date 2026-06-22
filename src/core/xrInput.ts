import * as THREE from 'three';

/**
 * WebXR controller input. All of this is inert until an immersive session starts,
 * so desktop is unaffected. Provides:
 *   - a pointing ray on each controller; trigger (selectstart) → onSelect(worldDir)
 *     (reuses the same identify path as a desktop click)
 *   - left thumbstick → fly through space (moves the rig); right thumbstick X → snap-turn
 *   - foveation + target-frame-rate setup on sessionstart
 * Developed against the Immersive Web Emulator.
 */

const q = new THREE.Quaternion();
const fwd = new THREE.Vector3();
const move = new THREE.Vector3();
const camFwd = new THREE.Vector3();
const camRight = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function makeRay(): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.7 }));
  line.scale.z = 8;
  return line;
}

export class XRInput {
  private controllers: THREE.Group[] = [];
  private snapArmed = true;
  baseSpeed = 8; // pc/s in VR

  constructor(
    private renderer: THREE.WebGLRenderer,
    private rig: THREE.Object3D,
    private camera: THREE.PerspectiveCamera,
    onSelect: (worldDir: THREE.Vector3) => void,
  ) {
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      c.add(makeRay());
      c.addEventListener('selectstart', () => {
        c.getWorldQuaternion(q);
        fwd.set(0, 0, -1).applyQuaternion(q).normalize(); // controller points along -Z
        onSelect(fwd);
      });
      rig.add(c);
      this.controllers.push(c);
    }

    renderer.xr.addEventListener('sessionstart', () => {
      try {
        renderer.xr.setFoveation?.(0.4);
      } catch {
        /* not supported */
      }
      const session = renderer.xr.getSession();
      const rates = (session as unknown as { supportedFrameRates?: number[] }).supportedFrameRates;
      const update = (session as unknown as { updateTargetFrameRate?: (n: number) => Promise<void> })
        .updateTargetFrameRate;
      if (rates && update) {
        const target = rates.includes(90) ? 90 : rates.includes(72) ? 72 : rates[rates.length - 1]!;
        void update.call(session, target).catch(() => {});
      }
    });
  }

  /** Per-frame locomotion from thumbsticks. No-op when not presenting. */
  update(dt: number): void {
    if (!this.renderer.xr.isPresenting) return;
    const session = this.renderer.xr.getSession();
    if (!session) return;

    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      const sx = gp.axes[2] ?? 0; // thumbstick X
      const sy = gp.axes[3] ?? 0; // thumbstick Y

      if (src.handedness === 'left') {
        if (Math.abs(sx) > 0.12 || Math.abs(sy) > 0.12) {
          this.camera.getWorldDirection(camFwd);
          camRight.crossVectors(camFwd, UP).normalize();
          const speed = this.baseSpeed * (1 + this.rig.position.length() * 0.06);
          move.set(0, 0, 0).addScaledVector(camFwd, -sy * speed * dt).addScaledVector(camRight, sx * speed * dt);
          this.rig.position.add(move);
        }
      } else if (src.handedness === 'right') {
        // snap turn at ±0.7, re-armed when the stick returns to centre
        if (this.snapArmed && Math.abs(sx) > 0.7) {
          this.rig.rotateY(sx > 0 ? -Math.PI / 6 : Math.PI / 6);
          this.snapArmed = false;
        } else if (Math.abs(sx) < 0.3) {
          this.snapArmed = true;
        }
      }
    }
  }
}
