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

export class AtlasView {
  private al: AladinInstance | null = null;
  ready = false;
  private onIdentify: (raDeg: number, decDeg: number) => void;
  // state applied once the WASM engine has initialised
  private pendingSurvey: SurveyEntry;
  private pendingGoto: [number, number, number] | null = null;
  private gridOn = false;
  // lazily-built overlays (constellation figures, IAU boundaries, Messier catalogue) + their
  // wanted on/off state, re-applied once the engine is ready.
  private overlays: { const?: AladinOverlay; bounds?: AladinOverlay; messier?: AladinCatalog } = {};
  private want = { const: false, bounds: false, messier: false };

  constructor(container: string, initial: SurveyEntry, onIdentify: (raDeg: number, decDeg: number) => void) {
    this.onIdentify = onIdentify;
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
        this.setSurvey(this.pendingSurvey); // apply the latest requested survey (+ any field-survey fly)
        if (this.gridOn) this.setGrid(true);
        if (this.want.const) void this.setConstellations(true);
        if (this.want.bounds) void this.setBoundaries(true);
        if (this.want.messier) void this.setMessier(true);
        if (this.pendingGoto) this.goto(...this.pendingGoto);
      })
      .catch((e) => console.warn('[atlas] Aladin Lite failed to init', e));
  }

  private wireClicks(): void {
    const al = this.al!;
    // a catalogue source / marker (e.g. Messier) was clicked
    al.on('objectClicked', (o: unknown) => {
      const s = o as { ra?: number; dec?: number } | null;
      if (s && typeof s.ra === 'number' && typeof s.dec === 'number') this.onIdentify(s.ra, s.dec);
    });
    // empty-sky click → identify what's at that pixel
    al.on('click', (e: unknown) => {
      const me = e as { offsetX?: number; offsetY?: number } | null;
      if (!me || me.offsetX == null || me.offsetY == null) return;
      const rd = al.pix2world(me.offsetX, me.offsetY);
      if (rd) this.onIdentify(rd[0], rd[1]);
    });
  }

  /** Swap the displayed survey and, for the showcase field surveys, fly to their target. */
  setSurvey(entry: SurveyEntry): void {
    this.pendingSurvey = entry;
    if (!this.al) return;
    this.al.setBaseImageLayer(hipsFor(entry));
    if (entry.target) this.goto(entry.target.raDeg, entry.target.decDeg, entry.target.fovDeg);
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
}
