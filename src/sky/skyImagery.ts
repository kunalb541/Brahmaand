import * as THREE from 'three';
import { worldToRaDec } from '../math/frames';

/**
 * Deep-survey imagery via CDS hips2fits — as a plain DOM <img> overlay.
 *
 * hips2fits server-renders a TAN-projected JPEG of the requested field. We point a full-screen
 * <img> (object-fit: cover, centred on the view) at it: no WebGL, no tile compositing — exactly
 * like the cutout thumbnails elsewhere in the app. It sits above the WebGL sky and below the UI
 * panels (z-index 1) and is click-through, so panning/zooming still drives the 3D scene; we
 * refetch when the view centre or zoom changes enough.
 */

const MAX_FOV_DEG = 8; // wider than this, the all-sky base sphere is enough
const DEBOUNCE_MS = 140;
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const HOST = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits';

const fwd = new THREE.Vector3();
const rd = { raRad: 0, decRad: 0 };

export class SkyImagery {
  private el: HTMLImageElement;
  private spinner: HTMLDivElement;
  private cfg: { base: string } | null = null;
  private cur: { ra: number; dec: number; fov: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private aspect = 1;
  private earthView = true;

  // status (for the HUD)
  loadingState = false;
  hasImage = false;

  constructor() {
    this.el = document.createElement('img');
    this.el.alt = '';
    this.el.decoding = 'async';
    this.el.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;' +
      'pointer-events:none;opacity:0;transition:opacity .25s ease;display:none';
    this.el.addEventListener('load', () => {
      this.el.style.display = 'block';
      requestAnimationFrame(() => (this.el.style.opacity = '1'));
      this.loadingState = false;
      this.hasImage = true;
      this.spinner.style.display = 'none';
    });
    this.el.addEventListener('error', () => {
      this.loadingState = false;
      this.spinner.style.display = 'none';
    });
    document.body.appendChild(this.el);

    // server-rendered imagery can take several seconds — show a hint so the wait isn't blank
    this.spinner = document.createElement('div');
    this.spinner.textContent = '◌ rendering survey imagery…';
    this.spinner.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;pointer-events:none;' +
      'font:12px ui-monospace,monospace;color:#bcdcff;background:rgba(8,16,30,.7);border:1px solid rgba(120,170,255,.3);' +
      'border-radius:14px;padding:6px 14px;display:none';
    document.body.appendChild(this.spinner);
  }

  /** Survey HiPS base URL (or null to disable, e.g. the galactic-frame Milky Way base). */
  setConfig(cfg: { base: string } | null): void {
    const base = cfg?.base ?? null;
    if (base === (this.cfg?.base ?? null)) return;
    this.cfg = base ? { base } : null;
    this.clear();
  }

  setCenter(_v?: THREE.Vector3): void {
    /* no-op: this is a screen overlay, not a 3D object */
  }

  setVisible(on: boolean): void {
    this.earthView = on;
    if (!on) this.hide();
  }

  setExposure(mult: number): void {
    this.el.style.filter = `brightness(${mult.toFixed(3)})`;
  }

  clear(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.hide();
    this.cur = null;
    this.loadingState = false;
  }

  private hide(): void {
    this.el.style.opacity = '0';
    this.el.style.display = 'none';
    this.spinner.style.display = 'none';
    this.hasImage = false;
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.cfg || !this.earthView) {
      this.hide();
      return;
    }
    const fov = camera.fov;
    if (fov > MAX_FOV_DEG) {
      this.hide(); // wide view → base sphere covers it
      return;
    }
    this.aspect = camera.aspect || 1;
    camera.getWorldDirection(fwd);
    worldToRaDec(fwd, rd);
    const ra = (((rd.raRad * RAD2DEG) % 360) + 360) % 360;
    const dec = rd.decRad * RAD2DEG;
    if (this.needFetch(ra, dec, fov)) this.schedule(ra, dec, fov);
    else if (this.hasImage) this.el.style.display = 'block';
  }

  private needFetch(ra: number, dec: number, fov: number): boolean {
    if (!this.cur) return true;
    if (sepDeg(ra, dec, this.cur.ra, this.cur.dec) > this.cur.fov * 0.18) return true;
    const r = fov / this.cur.fov;
    return r < 0.66 || r > 1.5;
  }

  private schedule(ra: number, dec: number, fov: number): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fetch(ra, dec, fov);
    }, DEBOUNCE_MS);
  }

  private fetch(ra: number, dec: number, fov: number): void {
    if (!this.cfg) return;
    // square image; fov matches the view's horizontal extent, object-fit:cover fills the viewport
    const imgFov = Math.min(MAX_FOV_DEG * 1.2, fov * Math.max(this.aspect, 1));
    const url =
      `${HOST}?hips=${encodeURIComponent(this.cfg.base)}` +
      `&ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${imgFov.toFixed(5)}` +
      `&width=900&height=900&projection=TAN&coordsys=icrs&format=jpg`;
    this.cur = { ra, dec, fov };
    this.loadingState = true;
    if (!this.hasImage) this.spinner.style.display = 'block'; // only on first load, not on pan refresh
    this.el.src = url; // the 'load' listener reveals it
  }
}

function sepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const a =
    Math.sin(dec1 * DEG2RAD) * Math.sin(dec2 * DEG2RAD) +
    Math.cos(dec1 * DEG2RAD) * Math.cos(dec2 * DEG2RAD) * Math.cos((ra1 - ra2) * DEG2RAD);
  return Math.acos(Math.max(-1, Math.min(1, a))) * RAD2DEG;
}
