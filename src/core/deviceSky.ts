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
 *    shows the actual stars overhead, and it auto-switches north↔south by where you aim. This is
 *    the real "point at the sky" behaviour.
 *
 *  • RELATIVE (gyro only) — fallback when location/compass are denied or unsupported (e.g. desktop,
 *    or the user declines the location prompt). The view tracks how you move the phone but is not
 *    registered to true sky coordinates.
 *
 * Calibration note: ALTITUDE is exact (gravity is unambiguous). The AZIMUTH sign/offset is the one
 * value that can vary by device/OS; `AZ_SIGN`/`AZ_OFFSET_DEG` below are the single knobs to nudge
 * after a real-sky check (point at a known bright star and confirm). Defaults follow the iOS
 * `webkitCompassHeading` convention (degrees clockwise from true north).
 */

// --- azimuth calibration knobs (only these may need a tweak after an on-device sky check) ---
const AZ_SIGN = 1; // flip to -1 if the view turns the wrong way horizontally
const AZ_OFFSET_DEG = 0; // add a constant if north is consistently off by a fixed angle

const DEG2RAD = Math.PI / 180;

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X: look out the back
const quat = new THREE.Quaternion();
const look = new THREE.Vector3();
const worldDir = new THREE.Vector3();

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
  private latRad: number | null = null;
  private lonRad: number | null = null;

  constructor(private controls: LookControls) {}

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
    this.handler = (e) => this.onOrientation(e);
    addEventListener('deviceorientation', this.handler, true);
    this.enabled = true;
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
    this.handler = null;
    this.enabled = false;
    this.absolute = false;
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const orient = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) *
      Math.PI) /
      180;
    const q = deviceQuaternion(e.alpha * DEG2RAD, e.beta * DEG2RAD, e.gamma * DEG2RAD, orient);
    // look direction in the gravity-referenced frame (Y = zenith)
    look.set(0, 0, -1).applyQuaternion(q).normalize();

    // Compass heading (deg clockwise from true north): iOS exposes webkitCompassHeading;
    // Android exposes absolute alpha (0 = north, increasing counter-clockwise).
    const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean };
    let headingDeg: number | null = null;
    if (typeof ev.webkitCompassHeading === 'number' && isFinite(ev.webkitCompassHeading)) {
      headingDeg = ev.webkitCompassHeading;
    } else if (ev.absolute) {
      headingDeg = (360 - e.alpha) % 360;
    }

    if (headingDeg != null && this.latRad != null && this.lonRad != null) {
      // ABSOLUTE: altitude from gravity-referenced gyro, azimuth from compass → real RA/Dec.
      const alt = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1));
      const az = (AZ_SIGN * headingDeg + AZ_OFFSET_DEG) * DEG2RAD;
      const { ra, dec } = altAzToRaDec(alt, az, this.latRad, lstRad(Date.now(), this.lonRad));
      raDecToWorld(ra, dec, worldDir);
      const pitch = Math.asin(THREE.MathUtils.clamp(worldDir.y, -1, 1));
      const yaw = Math.atan2(-worldDir.x, -worldDir.z);
      this.controls.setYawPitch(yaw, pitch);
      this.absolute = true;
      return;
    }

    // RELATIVE magic-window (no GPS/compass): drive yaw/pitch straight from the look vector.
    this.absolute = false;
    const pitch = Math.asin(THREE.MathUtils.clamp(look.y, -1, 1));
    const yaw = Math.atan2(-look.x, -look.z);
    this.controls.setYawPitch(yaw, pitch);
  }
}
