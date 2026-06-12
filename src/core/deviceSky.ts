import * as THREE from 'three';
import type { LookControls } from './lookControls';

/**
 * Gyro "magic window": as you move the phone, the view follows (like holding a window up to
 * the sky). Uses the standard three.js DeviceOrientationControls quaternion to turn the
 * device's orientation into a look direction, then drives LookControls' yaw/pitch.
 *
 * This is a RELATIVE magic-window (the view tracks how you move the phone). True
 * "point-at-the-exact-real-star" registration additionally needs the observer's GPS location
 * + local sidereal time to offset azimuth→RA; that calibration is a verify-on-device follow-up
 * (the Capacitor Geolocation plugin is already installed). Combined with the auto-survey, the
 * sky detail still switches north/south by where you look.
 */

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X: look out the back
const quat = new THREE.Quaternion();
const look = new THREE.Vector3();

function deviceQuaternion(alpha: number, beta: number, gamma: number, orient: number): THREE.Quaternion {
  euler.set(beta, alpha, -gamma, 'YXZ');
  quat.setFromEuler(euler);
  quat.multiply(q1);
  quat.multiply(q0.setFromAxisAngle(zee, -orient));
  return quat;
}

export class DeviceSky {
  enabled = false;
  private handler: ((e: DeviceOrientationEvent) => void) | null = null;

  constructor(private controls: LookControls) {}

  /** Must be called from a user gesture (iOS requires a permission prompt). */
  async enable(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.handler = (e) => this.onOrientation(e);
    addEventListener('deviceorientation', this.handler, true);
    this.enabled = true;
    return true;
  }

  disable(): void {
    if (this.handler) removeEventListener('deviceorientation', this.handler, true);
    this.handler = null;
    this.enabled = false;
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const orient = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) *
      Math.PI) /
      180;
    const q = deviceQuaternion(
      (e.alpha * Math.PI) / 180,
      (e.beta * Math.PI) / 180,
      (e.gamma * Math.PI) / 180,
      orient,
    );
    // camera looks down -Z; in our look frame yaw = atan2(-x,-z), pitch = asin(y)
    look.set(0, 0, -1).applyQuaternion(q).normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1));
    const yaw = Math.atan2(-look.x, -look.z);
    this.controls.setYawPitch(yaw, pitch);
  }
}
