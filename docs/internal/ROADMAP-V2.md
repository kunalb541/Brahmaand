# ROADMAP V2 — Brahmaand Pro: research-grade, real-time, web + native iPhone app

```yaml
doc: ROADMAP-V2
date: 2026-06-12
status: plan (v1 app is built & verified — see ROADMAP.md for what shipped)
audience: product owner + implementing engineer/AI
goal: |
  Turn the working v1 demo into a professional astronomers' tool:
  (1) BOTH a web app and an actual installable iPhone app (one engine, two targets)
  (2) telescope-resolution imagery with buttery zoom
  (3) real-time data (alerts, ephemerides) with push notifications
  (4) serious research features (FITS, multiwavelength, planning, export)
  (5) full-sky coverage strategy (north + south hemispheres)
verified: every survey order/coverage number below was live-queried from the CDS
  MocServer on 2026-06-12; broker/API behaviour from earlier live probes (docs/DECISIONS.md)
```

---

## 0. Product strategy: one engine, two products

**Decision: do BOTH web and native, from one codebase.** The TypeScript/Three.js engine is
proven (sky, HiPS streaming, 748k stars, transients — all verified). We ship it two ways:

| Target | How | What it gives |
|---|---|---|
| **Web** (exists) | Vite build → GitHub/Cloudflare Pages | Zero-install reach, shareable links to any object/view, works on every desktop |
| **iPhone/iPad app** | **Capacitor** shell (WKWebView + native plugins) → Xcode → App Store | A real installable app: **push notifications** (transient alerts!), **ARKit/CoreMotion "point at the sky"**, **Core Location** (observation planning), **offline catalogs**, **no CORS limits** (native fetch bridge → call ESA/any archive directly), App Store presence |
| *(gate, later)* | Native Metal core or Unity | Only if profiling on real devices shows WKWebView WebGL can't hold 60–120 fps, or when targeting Vision Pro / Quest native VR |

Why not a from-scratch Swift/Metal rewrite now: it discards a verified renderer and ~all of the
data layer for a months-long rebuild before any new science feature lands. Capacitor gets an App
Store app in days, native capabilities included; the Metal/Unity decision stays open and cheap to
take later because the renderer is already isolated behind `createRenderer()` + module seams.

**iPhone today (no $99 yet):** Capacitor → open in Xcode → free-provisioning sideload to your own
iPhone the same day (7-day re-sign on free accounts). **App Store / TestFlight** needs the Apple
Developer Program ($99/yr) — required for push notifications too.

---

## 1. Telescope-resolution smooth zoom (P1)

### 1.1 The verified resolution ladder (live MocServer, 2026-06-12)

| Survey (HiPS id) | Max order | ≈ resolution | Coverage | Hemisphere |
|---|---|---|---|---|
| `CDS/P/DSS2/color` | 9 | ~0.8″/px | **100%** | both (baseline) |
| `CDS/P/PanSTARRS/DR1/color-z-zg-g` | **11** | ~0.20″/px | 78% | **dec > −30 (north)** |
| `CDS/P/DES-DR2/ColorIRG` | **11** | ~0.20″/px | 12.6% | **south** |
| `CDS/P/DECaPS/DR2/color` | **11** | ~0.20″/px | 6.6% | south galactic plane |
| `wfau.roe.ac.uk/P/VISTA/VHS/J,K` | 10 | ~0.4″/px | ~45% | south (IR) |
| `CDS/P/unWISE/color-W2-W1W2-W1` | 8 | ~1.6″/px | 100% | both (mid-IR) |
| `CDS/P/Rubin/FirstLook` | **12** | ~0.1″/px | 0.1% (growing) | **south — the future** |
| `CDS/P/HST/EPO`, `ESAVO/P/HST/*` | **14** | **~25 mas/px** | famous fields | both |
| `CDS/P/JWST/*` (Carina, SMACS-0723…) | **14** | **~25 mas/px** | famous fields | both |

“Telescope resolution” is concretely: **0.2″/px everywhere** (better than typical 1″ ground
seeing), and **true space-telescope pixels (HST/JWST, 25 mas)** where those exist. Order 11 ≈
2000× more pixels on sky than our current DSS2 order 9 ceiling.

### 1.2 Engine upgrades for *smooth* (implement docs/03 fully)

Current v1 simplification (per-tile meshes, no crossfade) pops and seams. Upgrade path, in order:

1. **LOD crossfade** — 300 ms fade child↔parent on order change (doc 03 §12.2); kills pops.
2. **Prefetch ring** — fetch one ring of tiles beyond the view cone + predicted pan direction;
   zoom feels instant because the next order is already resident.
3. **Texture-array pool + merged geometry** (doc 03 §9) — sky in ≤4 draw calls; matters on iPhone.
4. **Worker decode** (`createImageBitmap` off-thread, doc 03 §10) — no jank during fetch bursts.
5. **Exact curved-cell geometry** (doc 03 §6.2 `(t,u)` method) — removes the residual seam error
   of the bilinear quads at high zoom.
6. **MOC-aware multi-survey compositing** — see §2; the zoom continues seamlessly from DSS2 into
   PS1/DES into HST/JWST where coverage exists, deepest-survey-wins, with per-layer attribution.
7. **Beyond max order: hips2fits FITS/PNG cutouts** rendered as a final “magnifier” layer, and the
   existing detail panel already proves the service.
8. **Inertial FOV easing + 120 Hz** — ProMotion iPhones run rAF at 120 Hz; keep the zoom animator
   time-based (already is) and the frame loop allocation-free (mostly done, audit remains).

---

## 2. North & south hemispheres — the honest answer (P1, with §1)

**Stars (3D): already solved.** Gaia is a space telescope — our 638k-star catalogue is genuinely
all-sky, as is HYG. Nothing to do.

**Imagery: solved by survey compositing, not by one survey.** No single high-res optical survey
covers both hemispheres (Pan-STARRS stops at dec −30; DES/DECaPS/VHS are southern). Strategy:

- Registry gains every survey above with its **MOC** (coverage map — we already fetch MOCs).
- Renderer picks, per HEALPix cell, the **deepest survey whose MOC covers it** (priority list:
  HST/JWST → Rubin → PS1/DES/DECaPS → VHS → DSS2). DSS2 (100%) guarantees no holes.
- UI shows which survey you're looking at (attribution is already live per survey) + a coverage
  outline toggle so researchers know the provenance of every pixel.

**Transients: the real gap, with a concrete fix.**
- **ZTF (current source) is northern-only** (Palomar, dec ≳ −30). Honest limitation of v1.
- **South = Rubin/LSST** (Chile — it *is* the southern sky machine). Our ALeRCE-LSST adapter seam
  is one config line; their `/list_objects` 500'd on 2026-06-12 — poll monthly, flip when stable.
- Meanwhile add **TNS (Transient Name Server)** — all confirmed SNe/transients, **all-sky**,
  public API — as a second, confirmed-events layer; and optionally **ASAS-SN** (all-sky, shallow).
- Observation planning (§4) must be hemisphere-aware via device location: an astronomer in Chile
  gets southern visibility, alerts filtered to *their* observable sky.

---

## 3. Real-time layer (P2)

1. **Live polling** — brokers re-queried on an interval (e.g. 2 min) with `lastmjd > since`,
   not just on view change; new alerts animate in (pulse).
2. **Watchlists + push notifications (native app)** — star/transient watchlist; a background task
   (or a tiny scheduled GitHub Action posting to APNs) notifies “ZTF26xxxx brightened to 16.9” /
   “new SN candidate within 2° of M101”. *This is the killer native-app feature for researchers.*
3. **TNS cross-match** — every transient panel says whether it's a registered/classified event.
4. **Solar system, live** — JPL Horizons API (no CORS limits in the native app; proxy or
   precomputed ephemerides on web): planets, comets, near-Earth asteroids as moving markers with
   accurate positions for *now* (and a time slider).
5. **Satellites (optional)** — CelesTrak TLEs + satellite.js (SGP4) → live passes; useful for
   observers (avoid streaks) and outreach-spectacular.
6. **Proper-motion time slider** — we already store Gaia data; add pmRA/pmDec to the catalogue
   build and animate the sky across ±100k years in the shader (2 extra attributes). Real science,
   zero external dependency, deeply “awesome”.

## 4. Professional / research features (P2–P3, prioritised)

**P0 — credibility basics (researchers expect these):**
1. **Coordinate grids** (ICRS/galactic/ecliptic) + precise cursor readout (already have) + field
   centre/FOV display; J2000↔galactic toggle.
2. **Any-catalogue overlay via VizieR TAP** — plot any of >25k catalogues (Gaia, 2MASS, X-ray,
   radio…) as markers over the imagery for the current field (CORS already verified for VizieR).
3. **Quantitative FITS mode** — hips2fits `format=fits` cutouts decoded in-app (small JS FITS
   reader; float pixels): pixel-value readout under cursor, min/max/asinh stretch, colormap
   control. Imagery stops being “a picture” and becomes data.
4. **Export** — FITS cutout download, current-view PNG with WCS-annotated caption, visible
   catalogue rows as CSV/VOTable, deep-link URL of the exact view (web) / share sheet (iOS).

**P1 — multiwavelength + planning:**
5. **Layer blink/compare** — two surveys (e.g. DSS2 optical vs unWISE IR vs Rubin) with a
   crossfade slider or blink mode — the classic discovery workflow.
6. **Observation planning** — device location + `astronomy-engine` (MIT): object altitude/airmass
   curves for tonight, twilight times, moon phase/separation, “observable now” badge on every
   panel, rise/set. Hemisphere-aware by construction.
7. **Instrument FOV footprints** — overlay rectangles/mosaics for user-defined instruments
   (your camera, a spectrograph slit) for pointing prep.
8. **Alert triage UI** — filter the transient layer by class/magnitude/age/distance-from-galaxy;
   sortable “tonight's candidates” table view; one-tap TNS/ALeRCE/SIMBAD cross-links.

**P2 — workflow integration:**
9. **SAMP (web profile)** — broadcast the selected object/view to TOPCAT/Aladin/DS9 running on
   the same machine (sampjs); astronomers live in these tools — interop = adoption.
10. **Gaia detail per star** — tap a 3D star → its Gaia source row (via VizieR `I/355/gaiadr3`),
    parallax/PM/RV, distance posterior.
11. **Spectra quick-look** — SDSS/Gaia XP spectrum fetch for objects that have one.
12. **Session/citation hygiene** — every datum’s provenance shown (already a principle); add
    “cite this data” (survey + service bibcodes) for papers.

## 5. iPhone app specifics (P1, parallel)

1. **Capacitor scaffold** (`@capacitor/ios`): wraps `dist/` — *the same build as the web app*.
2. **Native plugins:** Push Notifications, Geolocation, Haptics, Share, StatusBar; custom Swift
   plugin for **CoreMotion fused attitude + compass → “hold phone up” sky alignment** (the
   DeviceOrientation web API on iOS is permission-gated and compass-poor; native CMMotionManager
   is the reason the app mode feels magical).
3. **Touch UX pass:** pinch-zoom (FOV), one-finger look, larger hit targets, bottom-sheet panels
   instead of side panels, safe-area insets.
4. **Performance budget:** A15+: 120 Hz target, full 748k stars; older: 60 Hz, bright tier.
   WKWebView WebGL2 is solid; texture-array pool (§1.2) keeps memory in check; data-saver tier
   gates the 12 MB Gaia catalogue on cellular.
5. **Offline:** catalogs + base sky textures ship in the app bundle (no first-run download);
   tile cache via the existing service-worker logic (works in WKWebView) or native URLCache.
6. **Ship:** free sideload (day 1, your phone) → Apple Developer Program → TestFlight beta
   (colleagues/astronomer friends = early professional users) → App Store.
7. *(Stretch)* **iPad**: same build, pointer + Pencil support — astronomers love big screens.

---

## 6. Phasing & effort

| Phase | Contents | Effort | Outcome |
|---|---|---|---|
| **A** | Capacitor iOS app + touch UX + sideload to your iPhone; survey registry → PS1/DES/DECaPS/VHS/HST/JWST + MOC compositing; LOD crossfade + prefetch | 2–3 sessions | App on your phone; telescope-res zoom both hemispheres |
| **B** | Texture-array pool + worker decode + curved cells (smoothness); FITS mode + pixel readout; catalogue overlay; export | 3–5 sessions | Research-credible imagery + data |
| **C** | Real-time: polling, watchlists, push (needs $99 dev account), TNS layer, Horizons ephemerides; observation planning | 3–5 sessions | The “alive” app for working astronomers |
| **D** | Blink/compare, FOV footprints, PM time slider, alert triage table, SAMP | 3–5 sessions | Pro workflow tool |
| **E** | TestFlight beta with real astronomers → App Store; Rubin/LSST adapter flip when broker stabilises | 1–2 + waiting | Shipped product, southern transients |

**Needs from you:** Apple Developer Program ($99/yr) for TestFlight/App Store/push — not needed
for day-1 sideload; a decision on web go-live (repo public or Cloudflare) whenever ready.

**Honest risks:** WKWebView perf on pre-A15 phones (mitigate: tiers; gate: Metal/Unity);
HST/JWST HiPS are famous-fields only (set expectations: deep-zoom hotspots, not the whole sky);
broker APIs are young (mitigated: multi-broker + snapshot fallback already built); App Store
review wants “app-like” polish (mitigated: native nav/share/haptics in Phase A).
