import * as THREE from 'three';
import { raDecToWorld } from '../math/frames';

const EULER = new THREE.Euler(0, 0, 0, 'YXZ'); // module scratch — zero per-frame alloc

/**
 * Inertial look-around from the centre of the sky sphere (plan/PHASE-1 §4).
 * yaw=0 looks along +Z (RA 0, Dec 0); up-axis is +Y (north celestial pole).
 * Drag scale follows FOV so panning feels right when zoomed in.
 */
export class LookControls {
  yaw = 0;
  pitch = 0;
  fovDeg = 70;

  private velYaw = 0;
  private velPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  // multi-touch (pinch-to-zoom on mobile/iOS)
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchFov = 0;
  private readonly damping = 6;
  private readonly minFov = 0.5;
  private readonly maxFov = 100;
  private targetDir = new THREE.Vector3();

  // animated fly-to (search / go-to)
  private animating = false;
  private animT = 0;
  private animDur = 1;
  private aYaw0 = 0;
  private aYawD = 0;
  private aPitch0 = 0;
  private aPitchD = 0;
  private aFov0 = 0;
  private aFovT = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => {
      this.animating = false; // a manual gesture cancels any fly-to
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        dom.setPointerCapture(e.pointerId);
      } else if (this.pointers.size === 2) {
        this.dragging = false; // two fingers = pinch-zoom, not look
        this.pinchDist = this.pointerDist();
        this.pinchFov = this.fovDeg;
      }
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (this.pointers.size >= 2) {
        // pinch → FOV (fingers apart = zoom in = smaller FOV)
        const d = this.pointerDist();
        if (d > 0 && this.pinchDist > 0) {
          this.fovDeg = THREE.MathUtils.clamp(
            (this.pinchFov * this.pinchDist) / d,
            this.minFov,
            this.maxFov,
          );
        }
        return;
      }
      if (!this.dragging) return;
      const radPerPx = (this.fovDeg * Math.PI) / 180 / dom.clientHeight;
      const dx = (e.clientX - this.lastX) * radPerPx;
      const dy = (e.clientY - this.lastY) * radPerPx;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw += dx;
      this.pitch += dy;
      this.velYaw = dx * 60;
      this.velPitch = dy * 60;
      this.clampPitch();
    });
    const endPointer = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      if (this.pointers.size === 0) {
        this.dragging = false;
      } else if (this.pointers.size === 1) {
        // pinch ended; resume look from the remaining finger
        const [only] = this.pointers.values();
        this.dragging = true;
        this.lastX = only!.x;
        this.lastY = only!.y;
        this.velYaw = this.velPitch = 0;
      }
    };
    dom.addEventListener('pointerup', endPointer);
    dom.addEventListener('pointercancel', endPointer);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.fovDeg = THREE.MathUtils.clamp(
          this.fovDeg * Math.pow(1.0015, e.deltaY),
          this.minFov,
          this.maxFov,
        );
      },
      { passive: false },
    );
  }

  /**
   * Aim the camera at an ICRS position (used by search / star "go-to").
   * Camera looks down −Z; for Euler 'YXZ' the forward vector is
   * (−sin·yaw·cos·pitch, sin·pitch, −cos·yaw·cos·pitch), so aiming at a world
   * direction d requires pitch = asin(d.y), yaw = atan2(−d.x, −d.z).
   */
  pointAt(raRad: number, decRad: number): void {
    raDecToWorld(raRad, decRad, this.targetDir);
    this.pitch = Math.asin(THREE.MathUtils.clamp(this.targetDir.y, -1, 1));
    this.yaw = Math.atan2(-this.targetDir.x, -this.targetDir.z);
    this.velYaw = this.velPitch = 0;
    this.clampPitch();
  }

  /** Animated glide to an ICRS position; optionally also eases the FOV (for go-to/search). */
  flyTo(raRad: number, decRad: number, targetFovDeg?: number): void {
    raDecToWorld(raRad, decRad, this.targetDir);
    const lim = Math.PI / 2 - 0.002;
    const tPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(this.targetDir.y, -1, 1)), -lim, lim);
    const tYaw = Math.atan2(-this.targetDir.x, -this.targetDir.z);
    let dy = (tYaw - this.yaw) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.aYaw0 = this.yaw;
    this.aYawD = dy;
    this.aPitch0 = this.pitch;
    this.aPitchD = tPitch - this.pitch;
    this.aFov0 = this.fovDeg;
    this.aFovT = THREE.MathUtils.clamp(targetFovDeg ?? this.fovDeg, this.minFov, this.maxFov);
    this.animT = 0;
    this.animDur = 1.1;
    this.animating = true;
    this.velYaw = this.velPitch = 0;
  }

  update(dt: number): void {
    if (this.animating && !this.dragging) {
      this.animT = Math.min(1, this.animT + dt / this.animDur);
      const e = this.animT * this.animT * (3 - 2 * this.animT); // smoothstep
      this.yaw = this.aYaw0 + this.aYawD * e;
      this.pitch = this.aPitch0 + this.aPitchD * e;
      this.fovDeg = this.aFov0 + (this.aFovT - this.aFov0) * e;
      if (this.animT >= 1) this.animating = false;
      this.clampPitch();
    } else if (!this.dragging) {
      const k = Math.exp(-this.damping * dt);
      this.yaw += this.velYaw * dt;
      this.pitch += this.velPitch * dt;
      this.velYaw *= k;
      this.velPitch *= k;
      this.clampPitch();
    }
    EULER.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(EULER);
    if (this.camera.fov !== this.fovDeg) {
      this.camera.fov = this.fovDeg;
      this.camera.updateProjectionMatrix();
    }
  }

  private clampPitch(): void {
    const lim = Math.PI / 2 - 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);
  }

  /** Screen-space distance between the first two active pointers (for pinch). */
  private pointerDist(): number {
    const it = this.pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
