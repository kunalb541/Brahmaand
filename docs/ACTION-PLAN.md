# Brahmaand — action plan: modern pro design + new features

*Living plan. Goal: a sky app as **functional as Stellarium** but **modern**, **VR-ready**, and with
**professional time-domain features** no consumer app has. Accuracy is non-negotiable — every number
shown is real and sourced. Last updated 2026-06-20.*

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

**Latest wave — shipped since the above (2026-06-13):**
- ✅ **Solar system** — Sun, Moon (correct phase drawn, bright limb toward the Sun, topocentric
  parallax when a location is set) and the 7 planets. Click → panel with distance, angular diameter,
  illumination/phase, observability. **Accuracy anchored by unit tests** reproducing the 2020-12-21
  Jupiter–Saturn great conjunction and the 2017-08-21 total solar eclipse (geocentric *and*
  topocentric from the totality path). *Now rewritten on **astronomy-engine** — see the precision
  wave below.*
- ✅ **Time machine** (`src/core/simTime.ts`) — time bar with −1d/+1d, rates ±1 s/s to ±1 yr/s,
  pause, click-date entry, ● Now; UI goes amber when warped. Drives the solar system, observability
  and the horizon grid.
- ✅ **Observability panel** (`src/data/observability.ts`) — alt/az/airmass (Kasten & Young 1989),
  rise/transit/set, tonight's altitude curve (sunset→sunrise, twilight shaded); GPS or manual
  location (persisted); follows sim time.
- ✅ **Grids & lines** (`src/sky/grids.ts`) — equatorial grid + celestial equator, ecliptic +
  **precession circles**, galactic equator, and a **horizon (alt/az) grid** built from observer +
  time (rebuilt ~1 Hz).
- ✅ **Messier labels** — all 110 objects, positions/types fetched from SIMBAD TAP at build time
  (`tools/build-messier.mjs` → `public/data/messier.json`); clickable, with zoom decluttering.
- ✅ **Official IAU constellation boundaries** (d3-celestial GeoJSON) alongside the stick figures.
- ✅ **Measure tool** (📐) — two-click great-circle separation in °/′/″ with a drawn arc, chainable;
  joins the FOV framing circle (5°/1°/30′/15′/5′, true angular size).
- ✅ **Hotkeys + ⌘K command palette** — C/B/L/M/G/E/H/P/T/F toggles, [ ] time ±1 day, N now,
  / search, ? help; ⌘K/Ctrl-K palette runs commands and falls through to sky search.
- ✅ **ANTARES Streams explorer** — dropdown of 12 community tags (e.g. `nuclear_transient`,
  anomaly detectors, `sso_confirmed`) via the ElasticSearch DSL.
- ✅ **Good-neighbour hardening** — `politeFetch` (429/503 exponential backoff honouring
  Retry-After, max 3 tries, graceful fallback to snapshots); live polling paused in hidden tabs
  with instant catch-up on visibility.
- Tests now **22 passing** — frames (4), FITS (4), observability (6), ephemeris (8, incl. the two
  hard historical anchors). Typecheck clean; production build green.

**Precision + research wave — shipped since the above:**
- ✅ **Arcsecond ephemeris** — `src/data/ephemeris.ts` rewritten on the **astronomy-engine** library
  (Don Cross, MIT, ~90 KB, VSOP87/ELP), validated to **arcseconds** vs JPL Horizons. This **replaced**
  the homegrown "JPL approximate elements + truncated lunar theory" (~arcminutes), which had a real
  bug: it omitted the JPL Table-2a correction terms, giving **~54′ error for Uranus and ~41′ for
  Neptune** (nearly 1°). Now: Sun/Moon/planets are J2000 ICRS, aberration-corrected, topocentric when
  an observer location is set; magnitudes include Saturn's ring tilt; the Moon's illuminated
  fraction/phase is exact. Verified live (2017 eclipse Sun–Moon sep 0.109°, new-moon illum 0,
  Saturn 0.24 mag, Neptune 7.82, Moon 377447 km).
- ✅ **Lomb-Scargle period-finding** (`src/data/periodogram.ts`, unit-tested) — periodogram +
  phase-folding wired into the Pro transient panel; runs on the best-sampled photometric band, shows
  the periodogram and (when significant) the phase-folded light curve + "P = … · FAP …
  · significant/tentative". The standard period-finder for unevenly-sampled survey light curves
  (variable stars, eclipsing binaries, RR Lyrae/Cepheids). Verified live on RR Lyrae ZTF18abntqrg
  → P = 11.75 h, FAP < 0.1%, corroborating the broker ML "RRL 85%".
- ✅ **Light-curve CSV export** (detections + upper limits) — a no-backend download, available to all
  users.
- ✅ **Rendered horizon** (`src/sky/horizon.ts`) — Stellarium/Star-Walk-style ground: a translucent
  ground hemisphere below the horizon (dims the below-horizon sky) + a bright horizon line + N/E/S/W
  cardinal markers, built from observer location + time; works in both look-around and phone-gyro
  modes; on the "Horizon" toggle.
- ✅ **Messier-label gating bug fixed** — Messier labels were floating over deep-space flight; now
  gated to the planetarium (Earth) view.
- ✅ **Gyro smoothing tuned smoother** (`SLERP_TAU` 0.13, `DRIFT_TAU` 2.5).
- ✅ **UI de-boxed** — panels softened (radii), modern sliders / dropdowns / scrollbars.
- Tests now **41 passing** — frames (4), FITS (4), observability (6), ephemeris (8), Lomb-Scargle
  periodogram (4), device-sky/gyro (9). Typecheck clean; production build green.

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

### Design polish — done vs. remaining
- ✅ **Command palette** (⌘K/Ctrl-K) — commands + falls through to sky search.
- ✅ **Hotkeys** — single-key toggles for every major overlay/tool (see Help panel).

Remaining:
- Detail panel: tabbed (Overview / Light curve / Cutouts / FITS / Cross-match / Observability).
- Replace ASCII glyph buttons with a consistent icon set; align the dock accordion paddings.
- i18n (UI strings are English-only today).
- Persisted layout + theme; reduce-motion + high-contrast options.

---

## 2. Pro feature roadmap (grounded in the ANTARES research)

ANTARES (NOIRLab) is **CORS-open** (browser-callable, no proxy) and already serves the **real
Rubin/LSST + ZTF** streams with a 37-tag taxonomy. That makes these feasible client-side:

**Time-domain / discovery (the differentiators the user asked for):**
1. **Difference-image triptych** *(landed; deepen next)* — science / template / difference stamps from
   `loci[i].meta.newest_thumbnails[j].data.attributes.{src,thumbnail_type}` (`thumbnail_type` ∈
   science|template|difference; plain `<img>`, GCS has no CORS). The core real/bogus vetting view.
2. **Forced PSF photometry light curves** *(partial — honest status)* — the in-app light curve
   already shows detections with error bars, **upper-limit arrows (▽)** and g/r/i bands from the
   ANTARES light-curve data (`ant_mag` empty + limiting mag, `ant_magerr`), and the curve (detections
   + upper limits) is **exportable to CSV** (no backend, all users). Still pending: flux
   (nJy/µJy) plotting with a magnitude/flux toggle. True forced photometry at a fixed position (incl.
   pre-discovery) is **not** client-feasible — ZTF/LSST forced-photometry services are token-gated
   → backend tier (see SCALING-COMMERCIAL.md).
3. ✅ **Stream / tag explorer** *(landed)* — ANTARES **Streams dropdown** with 12 community tags
   (`nuclear_transient`, `extragalactic`, `high_snr`, anomaly detectors
   `iso_forest_anomaly_detection` / `LAISS_RFC_AD`, `sso_confirmed`, etc.), driven by the
   ElasticSearch DSL `elasticsearch_query[locus_listing]`. One-click "tonight's TDE candidates."
4. **Alert inbox/feed** *(landed; extend)* — sortable/filterable list (recency, brightness, class,
   real/bogus, tag); click → fly + detail. Add watchlist-by-coordinate (client-side; server-side
   watchlists need the authenticated portal/Kafka).
5. **Real/bogus + classifier panel** — ZTF `drb`/`rb`, `sgscore`/`distpsnr`; Rubin `reliability`,
   `psfFlux`, `extendedness`; ALeRCE `lc_classifier` probabilities. Show honestly with confidences.
6. **Cross-match panel** — ANTARES `catalog_objects` + CDS SIMBAD/VizieR + Gaia DR3 + (backend) TNS
   name/spec-class. "Is this known? what's the host?"

**Observational / planning (accurate formulas, see research notes):**
7. ✅ **Observability** *(landed)* — GPS or manual location + sim time: altitude/azimuth/airmass
   (Kasten & Young 1989), rise/transit/set, tonight's altitude curve with twilight shading.
   Pure client math (`src/data/observability.ts`).
8. ✅ **Coordinate grids** *(landed)* — equatorial + celestial equator, ecliptic + precession
   circles, galactic equator, horizon (alt/az) grid (`src/sky/grids.ts`).
9. ✅ **FOV / framing + separation** *(landed)* — FOV framing circle at 5°/1°/30′/15′/5′ (true
   angular size) + two-click great-circle measure tool (°/′/″, chainable). Custom
   telescope+eyepiece/detector presets not built yet.
10. ✅ **Period-finding + phase-folding** *(landed)* — a **Lomb-Scargle periodogram**
    (`src/data/periodogram.ts`, unit-tested) on the best-sampled band finds the period; when
    significant, the light curve is phase-folded and shown with "P = … · FAP …
    · significant/tentative". The standard period-finder for unevenly-sampled survey light curves.
    Verified live on RR Lyrae ZTF18abntqrg → P = 11.75 h, FAP < 0.1%.

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

- **P1 — design polish:** *mostly done* — ✅ command palette (⌘K) + hotkeys; zero-overlap frame
  holds at 390/820/1400. Remaining: icon set, tabbed detail panel, layout persistence, i18n.
- **P2 — observability + grids + FOV:** ✅ **done** (pure client math, no backend; plus the measure
  tool and the time machine that drives it all).
- **P3 — stream/tag explorer + cross-match:** ✅ **done** — ANTARES Streams dropdown (ES DSL);
  cross-match via SIMBAD identify + Gaia DR3 / 2MASS / AllWISE / Chandra catalog overlays (VizieR).
  (Backend-gated TNS names excluded — see P5.)
- **P4 — forced-photometry depth + flux units + phase-folding:** *mostly done* — error bars +
  upper-limit arrows + g/r/i, **Lomb-Scargle period-finding + phase-folding**, and **CSV export** all
  landed; flux (nJy/µJy) units with a mag/flux toggle still pending; true forced photometry is
  token-gated → P5.
- **P5 — backend tier** *(unstarted; only if scaling/commercial)*: Kafka alert ingest, caching proxy,
  self-hosted catalogue + low-order HiPS, TNS/forced-phot tokens. See
  [SCALING-COMMERCIAL.md](SCALING-COMMERCIAL.md).
- **P6 — VR pro features:** *pending* (spatial alert triage, in-VR light-curve/detail panels —
  see §2 item 11).
- **Ongoing — keep native apps current:** after web changes run `npm run ios:sync` / `android:sync`;
  periodically `npm i @capacitor/cli@latest @capacitor/core@latest @capacitor/ios@latest
  @capacitor/android@latest && npx cap sync`, bump the iOS/Android SDK + Gradle/Xcode toolchains, and
  re-test on device. (Tracked separately so it doesn't block feature work.)

---

## 5. Research roadmap — high-value pro / time-domain features

The browser-direct tier is **now shipped** (see the "Precision + research wave" status block).
Remaining items are tagged browser-direct vs **backend-gated** (CORS or auth → needs the P5 tier).

**Browser-direct — SHIPPED:**
- ✅ **AAVSO VSX cross-match** — catalogued type / published period / range, with a cross-check of the
  measured Lomb-Scargle period against the literature (`src/data/vsx.ts`).
- ✅ **SIMBAD cross-match on alerts** — nearest catalogued source + type + separation (CDS cone search,
  CORS-open, browser-direct — *no proxy needed*).
- ✅ **Colour-magnitude / HR diagram** from the loaded Gaia DR3 + HYG catalogues (`src/ui/hrDiagram.ts`).
- ✅ **Flux ↔ AB-mag** (`src/data/photometry.ts`) — peak flux + `flux_uJy` CSV column, `AB = 31.4 −
  2.5·log10(flux_nJy)` / `23.9 − 2.5·log10(flux_µJy)`.
- ✅ **Finder charts** — N-up/E-left + scale bar on object/alert cutouts (self-contained, no Aladin dep).
- ✅ **Observability / airmass planning** on every alert (rise/transit/set + tonight curve).

**Browser-direct — still open:**
- **More Lomb-Scargle options** — multi-band combined periodograms, explicit aliasing flags.
- **Multi-night / season observability planning** (extend the single-night curve).

**Backend-gated (CORS / auth → P5 tier):**
- **TNS** name / classification / spectra resolution — needs a registered bot token + server (no CORS).
- **Watchlists / saved ANTARES ES-DSL queries** — server-side persistence + auth.
- **Kafka live streaming** of alerts.
- **Forced photometry** at a fixed position (ZTF/LSST forced-photometry services are token-gated).

---

## 6. Guardrails
- **Accuracy first** — never show placeholder/fake values; label models vs measurements; show
  upper limits and uncertainties honestly.
- **Be a good neighbor** to CDS/brokers — rate-limit, cache, back off (see SCALING-COMMERCIAL.md).
- **Attribution stays** in every build.
- **Pro and Public share the modern shell.**
