# Brahmaand — action plan: modern pro design + new features

*Living plan. Goal: a sky app as **functional as Stellarium** but **modern**, **VR-ready**, and with
**professional time-domain features** no consumer app has. Accuracy is non-negotiable — every number
shown is real and sourced. Last updated 2026-06-13.*

---

## 0. Status snapshot (done this cycle)

**Rendering bugs — fixed:**
- ✅ **Full 360° / missing sky / Milky Way** — `skySphere.ts` was `THREE.BackSide`, which culled the
  base sky sphere entirely (custom geometry winding makes inside faces FRONT). Now `DoubleSide`
  (winding-agnostic, matches HiPS tiles). The Milky Way (DSS2 colour base) now renders all-sky.
- ✅ **Survey toggle did nothing** — `hips.clear()` was mis-bound to the public auto-survey branch, so
  in Pro mode (the only mode with survey buttons) switching never reloaded tiles. `else`-binding fixed;
  `setSurvey()` now swaps the HiPS base and reloads at any zoom.
- ✅ **Shaky phone gyro** — now Star-Walk-smooth: sensor events set a *target* direction, the render
  loop eases toward it with a dt-corrected exponential filter (τ≈0.12 s gyro / 0.3 s compass-fused);
  smoothing the look **vector**/quaternion avoids the yaw ±π wrap glitch. Compass is used as a slowly
  corrected **north-offset**, not a direct azimuth (which is invalid when the phone is raised).

**Features landed:**
- ✅ **Zero-overlap redesign** — CSS app frame: top bar (brand + search + mode + help), left **dock**
  with collapsible accordion sections, ☰ phone drawer, one-line bottom status. Nothing floats freely.
- ✅ **FITS quantitative mode** (`src/ui/fitsView.ts` + `src/data/fits.ts`, unit-tested) — hips2fits
  `format=fits` → accurate parse (BITPIX/BZERO/BSCALE, WCS) → canvas with scientific stretch
  (linear/log/√/asinh) + **zscale** + hover **per-pixel value & RA/Dec readout**.
- ✅ **Alert feed + cutout triptych + real light curve** — science/template/difference stamps;
  light curve with error bars + upper-limit arrows (▽) + g/r/i; real/bogus (drb) badge.
- ✅ **Reticle circle** on *both* transient and catalogued-object cutouts.
- ✅ **In-app Help** panel (`src/ui/helpPanel.ts`) incl. controls + install steps.
- ✅ Repo renamed/public: **github.com/kunalb541/Brahmaand**; CI green (Pages deploy gated to manual).

---

## 1. Design system (modern, professional, accessible)

Principles: **dark, data-dense, calm.** Stellarium-level function, modern surface.
- **Frame, not floats.** A CSS-grid shell with fixed regions (top bar / left dock / right detail /
  bottom bar) guarantees **no overlaps at any width** (390 / 820 / 1400 px). The dock collapses to a
  ☰ drawer on phones; the detail panel docks right on desktop, bottom-sheet on phones.
- **Type & color:** one mono UI face; a restrained palette (ink `#06101e`, accent `#6fbcff`, success
  `#6fdf9f`, warn `#e8c66a`, danger `#f08a7a`); class-colored alert dots. WCAG-AA contrast.
- **Iconography:** lucide-style line icons + short labels; tooltips carry the precise term.
- **Motion:** quick eased transitions (≤150 ms); flyTo animates; no gratuitous motion.
- **Pro ⇄ Public** is the same modern shell — Public just hides the dense tools (catalogs, readouts,
  classifiers, alerts), it does **not** get a different (lesser) look.

### Remaining design polish (next)
- Replace ASCII glyph buttons with a consistent icon set; align the dock accordion paddings.
- A proper **command palette** (⌘K) for search + jump-to-survey + actions (pro power-user speed).
- Detail panel: tabbed (Overview / Light curve / Cutouts / FITS / Cross-match / Observability).
- Persisted layout + theme; reduce-motion + high-contrast options.

---

## 2. Pro feature roadmap (grounded in the ANTARES research)

ANTARES (NOIRLab) is **CORS-open** (browser-callable, no proxy) and already serves the **real
Rubin/LSST + ZTF** streams with a 37-tag taxonomy. That makes these feasible client-side:

**Time-domain / discovery (the differentiators the user asked for):**
1. **Difference-image triptych** *(landed; deepen next)* — science / template / difference stamps from
   `loci[i].meta.newest_thumbnails[j].data.attributes.{src,thumbnail_type}` (`thumbnail_type` ∈
   science|template|difference; plain `<img>`, GCS has no CORS). The core real/bogus vetting view.
2. **Forced PSF photometry light curves** — the pro need: full flux history at a **fixed position**
   incl. **non-detections / 5σ upper limits** and pre-discovery. ANTARES light-curve CSV already carries
   detections + upper-limit rows (`ant_mag` empty + limiting mag) and `ant_magerr`. Deepen: plot in flux
   (µJy) with error bars, upper-limit arrows, and a magnitude/flux toggle. Real ZTF/LSST **forced
   photometry services are token-gated** → backend tier (see SCALING-COMMERCIAL.md).
3. **Stream / tag explorer** — browse by ANTARES filter tags: `nuclear_transient` (TDE/AGN),
   `extragalactic`, `high_snr`, anomaly detectors (`iso_forest_anomaly_detection`, `LAISS_RFC_AD`),
   SSO (`sso_confirmed`), Rubin `young_rubin_transients`, etc. One-click "show me tonight's TDE
   candidates." Driven by the ElasticSearch DSL `elasticsearch_query[locus_listing]`.
4. **Alert inbox/feed** *(landed; extend)* — sortable/filterable list (recency, brightness, class,
   real/bogus, tag); click → fly + detail. Add watchlist-by-coordinate (client-side; server-side
   watchlists need the authenticated portal/Kafka).
5. **Real/bogus + classifier panel** — ZTF `drb`/`rb`, `sgscore`/`distpsnr`; Rubin `reliability`,
   `psfFlux`, `extendedness`; ALeRCE `lc_classifier` probabilities. Show honestly with confidences.
6. **Cross-match panel** — ANTARES `catalog_objects` + CDS SIMBAD/VizieR + Gaia DR3 + (backend) TNS
   name/spec-class. "Is this known? what's the host?"

**Observational / planning (accurate formulas, see research notes):**
7. **Observability** — given GPS + time: altitude/azimuth/airmass (Kasten-Young), rise/set/transit,
   an **altitude-vs-tonight** curve. Pure client math (LST + alt-az transforms already in `deviceSky`).
8. **Coordinate grids** — equatorial (ICRS), galactic, horizon overlays.
9. **FOV / framing** — telescope+eyepiece/detector FOV boxes; angular-separation tool (haversine).
10. **Phase-folding** — fold periodic light curves on the catalog/feature period.

**VR for pros (grounded, not gimmick):**
11. Immersive **local stellar volume** (real Gaia parallax) walk-through; **spatial alert triage**
    (turn your head to scan the transient sky); pull-up light-curve/spectra panels by an object.

---

## 3. Why this matters to astronomers (use cases)

- **Real/bogus triage at a glance** — the difference triptych + drb is exactly how transient vetting
  is done; doing it in an immersive all-sky view is novel.
- **Follow-up decisions** — "is it up tonight from my site, how bright, rising or setting, is it
  classified, is it known (TNS)?" — answered in one panel.
- **Anomaly & stream hunting** — ANTARES' anomaly/stream tags surface the weird stuff fast.
- **Forced photometry** — the difference between a marker and a *measurement*; the upper-limit history
  is what tells you when a transient actually turned on.
- **Quantitative cutouts (FITS)** — real pixel values + WCS, not a pretty JPEG: lets a pro sanity-check
  flux/PSF/artifacts in-app.

---

## 4. Phased plan (next sessions)

- **P1 — design polish:** icon set, command palette, tabbed detail panel, layout persistence. Verify
  zero-overlap at 390/820/1400 in-browser + on device.
- **P2 — observability + grids + FOV** (pure-accurate client math; high pro value, no backend).
- **P3 — stream/tag explorer + cross-match** (ANTARES ES DSL + CDS/Gaia; client-side).
- **P4 — forced-photometry depth + flux units + phase-folding.**
- **P5 — backend tier** (only if scaling/commercial): Kafka alert ingest, caching proxy, self-hosted
  catalogue + low-order HiPS, TNS/forced-phot tokens. See [SCALING-COMMERCIAL.md](SCALING-COMMERCIAL.md).
- **P6 — VR pro features.**
- **Ongoing — keep native apps current:** after web changes run `npm run ios:sync` / `android:sync`;
  periodically `npm i @capacitor/cli@latest @capacitor/core@latest @capacitor/ios@latest
  @capacitor/android@latest && npx cap sync`, bump the iOS/Android SDK + Gradle/Xcode toolchains, and
  re-test on device. (Tracked separately so it doesn't block feature work.)

---

## 5. Guardrails
- **Accuracy first** — never show placeholder/fake values; label models vs measurements; show
  upper limits and uncertainties honestly.
- **Be a good neighbor** to CDS/brokers — rate-limit, cache, back off (see SCALING-COMMERCIAL.md).
- **Attribution stays** in every build.
- **Pro and Public share the modern shell.**
