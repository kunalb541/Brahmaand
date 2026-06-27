// Aladin Lite v3 is loaded via a CDN <script> tag (see index.html), exposing the global `A`.
// Minimal ambient typings for the subset of the API we use.

interface AladinInstance {
  setBaseImageLayer(layer: unknown): void;
  gotoRaDec(ra: number, dec: number): void;
  gotoObject(name: string, options?: Record<string, unknown>): void;
  animateToRaDec(ra: number, dec: number, durationSec: number): void;
  setFoV(fovDeg: number): void;
  getFov(): [number, number];
  getRaDec(): [number, number];
  pix2world(x: number, y: number, frame?: string): [number, number] | null;
  world2pix(lon: number, lat: number, frame?: string): [number, number] | null;
  setCooGrid(options: Record<string, unknown>): void;
  showHealpixGrid(show: boolean): void;
  addCatalog(catalog: unknown): void;
  addOverlay(overlay: unknown): void;
  removeLayer(layer: unknown): void;
  removeLayers(): void;
  setFrame(frame: string): void;
  getBaseImageLayer(): AladinImageLayer | null;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface AladinImageLayer {
  setBrightness?(value: number): void; // offset, ~[-1, 1], 0 = native
  setContrast?(value: number): void;
  setGamma?(value: number): void;
  setColormap?(name: string, options?: Record<string, unknown>): void;
}

interface AladinCatalog {
  addSources(sources: unknown[]): void;
  clear?(): void;
  setColor?(color: string): void;
  show?(): void;
  hide?(): void;
}
interface AladinOverlay {
  add(shape: unknown): void;
  addFootprints(shapes: unknown[]): void;
  removeAll?(): void;
  show?(): void;
  hide?(): void;
}

interface AladinStatic {
  init: Promise<void>;
  aladin(selector: string, options?: Record<string, unknown>): AladinInstance;
  HiPS(id: string, urlOrId: string, options?: Record<string, unknown>): unknown;
  catalog(options?: Record<string, unknown>): AladinCatalog;
  source(ra: number, dec: number, data?: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  marker(ra: number, dec: number, options?: Record<string, unknown>, data?: Record<string, unknown>): unknown;
  graphicOverlay(options?: Record<string, unknown>): AladinOverlay;
  polyline(radecArray: number[][], options?: Record<string, unknown>): unknown;
  circle(raDeg: number, decDeg: number, radiusDeg: number, options?: Record<string, unknown>): unknown;
}

declare const A: AladinStatic;
interface Window {
  A: AladinStatic;
}
