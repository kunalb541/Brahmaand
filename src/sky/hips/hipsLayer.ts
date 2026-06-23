import * as THREE from 'three';
import { SKY_RADIUS } from '../skySphere';
import { cellCornersWorld, pickOrder, visibleCells } from './healpixWorld';
import { buildTileGeometry } from './tileGeometry';
import { tileUrl } from './tileUrl';

export interface HipsConfig {
  base: string;
  format: string; // 'jpeg' | 'png' | 'webp'
  maxOrder: number;
}

type TileState = 'loading' | 'ready' | 'missing';
interface Tile {
  order: number;
  npix: number;
  state: TileState;
  mesh?: THREE.Mesh;
  texture?: THREE.Texture;
  lastWanted: number;
  abort?: AbortController;
  fadeStart: number; // performance.now() at residency; drives the fade-in
}

const FADE_MS = 250;

const SUBDIV = 4;
const MIN_STREAM_ORDER = 6; // below this the 4k equirect base is sharp enough
const MAX_CONCURRENT = 8;
const MAX_TILES = 320;
const KEEP_FRAMES = 90;
const RADIUS = SKY_RADIUS * 0.999;

const fwd = new THREE.Vector3();
const camPos = new THREE.Vector3();
const ndc = new THREE.Vector3();

/**
 * Streams real HiPS tiles for the active (equatorial) survey and overlays them on the
 * base equirect sphere, so zooming in progressively sharpens to survey resolution.
 * Current implementation uses per-tile meshes/textures (no texture-array pool), main-
 * thread decode (no worker), and no MOC/mirror-failover; these remain possible future optimisations.
 */
export class HipsLayer {
  private group = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private inFlight = 0;
  private frame = 0;
  private cfg: HipsConfig | null = null;
  private exposure = 1; // brightness multiplier on tile materials (driven by the exposure slider)
  /** current LOD order, exposed for the HUD */
  order = 0;
  tileCount = 0;
  /** Tiles fully loaded / confirmed absent (404 = outside the survey's sky coverage). */
  readyCount = 0;
  missingCount = 0;

  private zeroCounts(): void {
    this.tileCount = 0;
    this.readyCount = 0;
    this.missingCount = 0;
  }

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = -90;
    scene.add(this.group);
  }

  /** Switch survey (or null to disable streaming, e.g. for a galactic-frame survey). */
  setConfig(cfg: HipsConfig | null): void {
    if (cfg?.base === this.cfg?.base) return;
    this.cfg = cfg;
    this.clearAll();
  }

  /** Recenter the tile group on the camera (so tiles stay "at infinity" during flight). */
  setCenter(v: THREE.Vector3): void {
    this.group.position.copy(v);
  }

  /** Brightness multiplier for the survey tiles (the exposure slider). HiPS imagery is faint —
   *  without this, deep-survey tiles render near-black (only the boosted base sphere was lit). */
  setExposure(mult: number): void {
    this.exposure = mult;
    for (const t of this.tiles.values()) {
      if (t.mesh) (t.mesh.material as THREE.MeshBasicMaterial).color.setScalar(mult);
    }
  }

  /** Show/hide the whole tile layer (suspended once you fly away from Earth). */
  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  /** Drop all tiles (called when leaving planetarium mode). */
  clear(): void {
    this.clearAll();
    this.zeroCounts();
  }

  private key(order: number, npix: number): string {
    return `${order}/${npix}`;
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.cfg) {
      this.order = 0;
      this.zeroCounts();
      return;
    }
    this.frame++;

    const fovYRad = (camera.fov * Math.PI) / 180;
    // pickOrder must use the ACTUAL rendered pixel height. The renderer draws at
    // setPixelRatio(min(dpr,2)), so on a retina screen CSS innerHeight is half the real
    // resolution and tiles come out ~one order too coarse — bilinear-magnified into mush.
    const renderPx = window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
    const order = pickOrder(fovYRad, renderPx, 3, this.cfg.maxOrder);
    this.order = order;

    if (order < MIN_STREAM_ORDER) {
      if (this.tiles.size) this.clearAll();
      this.zeroCounts();
      return;
    }

    // bounding cone of the view (4 NDC corner rays vs forward axis)
    camera.getWorldDirection(fwd);
    camera.getWorldPosition(camPos);
    let cosHalf = 1;
    for (const [nx, ny] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ndc.set(nx!, ny!, 0.5).unproject(camera).sub(camPos).normalize();
      cosHalf = Math.min(cosHalf, fwd.dot(ndc));
    }
    const halfAngle = Math.acos(THREE.MathUtils.clamp(cosHalf, -1, 1));

    const want = visibleCells(order, fwd, halfAngle);
    for (const npix of want) this.ensureTile(order, npix);

    this.prune(order);
    this.updateFades();
    this.tileCount = this.tiles.size;
    let ready = 0;
    let missing = 0;
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') ready++;
      else if (t.state === 'missing') missing++;
    }
    this.readyCount = ready;
    this.missingCount = missing;
  }

  /** Advance per-tile fade-in (smooth appearance instead of pops). Cheap: only mutates
   *  materials still fading. */
  private updateFades(): void {
    const now = performance.now();
    for (const t of this.tiles.values()) {
      if (!t.mesh) continue;
      const mat = t.mesh.material as THREE.MeshBasicMaterial;
      if (mat.opacity < 1) {
        mat.opacity = Math.min(1, (now - t.fadeStart) / FADE_MS);
      }
    }
  }

  private ensureTile(order: number, npix: number): void {
    const k = this.key(order, npix);
    let t = this.tiles.get(k);
    if (t) {
      t.lastWanted = this.frame;
      return;
    }
    t = { order, npix, state: 'loading', lastWanted: this.frame, fadeStart: 0 };
    this.tiles.set(k, t);
    this.tryFetch(t);
  }

  private tryFetch(t: Tile): void {
    if (this.inFlight >= MAX_CONCURRENT || !this.cfg) return;
    this.inFlight++;
    const url = tileUrl(this.cfg.base, t.order, t.npix, this.cfg.format);
    const ac = new AbortController();
    t.abort = ac;

    fetch(url, { mode: 'cors', signal: ac.signal })
      .then(async (r) => {
        if (r.status === 404) {
          t.state = 'missing';
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bmp = await createImageBitmap(await r.blob());
        if (this.tiles.get(this.key(t.order, t.npix)) !== t) {
          bmp.close();
          return; // evicted (and possibly replaced) while loading — guard on identity, not key presence
        }
        this.buildMesh(t, bmp);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') t.state = 'missing';
      })
      .finally(() => {
        this.inFlight--;
        this.pumpQueue();
      });
  }

  /** Kick any still-loading tiles that were waiting on a concurrency slot. */
  private pumpQueue(): void {
    if (this.inFlight >= MAX_CONCURRENT) return;
    for (const t of this.tiles.values()) {
      if (t.state === 'loading' && !t.abort) {
        this.tryFetch(t);
        if (this.inFlight >= MAX_CONCURRENT) return;
      }
    }
  }

  private buildMesh(t: Tile, bmp: ImageBitmap): void {
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8; // match the base sphere; sharpens tiles toward the sphere edges
    tex.flipY = false;
    tex.needsUpdate = true;

    const corners = cellCornersWorld(t.order, t.npix);
    const geo = buildTileGeometry(corners, SUBDIV, RADIUS);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color().setScalar(this.exposure), // brightness (exposure slider)
      side: THREE.DoubleSide, // winding-agnostic; tiles are viewed from the sphere centre
      depthTest: false,
      depthWrite: false,
      transparent: true, // PNG no-coverage alpha lets the DSS2 base composite through
      opacity: 0, // fades in (§ FADE_MS) to avoid pops
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -90 + t.order; // higher orders draw on top
    mesh.frustumCulled = false;

    t.mesh = mesh;
    t.texture = tex;
    t.state = 'ready';
    t.fadeStart = performance.now();
    this.group.add(mesh);
  }

  private prune(_currentOrder: number): void {
    const overCap = this.tiles.size > MAX_TILES;
    for (const [k, t] of this.tiles) {
      const stale = this.frame - t.lastWanted;
      // Keep recently-wanted tiles of any order: lower-order tiles act as a coarse
      // fallback that fills gaps while the current order streams in (avoids black holes).
      if (stale > KEEP_FRAMES || (overCap && stale > 0)) {
        this.disposeTile(k, t);
      }
    }
  }

  private disposeTile(k: string, t: Tile): void {
    t.abort?.abort();
    if (t.mesh) {
      this.group.remove(t.mesh);
      (t.mesh.material as THREE.Material).dispose();
      t.mesh.geometry.dispose();
    }
    t.texture?.dispose();
    this.tiles.delete(k);
  }

  private clearAll(): void {
    for (const [k, t] of this.tiles) this.disposeTile(k, t);
    this.tiles.clear();
  }
}
