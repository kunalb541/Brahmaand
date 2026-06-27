import type { SurveyEntry } from '../config/surveys';

/**
 * Atlas view — the interactive 2D sky-atlas, backed by CDS Aladin Lite v3 (loaded via the CDN
 * <script> in index.html as the global `A`). Aladin streams the survey HiPS with smooth GPU
 * pan/zoom; we drive it from the existing survey switcher / search and feed clicks back into the
 * existing SIMBAD object panel. It lives in its own div over the (hidden) Three.js canvas.
 */

const MELLINGER = 'CDS/P/Mellinger/color'; // Aladin handles the galactic-frame HiPS natively
const DSS2 = 'CDS/P/DSS2/color';

/** The HiPS Aladin should load for a survey: the app's alasky base URL, else a CDS id fallback. */
function hipsFor(entry: SurveyEntry): string {
  if (entry.hips?.base) return entry.hips.base;
  if (entry.id === 'mellinger') return MELLINGER;
  return DSS2;
}

/** Show/hide an Aladin overlay or catalogue (both expose optional show()/hide() in v3). */
function toggle(layer: { show?(): void; hide?(): void } | undefined, on: boolean): void {
  if (!layer) return;
  if (on) layer.show?.();
  else layer.hide?.();
}

/** A point in a marker layer: ICRS degrees, an optional label and per-source data (read on click). */
export interface MarkerPoint {
  raDeg: number;
  decDeg: number;
  label?: string;
  data?: Record<string, unknown>;
}
interface LayerOpts {
  size?: number;
  shape?: string;
  labels?: boolean;
}

export class AtlasView {
  private al: AladinInstance | null = null;
  ready = false;
  private onPick: (raDeg: number, decDeg: number, data?: Record<string, unknown>) => void;
  private onView: (() => void) | undefined;
  // state applied once the WASM engine has initialised
  private pendingSurvey: SurveyEntry;
  private pendingGoto: [number, number, number] | null = null;
  private gridOn = false;
  // lazily-built overlays (constellation figures, IAU boundaries, Messier catalogue) + their
  // wanted on/off state, re-applied once the engine is ready.
  private overlays: { const?: AladinOverlay; bounds?: AladinOverlay; messier?: AladinCatalog } = {};
  private want = { const: false, bounds: false, messier: false };
  // generic marker layers (VizieR catalogues, transient groups, star labels, solar bodies): one
  // Aladin catalogue per id, updated in place (clear + addSources). Buffered until the engine is up.
  private layers = new Map<string, AladinCatalog>();
  private pendingLayers = new Map<string, { color: string; points: MarkerPoint[]; opts?: LayerOpts }>();
  // generic polyline layers (ecliptic / galactic / horizon grids): one graphic overlay per id.
  private lineLayers = new Map<string, AladinOverlay>();
  private pendingLines = new Map<string, { color: string; lineWidth: number; lines: number[][][] }>();
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private lastObjClickMs = 0;
  private exposureStops = 0;
  private fovOverlay: AladinOverlay | null = null;
  private fovDiam: number | null = null;

  constructor(
    container: string,
    initial: SurveyEntry,
    onPick: (raDeg: number, decDeg: number, data?: Record<string, unknown>) => void,
    onView?: () => void,
  ) {
    this.onPick = onPick;
    this.onView = onView;
    this.pendingSurvey = initial;
    A.init
      .then(() => {
        this.al = A.aladin(container, {
          survey: hipsFor(initial),
          fov: 60,
          projection: 'SIN',
          cooFrame: 'ICRS',
          showReticle: false,
          showSimbadPointerControl: false,
          showFullscreenControl: false,
          showShareControl: false,
          showCooGridControl: false,
          showProjectionControl: false,
          showFrame: false,
          showCooLocation: false, // the app shows RA/Dec in its own status bar
          showFov: false,
          showLayersControl: false,
        });
        this.ready = true;
        this.wireClicks();
        this.wireView();
        this.setSurvey(this.pendingSurvey); // apply the latest requested survey (+ any field-survey fly)
        if (this.gridOn) this.setGrid(true);
        if (this.want.const) void this.setConstellations(true);
        if (this.want.bounds) void this.setBoundaries(true);
        if (this.want.messier) void this.setMessier(true);
        for (const [id, l] of this.pendingLayers) this.setLayer(id, l.color, l.points, l.opts);
        this.pendingLayers.clear();
        for (const [id, l] of this.pendingLines) this.setLines(id, l.color, l.lineWidth, l.lines);
        this.pendingLines.clear();
        this.applyExposure();
        if (this.fovDiam != null) this.setFovCircle(this.fovDiam);
        if (this.pendingGoto) this.goto(...this.pendingGoto);
      })
      .catch((e) => console.warn('[atlas] Aladin Lite failed to init', e));
  }

  private wireClicks(): void {
    const al = this.al!;
    // A catalogue source / marker (Messier, a VizieR source, a transient, a planet, a star label)
    // was clicked. Its `data` (set in setLayer) lets the app route the click — e.g. a transient oid
    // opens its light curve. Aladin fires BOTH 'objectClicked' (first) and a plain 'click' for the
    // same gesture, so stamp the time and let the click handler below ignore the duplicate.
    al.on('objectClicked', (o: unknown) => {
      const s = o as { ra?: number; dec?: number; data?: Record<string, unknown> } | null;
      if (s && typeof s.ra === 'number' && typeof s.dec === 'number') {
        this.lastObjClickMs = performance.now();
        this.onPick(s.ra, s.dec, s.data);
      }
    });
    // Empty-sky click → identify whatever is there. The v3 'click' event carries ra/dec directly
    // (NOT offsetX/offsetY — the previous bug); skip drags and clicks already handled as a source.
    al.on('click', (e: unknown) => {
      const c = e as { ra?: number; dec?: number; isDragging?: boolean } | null;
      if (!c || c.isDragging || typeof c.ra !== 'number' || typeof c.dec !== 'number') return;
      if (performance.now() - this.lastObjClickMs < 400) return;
      this.onPick(c.ra, c.dec);
    });
  }

  /** Notify the app (debounced) when the user pans/zooms, so view-scoped layers can re-query. */
  private wireView(): void {
    const al = this.al!;
    const fire = (): void => {
      if (!this.onView) return;
      if (this.viewTimer) clearTimeout(this.viewTimer);
      this.viewTimer = setTimeout(() => this.onView?.(), 350);
    };
    al.on('positionChanged', fire);
    al.on('zoomChanged', fire);
  }

  /** Swap the displayed survey and, for the showcase field surveys, fly to their target. */
  setSurvey(entry: SurveyEntry): void {
    this.pendingSurvey = entry;
    if (!this.al) return;
    this.al.setBaseImageLayer(hipsFor(entry));
    this.applyExposure(); // the new base layer resets to native brightness — re-apply the slider
    if (entry.target) this.goto(entry.target.raDeg, entry.target.decDeg, entry.target.fovDeg);
  }

  /** Exposure slider → Aladin base-layer brightness (stops [-3,3] → brightness offset [-1,1]). */
  setExposure(stops: number): void {
    this.exposureStops = stops;
    this.applyExposure();
  }
  private applyExposure(): void {
    this.al?.getBaseImageLayer?.()?.setBrightness?.(Math.max(-1, Math.min(1, this.exposureStops / 3)));
  }

  /** Eyepiece/detector framing circle of a TRUE angular diameter at the view centre (null = off). */
  setFovCircle(diamDeg: number | null): void {
    this.fovDiam = diamDeg;
    if (!this.al) return;
    if (!this.fovOverlay) {
      this.fovOverlay = A.graphicOverlay({ color: 'rgb(111,227,255)', lineWidth: 1.5 });
      this.al.addOverlay(this.fovOverlay);
    }
    this.fovOverlay.removeAll?.();
    if (diamDeg == null) return;
    const [ra, dec] = this.al.getRaDec();
    this.fovOverlay.add(A.circle(ra, dec, diamDeg / 2));
  }
  /** Re-centre the framing circle after a pan/zoom. */
  refreshFovCircle(): void {
    if (this.fovDiam != null) this.setFovCircle(this.fovDiam);
  }

  /** Point the view at an ICRS position (degrees), optionally setting the field of view. */
  goto(raDeg: number, decDeg: number, fovDeg?: number): void {
    if (!this.al) {
      this.pendingGoto = [raDeg, decDeg, fovDeg ?? 1];
      return;
    }
    this.al.gotoRaDec(raDeg, decDeg);
    if (fovDeg) this.al.setFoV(fovDeg);
  }

  /** Current view centre + width, for handing off to the Three.js camera when switching modes. */
  getView(): { raDeg: number; decDeg: number; fovDeg: number } | null {
    if (!this.al) return null;
    const [raDeg, decDeg] = this.al.getRaDec();
    const [fovDeg] = this.al.getFov();
    return { raDeg, decDeg, fovDeg };
  }

  setGrid(on: boolean): void {
    this.gridOn = on;
    this.al?.setCooGrid({ enabled: on, color: 'rgb(120,160,220)', opacity: 0.5 });
  }

  /**
   * Create or update a marker layer (one Aladin catalogue per id). Re-callable to refresh contents
   * in place. Sources carry optional per-source `data` (read back on click) and `label`.
   */
  setLayer(id: string, color: string, points: MarkerPoint[], opts?: LayerOpts): void {
    if (!this.al) {
      this.pendingLayers.set(id, { color, points, opts });
      return;
    }
    let cat = this.layers.get(id);
    if (!cat) {
      cat = A.catalog({
        name: id,
        color,
        sourceSize: opts?.size ?? 9,
        shape: opts?.shape ?? 'circle',
        displayLabel: !!opts?.labels,
        labelColumn: 'label',
        labelColor: color,
        labelFont: '11px sans-serif',
      });
      this.al.addCatalog(cat);
      this.layers.set(id, cat);
    } else {
      cat.clear?.();
      cat.setColor?.(color);
      cat.show?.();
    }
    cat.addSources(
      points.map((p) => A.source(p.raDeg, p.decDeg, { ...(p.data ?? {}), label: p.label ?? '' })),
    );
  }

  /** Remove a marker layer entirely (toggled off). */
  removeLayer(id: string): void {
    this.pendingLayers.delete(id);
    const cat = this.layers.get(id);
    if (!cat) return;
    try {
      this.al?.removeLayer(cat);
    } catch {
      cat.hide?.();
    }
    this.layers.delete(id);
  }

  /** Show/hide a marker layer without dropping it (e.g. transient legend group filters). */
  hideLayer(id: string, hidden: boolean): void {
    toggle(this.layers.get(id), !hidden);
  }

  /** Create or replace a polyline layer (ecliptic / galactic / horizon grids). `lines` are arrays
   *  of [raDeg, decDeg] vertices. Re-callable to refresh (e.g. the horizon as time/location change). */
  setLines(id: string, color: string, lineWidth: number, lines: number[][][]): void {
    if (!this.al) {
      this.pendingLines.set(id, { color, lineWidth, lines });
      return;
    }
    let ov = this.lineLayers.get(id);
    if (!ov) {
      ov = A.graphicOverlay({ color, lineWidth });
      this.al.addOverlay(ov);
      this.lineLayers.set(id, ov);
    } else {
      ov.removeAll?.();
      ov.show?.();
    }
    for (const line of lines) if (line.length > 1) ov.add(A.polyline(line));
  }

  removeLines(id: string): void {
    this.pendingLines.delete(id);
    const ov = this.lineLayers.get(id);
    if (!ov) return;
    try {
      this.al?.removeLayer(ov);
    } catch {
      ov.hide?.();
    }
    this.lineLayers.delete(id);
  }

  /** Constellation stick-figures, drawn from the same GeoJSON the 3D scene uses. */
  async setConstellations(on: boolean): Promise<void> {
    this.want.const = on;
    if (!this.al) return;
    if (on && !this.overlays.const) {
      this.overlays.const = await this.buildLines('data/constellations.lines.json', 'rgb(86,138,205)', 1.4);
    }
    toggle(this.overlays.const, on);
  }

  /** IAU constellation boundaries. */
  async setBoundaries(on: boolean): Promise<void> {
    this.want.bounds = on;
    if (!this.al) return;
    if (on && !this.overlays.bounds) {
      this.overlays.bounds = await this.buildLines('data/constellations.bounds.json', 'rgba(120,110,160,0.55)', 0.8);
    }
    toggle(this.overlays.bounds, on);
  }

  /** Messier catalogue markers+labels; clicking one routes through `objectClicked` → identify. */
  async setMessier(on: boolean): Promise<void> {
    this.want.messier = on;
    if (!this.al) return;
    if (on && !this.overlays.messier) {
      this.overlays.messier = await this.buildMessier('data/messier.json');
    }
    toggle(this.overlays.messier, on);
  }

  /** Build a graphic overlay of polylines from a constellations.* GeoJSON (lines or boundaries). */
  private async buildLines(url: string, color: string, lineWidth: number): Promise<AladinOverlay> {
    const ov = A.graphicOverlay({ color, lineWidth });
    this.al!.addOverlay(ov);
    try {
      const gj = (await (await fetch(url)).json()) as {
        features: { geometry: { type: string; coordinates: number[][][] } }[];
      };
      for (const f of gj.features) {
        const g = f.geometry;
        if (g.type !== 'MultiLineString' && g.type !== 'Polygon') continue;
        for (const line of g.coordinates) {
          // GeoJSON is [lon=RA, lat=Dec] in degrees (RA may be negative; Aladin wraps it).
          const pts = line.map(([ra, dec]) => [ra, dec]);
          if (pts.length > 1) ov.add(A.polyline(pts));
        }
      }
    } catch (e) {
      console.warn('[atlas] overlay load failed', url, e);
    }
    return ov;
  }

  private async buildMessier(url: string): Promise<AladinCatalog> {
    const cat = A.catalog({
      name: 'Messier',
      sourceSize: 16,
      color: 'rgb(150,210,180)',
      shape: 'circle',
      displayLabel: true,
      labelColumn: 'id',
      labelColor: 'rgb(150,210,180)',
      labelFont: '11px sans-serif',
    });
    this.al!.addCatalog(cat);
    try {
      const data = (await (await fetch(url)).json()) as {
        objects: { m: number; ra: number; dec: number; otype?: string }[];
      };
      cat.addSources(
        data.objects.map((o) => A.source(o.ra, o.dec, { id: `M${o.m}`, otype: o.otype ?? '' })),
      );
    } catch (e) {
      console.warn('[atlas] Messier load failed', e);
    }
    return cat;
  }

  /** The survey currently shown (so the survey switcher and Three.js stay in sync). */
  get survey(): SurveyEntry {
    return this.pendingSurvey;
  }

  /** The underlying Aladin instance (debug/diagnostics only). */
  get instance(): AladinInstance | null {
    return this.al;
  }
}
