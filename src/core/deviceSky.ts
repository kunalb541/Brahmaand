import * as THREE from 'three';
import type { LookControls } from './lookControls';
import { raDecToWorld } from '../math/frames';

/**
 * Phone "magic window": move the phone and the view follows the real sky — the way Stellarium
 * Mobile / Sky Map / three.js DeviceOrientationControls do it.
 *
 * APPROACH (one mode, smooth AND accurate — no toggles):
 *  1. Each `deviceorientation` event builds the FULL device camera quaternion (with roll) from
 *     (alpha,beta,gamma) + screen orientation — the canonical DeviceOrientationControls composition.
 *  2. That device quaternion is composed with a WORLD-ALIGN quaternion (built from the observer's
 *     latitude + Local Sidereal Time + a one-time compass north seed + the user's drag-align) that
 *     rotates the device's gravity frame onto the real celestial sphere. No azimuth/altitude
 *     decomposition anywhere → singularity-free, never spins (even at the zenith).
 *  3. The render loop SLERPs the camera quaternion toward that target every frame with a single
 *     time constant — slerp is itself a low-pass, so it's smooth without lag and responsive without
 *     jitter. The phone owns the camera's full orientation (incl. roll); LookControls keeps zoom.
 *
 * Without GPS it falls back to a relative window (tracks motion, altitude real from gravity; a drag
 * rotates the whole sky to match reality). Compass is reliable per-device only as a one-time north
 * seed; the persistent drag-align corrects any residual rotation.
 */

// Flip if azimuth comes out mirrored on a given device (move right → sky goes left).
const AZ_SIGN = 1;
const AZ_OFFSET_DEG = 0;
// Slerp time constant (s): larger = smoother (more glide, a touch more lag). 0.13 s reads as
// "buttery" while still tracking — Star-Walk-like.
const SLERP_TAU = 0.13;
// Heading drift-correction time constant (s): slow enough to average out compass noise (no jitter),
// fast enough to keep gyro yaw drift from ever building up.
const DRIFT_TAU = 2.5;

const DEG2RAD = Math.PI / 180;

const zee = new THREE.Vector3(0, 0, 1);
const upY = new THREE.Vector3(0, 1, 0);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X: look out the back
const qDev = new THREE.Quaternion();
const qAlign = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const mat = new THREE.Matrix4();
const look = new THREE.Vector3();
const eVec = new THREE.Vector3();
const nVec = new THREE.Vector3();
const uVec = new THREE.Vector3();
const eRot = new THREE.Vector3();
const nNeg = new THREE.Vector3();

/** Canonical DeviceOrientationControls quaternion (camera looks out the back of the phone). */
function deviceQuaternion(alpha: number, beta: number, gamma: number, orient: number): THREE.Quaternion {
  euler.set(beta, alpha, -gamma, 'YXZ');
  qDev.setFromEuler(euler);
  qDev.multiply(q1);
  qDev.multiply(q0.setFromAxisAngle(zee, -orient));
  return qDev;
}

function gmstRad(unixMs: number): number {
  const jd = unixMs / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const t = d / 36525;
  let deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  deg = ((deg % 360) + 360) % 360;
  return deg * DEG2RAD;
}
function lstRad(unixMs: number, lonRad: number): number {
  return gmstRad(unixMs) + lonRad;
}

/** Device orientation (radians) → horizon ENU components of the look (camera −Z) direction. */
export function deviceLookEnu(
  alpha: number,
  beta: number,
  gamma: number,
  orient: number,
): { E: number; N: number; U: number } {
  const q = deviceQuaternion(alpha, beta, gamma, orient);
  look.set(0, 0, -1).applyQuaternion(q).normalize();
  return { E: look.x, N: -look.z, U: look.y }; // East=+X, North=−Z, Up=+Y
}

/**
 * Aligned horizon vector (E0,N0,U0) → a world look direction. With lat + LST it maps onto the real
 * celestial sphere as a LINEAR combination of three basis directions (east-horizon / north-horizon
 * / zenith) — singularity-free. Kept as the proven reference the unit tests pin the math to.
 */
export function enuToSkyDir(
  E0: number,
  N0: number,
  U0: number,
  yaw: number,
  altOffset: number,
  latRad: number | null,
  lst: number | null,
  out: THREE.Vector3,
): boolean {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const E = E0 * cy + N0 * sy;
  let N = N0 * cy - E0 * sy;
  let U = U0;
  if (altOffset) {
    const ca = Math.cos(altOffset);
    const sa = Math.sin(altOffset);
    const n2 = N * ca - U * sa;
    U = N * sa + U * ca;
    N = n2;
  }
  if (latRad != null && lst != null) {
    raDecToWorld(lst + Math.PI / 2, 0, eVec);
    raDecToWorld(lst, latRad, uVec);
    raDecToWorld(lst + Math.PI, Math.PI / 2 - latRad, nVec);
    out
      .set(E * eVec.x + N * nVec.x + U * uVec.x, E * eVec.y + N * nVec.y + U * uVec.y, E * eVec.z + N * nVec.z + U * uVec.z)
      .normalize();
    return true;
  }
  out.set(E, U, -N).normalize();
  return false;
}

/**
 * Full camera quaternion for the magic window: the device orientation rotated onto the celestial
 * frame (absolute, lat+lst) or just yaw-aligned (relative). Its look direction (apply to −Z) equals
 * enuToSkyDir for the same orientation; additionally it carries the correct ROLL. Returns absolute?.
 */
export function buildSkyQuat(
  alpha: number,
  beta: number,
  gamma: number,
  orient: number,
  yaw: number,
  latRad: number | null,
  lst: number | null,
  out: THREE.Quaternion,
): boolean {
  const dev = deviceQuaternion(alpha, beta, gamma, orient);
  if (latRad != null && lst != null) {
    // basis vectors of the (yaw-aligned) horizon frame in the celestial world frame
    raDecToWorld(lst + Math.PI / 2, 0, eVec); // east horizon
    raDecToWorld(lst, latRad, uVec); // zenith
    raDecToWorld(lst + Math.PI, Math.PI / 2 - latRad, nVec); // north horizon
    eRot.copy(eVec).applyAxisAngle(uVec, yaw);
    nNeg.copy(nVec).applyAxisAngle(uVec, yaw).negate();
    mat.makeBasis(eRot, uVec, nNeg); // maps device axes (E,U,−N) → celestial
    qAlign.setFromRotationMatrix(mat);
    out.copy(qAlign).multiply(dev);
    return true;
  }
  qYaw.setFromAxisAngle(upY, yaw);
  out.copy(qYaw).multiply(dev);
  return false;
}

export class DeviceSky {
  enabled = false;
  /** True once a real-sky (GPS) fix is in use; false = relative magic-window. */
  absolute = false;
  private handler: ((e: DeviceOrientationEvent) => void) | null = null;
  private absHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  private sawAbsoluteEvent = false;
  private latRad: number | null = null;
  private lonRad: number | null = null;

  // compass north reference: snapped on first valid sample, then slowly drift-corrected toward the
  // compass (complementary filter) so iOS gyro yaw drift can't accumulate. + persistent drag-align.
  private compassSeed = 0;
  private seeded = false;
  private lastSeedMs = 0;
  private azOffsetUser = 0;

  private readonly targetQuat = new THREE.Quaternion();
  private readonly smoothQuat = new THREE.Quaternion();
  private hasTarget = false;
  private hasSmooth = false;

  constructor(private controls: LookControls) {
    try {
      const s = localStorage.getItem('brahmaand.skycal');
      if (s) this.azOffsetUser = (JSON.parse(s) as { az?: number }).az ?? 0;
    } catch {
      /* ignore */
    }
  }

  async enable(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    void this.acquireLocation();
    this.handler = (e) => {
      if (this.sawAbsoluteEvent) return;
      this.onOrientation(e);
    };
    this.absHandler = (e) => {
      this.sawAbsoluteEvent = true;
      this.onOrientation(e);
    };
    addEventListener('deviceorientation', this.handler, true);
    addEventListener('deviceorientationabsolute', this.absHandler as EventListener, true);
    this.enabled = true;
    this.hasTarget = false;
    this.hasSmooth = false;
    this.seeded = false;
    this.lastSeedMs = 0;
    return true;
  }

  private acquireLocation(): void {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.latRad = pos.coords.latitude * DEG2RAD;
        this.lonRad = pos.coords.longitude * DEG2RAD;
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }

  disable(): void {
    if (this.handler) removeEventListener('deviceorientation', this.handler, true);
    if (this.absHandler) removeEventListener('deviceorientationabsolute', this.absHandler as EventListener, true);
    this.handler = null;
    this.absHandler = null;
    this.sawAbsoluteEvent = false;
    this.enabled = false;
    this.absolute = false;
    this.controls.setExternalQuaternion(null);
    this.controls.syncFromCamera(); // keep the view where it is — no snap
  }

  /** Manual sky alignment: rotate the registration about the zenith (drag) and persist it. */
  nudgeCal(dAz: number): void {
    this.azOffsetUser += dAz;
    try {
      localStorage.setItem('brahmaand.skycal', JSON.stringify({ az: this.azOffsetUser }));
    } catch {
      /* ignore */
    }
  }
  resetCal(): void {
    this.azOffsetUser = 0;
    try {
      localStorage.removeItem('brahmaand.skycal');
    } catch {
      /* ignore */
    }
  }
  get calibrated(): boolean {
    return this.azOffsetUser !== 0;
  }

  /** Render-loop tick: slerp the camera quaternion toward the latest target (smooth + responsive). */
  update(dt: number): void {
    if (!this.enabled || !this.hasTarget || dt <= 0) return;
    if (!this.hasSmooth) {
      this.smoothQuat.copy(this.targetQuat);
      this.hasSmooth = true;
    } else {
      const alpha = 1 - Math.exp(-dt / SLERP_TAU); // dt-corrected; same feel at any frame rate
      this.smoothQuat.slerp(this.targetQuat, alpha);
    }
    this.controls.setExternalQuaternion(this.smoothQuat);
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const orient =
      ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;

    // compass heading (deg cw from true north): iOS webkitCompassHeading, Android absolute alpha
    const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean };
    let headingDeg: number | null = null;
    if (typeof ev.webkitCompassHeading === 'number' && isFinite(ev.webkitCompassHeading)) headingDeg = ev.webkitCompassHeading;
    else if (ev.absolute) headingDeg = (360 - e.alpha) % 360;

    // SLOW complementary heading correction — cancels the iOS gyro YAW DRIFT (the "rotates on its
    // own" creep) by gently pulling the north seed toward the compass. Sampled only when the phone
    // isn't pointed too high (|Up| < 0.7 ≈ alt < 44°, where the look azimuth is well-defined), and
    // very slowly (τ≈1.5 s) so the magnetometer's per-reading noise averages out — drift dies, no
    // jitter. The gyro still drives all the actual motion; this only fixes long-term drift.
    if (headingDeg != null) {
      const enu = deviceLookEnu(e.alpha * DEG2RAD, e.beta * DEG2RAD, e.gamma * DEG2RAD, orient);
      if (Math.abs(enu.U) < 0.7) {
        const trueAz = (AZ_SIGN * headingDeg + AZ_OFFSET_DEG) * DEG2RAD;
        const targetSeed = trueAz - Math.atan2(enu.E, enu.N);
        let d = targetSeed - this.compassSeed;
        d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest wrap, ±π
        if (!this.seeded) {
          this.compassSeed = targetSeed; // snap on the first valid sample
          this.seeded = true;
        } else {
          const now = Date.now();
          const dt = this.lastSeedMs ? Math.min(0.1, (now - this.lastSeedMs) / 1000) : 0.016;
          this.compassSeed += (1 - Math.exp(-dt / DRIFT_TAU)) * d; // τ≈1.5 s low-pass
        }
        this.lastSeedMs = Date.now();
      }
    }

    const yaw = this.compassSeed + this.azOffsetUser;
    const lst = this.lonRad != null ? lstRad(Date.now(), this.lonRad) : null;
    this.absolute = buildSkyQuat(
      e.alpha * DEG2RAD,
      e.beta * DEG2RAD,
      e.gamma * DEG2RAD,
      orient,
      yaw,
      this.latRad,
      lst,
      this.targetQuat,
    );
    this.hasTarget = true;
  }
}
