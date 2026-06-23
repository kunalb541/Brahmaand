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

export class AtlasView {
  private al: AladinInstance | null = null;
  ready = false;
  private onIdentify: (raDeg: number, decDeg: number) => void;
  // state applied once the WASM engine has initialised
  private pendingSurvey: SurveyEntry;
  private pendingGoto: [number, number, number] | null = null;
  private gridOn = false;

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

  /** The survey currently shown (so the survey switcher and Three.js stay in sync). */
  get survey(): SurveyEntry {
    return this.pendingSurvey;
  }
}
