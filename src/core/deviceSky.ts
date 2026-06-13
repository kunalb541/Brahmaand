import * as THREE from 'three';
import type { LookControls } from './lookControls';
import { raDecToWorld } from '../math/frames';

/**
 * Phone "magic window": move the phone and the view follows the real sky.
 *
 * Two modes, picked automatically:
 *
 *  • ABSOLUTE (GPS) — maps the device look VECTOR straight into the celestial frame: the
 *    gravity-referenced horizon vector (East/North/Up) is recombined from three world basis
 *    directions (east-horizon / north-horizon / zenith) built from your latitude + Local Sidereal
 *    Time. Because it's a linear vector transform (no azimuth/altitude decomposition) it is
 *    SINGULARITY-FREE — it never spins, even pointing at the zenith — and it tracks the sky's
 *    rotation over time. North is anchored by a ONE-TIME compass seed (captured when the phone is
 *    roughly level) plus the user's persistent drag-alignment; the compass is never fed
 *    continuously (its jitter, plus the old az/alt gimbal, was what made the view spin).
 *
 *  • RELATIVE (no GPS) — the same aligned look vector without sky registration: tracks how you move
 *    the phone, altitude is real (gravity), and a drag rotates the whole sky to match reality.
 *
 * SMOOTHNESS (Star-Walk-like): each sensor event only writes a TARGET orientation; `update(dt)`
 * (render loop) slerps the camera toward it with a 1-Euro adaptive cutoff (heavy smoothing when
 * still, responsive when moving) + a deadband that holds rock-steady at rest. See PRESETS / update().
 *
 * Calibration: ALTITUDE is exact (gravity). AZIMUTH north is unreliable per device, so the user
 * drag-aligns once (persisted). `AZ_SIGN` flips the compass-seed handedness if the initial guess
 * is mirrored; the drag-align corrects any residual offset.
 */

// --- azimuth calibration knobs (only these may need a tweak after an on-device sky check) ---
const AZ_SIGN = 1; // flip to -1 if the view turns the wrong way horizontally
const AZ_OFFSET_DEG = 0; // add a constant if north is consistently off by a fixed angle

// --- smoothing presets (1-Euro-style adaptive filter) ---
// fcMin = cutoff (Hz) when the phone is still → low = heavy smoothing, kills jitter.
// beta  = how fast the cutoff rises with angular speed → responsiveness when you actually move.
// deadbandDeg = ignore target changes below this when nearly still → no micro-vibration at rest.
// compassLp = low-pass weight for the gyro→north offset (smaller = steadier heading).
export type SmoothMode = 'smooth' | 'accurate';
const PRESETS: Record<SmoothMode, { fcMin: number; beta: number; deadbandDeg: number; compassLp: number }> = {
  smooth: { fcMin: 0.6, beta: 4, deadbandDeg: 0.25, compassLp: 0.03 }, // public default — stable
  accurate: { fcMin: 1.6, beta: 8, deadbandDeg: 0.08, compassLp: 0.06 }, // pro — snappier
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X: look out the back
const quat = new THREE.Quaternion();
const look = new THREE.Vector3();
const look2 = new THREE.Vector3();
const eVec = new THREE.Vector3(); // East-horizon-point direction in the celestial world frame
const nVec = new THREE.Vector3(); // North-horizon-point direction
const uVec = new THREE.Vector3(); // Zenith direction

/** Build a roll-free camera orientation quaternion that looks along (yaw,pitch). */
function quatFromYawPitch(yaw: number, pitch: number, out: THREE.Quaternion): void {
  out.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));
}

function deviceQuaternion(alpha: number, beta: number, gamma: number, orient: number): THREE.Quaternion {
  euler.set(beta, alpha, -gamma, 'YXZ');
  quat.setFromEuler(euler);
  quat.multiply(q1);
  quat.multiply(q0.setFromAxisAngle(zee, -orient));
  return quat;
}

/** Greenwich Mean Sidereal Time (radians) for a Unix-ms instant (IAU 1982, good to ~1″). */
function gmstRad(unixMs: number): number {
  const jd = unixMs / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const t = d / 36525;
  let deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  deg = ((deg % 360) + 360) % 360;
  return deg * DEG2RAD;
}

/** Local Sidereal Time (radians) at east-positive longitude `lonRad`. */
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
 * / zenith) — singularity-free, so it never spins, even at the zenith. Without lat/LST it returns
 * the aligned relative look vector. `yaw` rotates about Up (north seed + manual align); `altOffset`
 * tilts about East. Returns true when the absolute (sky-registered) branch was used.
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
    raDecToWorld(lst + Math.PI / 2, 0, eVec); // east horizon point
    raDecToWorld(lst, latRad, uVec); // zenith
    raDecToWorld(lst + Math.PI, Math.PI / 2 - latRad, nVec); // north horizon point
    out
      .set(
        E * eVec.x + N * nVec.x + U * uVec.x,
        E * eVec.y + N * nVec.y + U * uVec.y,
        E * eVec.z + N * nVec.z + U * uVec.z,
      )
      .normalize();
    return true;
  }
  out.set(E, U, -N).normalize(); // relative window, Y-up
  return false;
}

export class DeviceSky {
  enabled = false;
  /** True once a real-sky (GPS + compass) fix is in use; false = relative magic-window. */
  absolute = false;
  private handler: ((e: DeviceOrientationEvent) => void) | null = null;
  private absHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  private sawAbsoluteEvent = false;
  private latRad: number | null = null;
  private lonRad: number | null = null;

  // Compass → gyro-frame north offset (radians). The flat-pose compass heading is NOT a valid
  // look azimuth when the phone is raised at the sky (its horizontal projection degenerates),
  // so we never use it directly: we estimate the constant offset between the gyro frame's
  // azimuth and true north, sampled ONLY in poses where the compass is meaningful, low-passed,
  // and then derive the look azimuth from the (continuous) gyro quaternion + this offset.
  // North seed from the compass — captured ONCE (when ~level), never fed continuously. A live
  // compass feed is what made the registered sky spin (heading jitter + alt/az gimbal); a single
  // seed + the user's drag-align is reliable. radians: az = gyroAz + compassSeed + azOffsetUser.
  private compassSeed = 0;
  private seeded = false;

  // User manual sky-alignment (radians), persisted. Device compasses are unreliable and vary by
  // model, so — like SkySafari / Stellarium Mobile — the user can DRAG the sky into alignment once
  // and it sticks. Added on top of the compass-derived offset in ABSOLUTE mode.
  private azOffsetUser = 0;
  private altOffsetUser = 0;

  // smoothing state: sensor events write `targetDir`; update(dt) slerps the camera toward it.
  private readonly targetDir = new THREE.Vector3(0, 0, -1);
  private readonly targetQuat = new THREE.Quaternion();
  private readonly smoothQuat = new THREE.Quaternion();
  private hasTarget = false;
  private hasSmooth = false;

  /** Smoothing preset — 'smooth' (default, public) or 'accurate' (pro, snappier). */
  mode: SmoothMode = 'smooth';
  /** When true, getStats() returns live numbers for the calibration overlay. */
  debug = false;

  // --- debug/telemetry (for the calibration overlay) ---
  private rawA = 0;
  private rawB = 0;
  private rawG = 0;
  private headingDeg: number | null = null;
  private hz = 0;
  private lastEvtMs = 0;

  constructor(private controls: LookControls) {
    try {
      const s = localStorage.getItem('brahmaand.skycal');
      if (s) {
        const c = JSON.parse(s) as { az?: number; alt?: number };
        this.azOffsetUser = c.az ?? 0;
        this.altOffsetUser = c.alt ?? 0;
      }
    } catch {
      /* ignore */
    }
  }

  setMode(m: SmoothMode): void {
    this.mode = m;
  }

  /** Manual sky alignment: nudge the registration by (Δaz, Δalt) radians and persist it. */
  nudgeCal(dAz: number, dAlt: number): void {
    this.azOffsetUser += dAz;
    this.altOffsetUser = THREE.MathUtils.clamp(this.altOffsetUser + dAlt, -0.8, 0.8);
    try {
      localStorage.setItem('brahmaand.skycal', JSON.stringify({ az: this.azOffsetUser, alt: this.altOffsetUser }));
    } catch {
      /* ignore */
    }
  }

  /** Clear the manual alignment (back to the compass-derived registration). */
  resetCal(): void {
    this.azOffsetUser = 0;
    this.altOffsetUser = 0;
    try {
      localStorage.removeItem('brahmaand.skycal');
    } catch {
      /* ignore */
    }
  }

  /** True when manual alignment is active (non-zero), for the UI. */
  get calibrated(): boolean {
    return this.azOffsetUser !== 0 || this.altOffsetUser !== 0;
  }

  /** Live filter/sensor telemetry for the calibration overlay. */
  getStats(): {
    mode: SmoothMode;
    absolute: boolean;
    hz: number;
    rawDeg: { alpha: number; beta: number; gamma: number };
    heading: number | null;
    gps: boolean;
    yawDeg: number;
    pitchDeg: number;
  } {
    look2.set(0, 0, -1).applyQuaternion(this.smoothQuat);
    return {
      mode: this.mode,
      absolute: this.absolute,
      hz: this.hz,
      rawDeg: { alpha: this.rawA, beta: this.rawB, gamma: this.rawG },
      heading: this.headingDeg,
      gps: this.latRad != null,
      yawDeg: Math.atan2(-look2.x, -look2.z) * RAD2DEG,
      pitchDeg: Math.asin(THREE.MathUtils.clamp(look2.y, -1, 1)) * RAD2DEG,
    };
  }

  /** Must be called from a user gesture (iOS requires a motion permission prompt). */
  async enable(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    // Best-effort GPS for real-sky registration; relative magic-window if denied/unsupported.
    void this.acquireLocation();
    this.handler = (e) => {
      // prefer the north-referenced stream once it has been seen (Android)
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
    this.hasSmooth = false; // snap to the first fix (no whip-pan from a stale direction)
    this.seeded = false;
    return true;
  }

  private acquireLocation(): void {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.latRad = pos.coords.latitude * DEG2RAD;
        this.lonRad = pos.coords.longitude * DEG2RAD; // east-positive
      },
      () => {
        /* declined/unavailable → stay in relative mode */
      },
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
    this.hasTarget = false;
    this.hasSmooth = false;
    this.seeded = false;
  }

  /**
   * Ease the displayed direction toward the latest sensor target. Call once per rendered frame
   * (BEFORE controls.update) with the frame delta-time in seconds.
   */
  update(dt: number): void {
    if (!this.enabled || !this.hasTarget || dt <= 0) return;

    // target as a roll-free orientation quaternion (camera is yaw/pitch only)
    const tPitch = Math.asin(THREE.MathUtils.clamp(this.targetDir.y, -1, 1));
    const tYaw = Math.atan2(-this.targetDir.x, -this.targetDir.z);
    quatFromYawPitch(tYaw, tPitch, this.targetQuat);

    if (!this.hasSmooth) {
      this.smoothQuat.copy(this.targetQuat); // snap to first fix — no whip-pan
      this.hasSmooth = true;
    } else {
      const cfg = PRESETS[this.mode];
      const ang = this.smoothQuat.angleTo(this.targetQuat); // radians of remaining motion
      // Jitter rejection: when essentially still, hold rock-steady (kills micro-vibration).
      if (ang > cfg.deadbandDeg * DEG2RAD) {
        // 1-Euro-style adaptive cutoff: smooth when slow, responsive when fast.
        const speed = ang / dt; // rad/s — how fast the target is moving right now
        const fc = cfg.fcMin + cfg.beta * speed; // Hz
        const tau = 1 / (TAU * fc); // filter time constant
        const alpha = THREE.MathUtils.clamp(dt / (tau + dt), 0, 1); // dt-corrected
        this.smoothQuat.slerp(this.targetQuat, alpha); // true shortest-path interpolation
      }
    }
    // drive the camera from the smoothed orientation
    look2.set(0, 0, -1).applyQuaternion(this.smoothQuat);
    const pitch = Math.asin(THREE.MathUtils.clamp(look2.y, -1, 1));
    const yaw = Math.atan2(-look2.x, -look2.z);
    this.controls.setYawPitch(yaw, pitch);
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // telemetry: raw angles + measured event rate (sensor events arrive irregularly)
    this.rawA = e.alpha;
    this.rawB = e.beta;
    this.rawG = e.gamma;
    const nowMs = Date.now();
    if (this.lastEvtMs) {
      const inst = 1000 / Math.max(1, nowMs - this.lastEvtMs);
      this.hz = this.hz ? this.hz * 0.9 + inst * 0.1 : inst; // smoothed Hz
    }
    this.lastEvtMs = nowMs;

    const orient = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) *
      Math.PI) /
      180;
    // gravity-referenced look as horizon ENU (pure; same path the unit tests drive)
    const { E: E0, N: N0, U: U0 } = deviceLookEnu(
      e.alpha * DEG2RAD,
      e.beta * DEG2RAD,
      e.gamma * DEG2RAD,
      orient,
    );

    // Compass heading (deg clockwise from true north): iOS exposes webkitCompassHeading;
    // Android's absolute stream has north-referenced alpha (0 = north, counter-clockwise).
    const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean };
    let headingDeg: number | null = null;
    if (typeof ev.webkitCompassHeading === 'number' && isFinite(ev.webkitCompassHeading)) {
      headingDeg = ev.webkitCompassHeading;
    } else if (ev.absolute) {
      headingDeg = (360 - e.alpha) % 360;
    }
    this.headingDeg = headingDeg;

    // ONE-TIME north seed: when the phone is roughly level the look azimuth ≈ the compass heading,
    // so capture the constant gyro→true-north offset once. We never feed the compass after that
    // (continuous heading jitter + the azimuth gimbal near the zenith were what made it spin).
    if (!this.seeded && headingDeg != null && Math.abs(U0) < 0.5) {
      const trueAz = (AZ_SIGN * headingDeg + AZ_OFFSET_DEG) * DEG2RAD;
      this.compassSeed = trueAz - Math.atan2(E0, N0);
      this.seeded = true;
    }

    const lst = this.lonRad != null ? lstRad(Date.now(), this.lonRad) : null;
    this.absolute = enuToSkyDir(
      E0,
      N0,
      U0,
      this.compassSeed + this.azOffsetUser,
      this.altOffsetUser,
      this.latRad,
      lst,
      this.targetDir,
    );
    this.hasTarget = true;
  }
}
