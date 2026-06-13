import * as THREE from 'three';
import type { LookControls } from './lookControls';
import { raDecToWorld } from '../math/frames';

/**
 * Phone "magic window": move the phone and the view follows the real sky.
 *
 * Two modes, picked automatically:
 *
 *  • ABSOLUTE (GPS + compass) — when device location and a compass heading are available, the
 *    app computes where each look direction points on the *real* celestial sphere:
 *    altitude (from the gravity-referenced gyro) + azimuth (from the compass) + your GPS
 *    latitude/longitude + the current Local Sidereal Time → (RA, Dec). Hold the phone up and it
 *    shows the actual stars overhead, and it auto-switches north↔south by where you aim.
 *
 *  • RELATIVE (gyro only) — fallback when location/compass are denied or unsupported. The view
 *    tracks how you move the phone but is not registered to true sky coordinates.
 *
 * SMOOTHNESS (Star-Walk-like): raw `deviceorientation` events are noisy and arrive at sensor
 * rate, so driving the camera per-event looks shaky. Instead, each event only updates a TARGET
 * look direction; `update(dt)` (called from the render loop) eases the displayed direction toward
 * the target with a dt-corrected exponential filter, alpha = 1 − exp(−dt/τ). Easing the 3-D look
 * VECTOR (normalized lerp) rather than scalar yaw/pitch avoids the yaw ±π wraparound glitch.
 * τ ≈ 0.12 s for the gyro-only path; the compass-fused absolute path uses a longer τ (compass
 * heading jitters more), trading a touch of lag for stability — same trick planetarium apps use.
 *
 * Calibration note: ALTITUDE is exact (gravity is unambiguous). The AZIMUTH sign/offset is the one
 * value that can vary by device/OS; `AZ_SIGN`/`AZ_OFFSET_DEG` below are the single knobs to nudge
 * after a real-sky check (point at a known bright star and confirm). Defaults follow the iOS
 * `webkitCompassHeading` convention (degrees clockwise from true north).
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
const top = new THREE.Vector3();
const worldDir = new THREE.Vector3();

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

/**
 * Horizon (altitude, azimuth-from-north-through-east) → equatorial (RA, Dec), both radians,
 * for an observer at latitude `lat` and local sidereal time `lst`.
 */
function altAzToRaDec(alt: number, az: number, lat: number, lst: number): { ra: number; dec: number } {
  const sinDec = Math.sin(lat) * Math.sin(alt) + Math.cos(lat) * Math.cos(alt) * Math.cos(az);
  const dec = Math.asin(THREE.MathUtils.clamp(sinDec, -1, 1));
  const cosDec = Math.cos(dec) || 1e-9;
  const sinH = (-Math.sin(az) * Math.cos(alt)) / cosDec;
  const cosH = (Math.sin(alt) - Math.sin(lat) * sinDec) / (Math.cos(lat) * cosDec || 1e-9);
  const h = Math.atan2(sinH, cosH); // hour angle
  let ra = lst - h;
  ra = ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { ra, dec };
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
  private compassOffset = 0;
  private hasOffset = false;

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
    this.hasOffset = false;
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
    this.hasOffset = false;
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
    const q = deviceQuaternion(e.alpha * DEG2RAD, e.beta * DEG2RAD, e.gamma * DEG2RAD, orient);
    // look direction in the gravity-referenced frame (X = east-ish, Y = zenith, −Z = north-ish)
    look.set(0, 0, -1).applyQuaternion(q).normalize();
    // azimuths IN THE GYRO FRAME (north through east) — continuous over the full sphere
    const azLookGyro = Math.atan2(look.x, -look.z);
    top.set(0, 1, 0).applyQuaternion(q).normalize();
    const azTopGyro = Math.atan2(top.x, -top.z);

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

    // Update the gyro→north offset only while the device TOP is far enough from vertical for
    // its horizontal compass projection to mean something (|top.y| < 0.7 ≈ tilted < 45°).
    // While you then sweep the raised phone across the sky, the offset just holds steady.
    if (headingDeg != null && Math.abs(top.y) < 0.7) {
      const headingRad = (AZ_SIGN * headingDeg + AZ_OFFSET_DEG) * DEG2RAD;
      let d = headingRad - azTopGyro - this.compassOffset;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to ±π
      this.compassOffset += (this.hasOffset ? PRESETS[this.mode].compassLp : 1) * d; // snap first, then low-pass
      this.hasOffset = true;
    }

    if (this.hasOffset && this.latRad != null && this.lonRad != null) {
      // ABSOLUTE: altitude AND azimuth both from the continuous gyro quaternion (so a full
      // 360° sweep and tilting through the zenith track correctly); the compass only anchors
      // the frame to true north via the low-passed offset above. → real RA/Dec.
      const alt = THREE.MathUtils.clamp(
        Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)) + this.altOffsetUser,
        -Math.PI / 2,
        Math.PI / 2,
      );
      const az = azLookGyro + this.compassOffset + this.azOffsetUser;
      const { ra, dec } = altAzToRaDec(alt, az, this.latRad, lstRad(Date.now(), this.lonRad));
      raDecToWorld(ra, dec, worldDir);
      this.targetDir.copy(worldDir);
      this.absolute = true;
    } else {
      // RELATIVE magic-window (no GPS/compass): target straight from the device look vector.
      this.absolute = false;
      this.targetDir.copy(look);
    }
    this.hasTarget = true;
  }
}
