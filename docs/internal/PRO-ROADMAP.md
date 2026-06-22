> **SUPERSEDED (2026-06-13).** This document is the 2026-06-12 session handoff, kept as a historical
> record. Everything in its "Open" list has since shipped — the rendering bugs are fixed, the
> zero-overlap redesign landed, FITS quantitative mode is wired into the UI, the alert feed /
> triptych / light curve are live, and phone motion is smooth — along with later work (solar system
> + time machine, observability, grids, Messier, measure tool, ⌘K palette, ANTARES Streams
> explorer). For the current plan see [ACTION-PLAN.md](ACTION-PLAN.md); for the feature-by-feature
> comparison with Stellarium see [STELLARIUM-PARITY.md](STELLARIUM-PARITY.md). The content below is
> unchanged.

# Brahmaand — Professional roadmap, redesign spec & handoff

*Written 2026-06-12. Distilled from the 6-agent research workflow (full raw findings:
[research dump](research/pro-features-raw-research-2026-06-12.md)). This is the durable plan to
continue from — accuracy is paramount (this is for professional astronomers; never show
placeholder/fake data).*

---

## 0. Session handoff — what's done vs. open (READ FIRST)

**Done & verified this session:**
- Broker toggle **⚡ ZTF** (ALeRCE, dense 1,146-object classified all-sky snapshot) ⇄ **🔭 LSST**
  (ANTARES, real Rubin/LSST + ZTF). `src/data/transients.ts`, snapshots in `public/transients/`.
- GPS + gyro + compass real-sky registration (`src/core/deviceSky.ts`) — **but the phone motion is
  shaky / not smooth** (see Known Bugs).
- Search box + mobile HUD overlap fixes (collapse on phones). **Intermediate widths still overlap**
  — full redesign needed (§3).
- **FITS reader built & unit-tested** (`src/data/fits.ts`, `src/data/fits.test.ts`): accurate pixel
  values, TAN WCS pixel→RA/Dec, zscale + asinh/log/sqrt stretches. **Not yet wired into the UI.**
- CI fixed (Pages deploy gated to manual dispatch → pushes are green).
- Repo is now **public** and being **renamed** (Google transliteration of "universe" = *Brahmaand*).

**Open (priority order):**
1. **Rendering bugs** (§5) — survey toggle "does nothing", no Milky Way, not full 360°, shaky.
   The user says these are the #1 problem. Fix before new features.
2. **UI redesign** (§3) — clean, professional, zero overlaps at every width.
3. **Wire FITS quantitative mode** into the object panel (§4, code already written).
4. **Expand alerts beyond "Tonight"** → alert feed + cutout triptych + forced-photometry curve (§2).
5. **Smooth phone motion** like *Star Walk* (§5) + a "how to fly through" help card.
6. Pro features roadmap (§2) and broader use cases (§6).

---

## 1. ANTARES — what it actually exposes (verified live, CORS-open)

The ANTARES REST API (`https://api.antares.noirlab.edu/v1`, JSON:API) is **fully browser-callable**
(CORS wide open, credentials allowed) — no backend needed. It already serves **both live ZTF and
live Rubin/LSST** alerts in production, including the full Rubin diaSource/diaObject schema with a
real/bogus **reliability** score. Key surfaces:

- **`GET /v1/loci`** — list/search transients. JSON:API `{data:[…], links, meta:{count}}`.
  Pagination `page[limit]`/`page[offset]`; sort `sort=-properties.newest_alert_observation_time`.
  `meta.count` **hard-caps at 10000** — do **not** present it as a true total.
- **Cone / arbitrary search** — `elasticsearch_query[locus_listing]=<url-encoded ES JSON>` (one
  top-level `query` key). Supports bool/range/term/terms and `sky_distance` cone (radius in **degrees**,
  1″ = 0.0002778°). Locus→alert association radius is 1″ (nearby sources can blend).
- **`GET /v1/loci/{id}`** — full locus: `ra, dec, tags, catalogs, properties, catalog_objects,
  lightcurve` (CSV). Lookup helpers exist by ZTF id and LSST diaObject/ssObject id (cross-survey
  resolution). `catalog_objects` may be empty even when `catalogs[]` is populated — fetch the
  catalog-matches sub-resource for full data.
- **Tags = stream taxonomy** (`GET /v1/tags`, **37 tags** with descriptions). High-value ones:
  `nuclear_transient` (<0.6″ of a host nucleus → TDE/AGN/central SN), `extragalactic`,
  `young_extragalactic_candidate`, `high_snr`, `high_amplitude_transient_candidate`,
  `recent_reddening`, `dwarf_nova_outburst`, `in_m31`, `sso_candidates`/`sso_confirmed` (solar-system,
  cross-checked vs JPL Horizons <1″), `refitt_newsources_snrcut`, anomaly filters
  (`iso_forest_anomaly_detection`, `LAISS_RFC_AD_filter`), `superphot_plus` classifications, and Rubin
  `young_rubin_transients`. **This tag/stream taxonomy is the backbone of a pro "stream explorer".**
- **Cutout triptych** — science / template / **difference** PNG stamps are served as **direct
  googleapis URLs, no auth** (the real/bogus assessment view astronomers actually want).
- **Per-alert properties** — ZTF: `rb`/`drb`, `sgscore`, `distpsnr`; Rubin: `reliability`,
  `psfFlux`, `extendedness`.
- **No public REST** for watchlists / saved searches / subscriptions / notifications — those live in
  the authenticated web portal + Slack/Kafka. User-defined filters are submitted as **Python via the
  ANTARES DevKit**, not via API. (So "watchlists" in-app = client-side, stored locally.)

Times are **MJD (UTC, `ant_mjd`)**; brightness is **magnitude** (lower = brighter).

---

## 2. Pro-feature roadmap (beyond "Tonight")

The user asked: *"why only Tonight? … difference images and forced PSF photometry … find actual use
cases."* Concrete, accurate features, prioritized:

| # | Feature | What it does (real data) | Source / accuracy notes | Effort |
|---|---|---|---|---|
| 1 | **Alert feed / inbox** | A scrollable, sortable, filterable list of recent loci (not just sky dots): name, class/tags, mag, age, Δmag. Click → fly to + open detail. Replaces the single "Tonight" toggle. | `GET /v1/loci` paged + tag filter. Don't claim `meta.count` as total. | M |
| 2 | **Cutout triptych viewer** | Show **science / template / difference** stamps for an alert — how pros vet real vs bogus. | ANTARES googleapis PNG URLs (no auth). Label which is the difference image; show `drb`/`reliability`. | S |
| 3 | **Forced-photometry-style light curve** | Plot the full ANTARES light curve **with error bars and upper-limit (non-detection) arrows**, multi-band (g/r/i), real magnitudes. | ANTARES `lightcurve` CSV (`ant_mjd, ant_mag, ant_magerr, ant_passband`; empty mag = 5σ upper limit → draw as a downward arrow, never as a point). For true forced photometry over the full history, the **ZTF Forced Photometry Service** needs a token/batch (backend) — note it as a deep feature. | M |
| 4 | **Stream/tag explorer** | Browse the 37 ANTARES streams (nuclear_transient, anomaly, SSO, young extragalactic…) as filter chips; each is a real science cut. | `GET /v1/tags` + ES `term:{tags:…}`. | M |
| 5 | **FITS quantitative mode** | Hover a cutout → real pixel value + RA/Dec (WCS) + min/max/zscale + stretch picker (linear/log/asinh/zscale). Code already in `src/data/fits.ts`. | hips2fits `format=fits`. Report true units (`BUNIT`); asinh/zscale per DS9/IRAF. | M (wire-up) |
| 6 | **Observability panel** | For any object: current **altitude/azimuth/airmass** from the user's GPS + time, plus a tonight **altitude-vs-time** curve and rise/transit/set. | Alt-az transform + LST; airmass Kasten-Young 1989: `1/(cosz + 0.50572·(96.07995−z)^−1.6364)`. Use UTC→correct LST. | M |
| 7 | **Cross-match panel** | One-click links/data: SIMBAD, **TNS** (is it a named SN? type, z), Gaia DR3 (parallax/PM → is it Galactic?), PS1, MPC/SkyBoT (is it a known asteroid at this position+time?). | TNS API needs a (free) API key + bot → likely thin proxy; SIMBAD/VizieR/Sesame CORS-open; SkyBoT (IMCCE) cone by position+epoch. Verify CORS per source. | M–L |
| 8 | **Coordinate grids & FOV** | Toggle equatorial (J2000) / galactic / horizon grid lines; a telescope/eyepiece FOV reticle; angular-separation readout between two clicks (haversine on the sphere). | Standard sphere math; precess to epoch; horizon grid needs GPS+LST. | M |
| 9 | **Watchlists (local)** | Save targets / coordinate regions; highlight matching alerts. Client-side only (ANTARES has no watchlist REST). | localStorage; cone-match incoming loci. | S |
| 10 | **Phase-folded view** | For periodic variables, fold the light curve on its period. | Period from ANTARES/ALeRCE features; epoch-fold `φ = ((t−t0)/P) mod 1`. | S |
| 11 | **VR pro mode** | Spatial all-sky alert triage (turn head to scan the transient sky); immersive 3D Gaia-parallax volume; pull-up light-curve panels. Keep positions scientifically exact. | WebXR (already scaffolded). Value > demo only if positions stay accurate. | L |

**On "difference images and shit" (broader use cases, not just diff images):** the real pro
workflow is *discover → vet → characterize → follow up*. That maps to: alert feed (discover) →
triptych + real/bogus + cross-match (vet) → light curve + forced photometry + classification
(characterize) → observability + watchlist + finder chart (follow up). Build along that spine.

---

## 3. UI redesign — clean, professional, ZERO overlaps

**Problem:** one big top-left panel holds everything; the floating search and bottom-right legend
collide at intermediate widths; look is dated.

**Target layout (CSS grid "app frame" — fixed regions never overlap by construction):**
- **Top bar** (slim, full width): brand (★ *Brahmaand*) · **search** (flex-grows, lives in the bar so
  it can never float over anything) · mode toggle (◆ Pro / ◇ Explore) · **Help/Install (?)** · About.
- **Left dock** (collapsible, single panel, **accordion sections** so it never gets tall enough to
  overflow): *Imagery* (survey ladder + exposure), *Overlays* (constellations, labels, grids,
  catalogs), *Alerts* (broker toggle, tag filters, feed), *Tools* (FITS, observability, share).
  On phones the dock becomes a bottom sheet or a single hamburger drawer.
- **Right panel** (docked, not floating): object detail / alert detail / FITS readout. Slides in;
  reserved column on desktop, full-width sheet on mobile.
- **Bottom bar** (slim, one line): RA/Dec readout · FPS/tiles · attribution. One flex row, ellipsis
  on overflow — no stacked floating chips.
- **Alert legend** moves **into** the Alerts dock section (not a floating bottom-right box).

**Overlap-prevention strategy:** a single `display:grid` page frame
(`grid-template: "top top" auto "left main" 1fr "bottom bottom" auto / auto 1fr`). Every panel is a
grid child or lives *inside* one — nothing uses `position:fixed` floating into shared space. Panels
scroll internally (`overflow:auto; max-height:100%`) instead of growing into neighbors. Test at
390 / 820 / 1400 px. Honor `env(safe-area-inset-*)`.

**Aesthetic:** keep the dark, monospace, cyan-on-navy theme but tighten: consistent 8px spacing,
grouped sections with subtle dividers, icon + label buttons, a real type scale. Reference: ESASky /
Aladin Lite v3 / Firefly toolbar-and-dock patterns.

---

## 4. FITS quantitative mode — implementation (parser already done)

`src/data/fits.ts` is built & tested. To wire it in (Pro object panel):
1. When a transient/object is selected in **Pro** mode, also fetch the cutout as FITS:
   `…hips2fits?…&format=fits` (DSS2 or the survey in view).
2. `parseFits(arrayBuffer)` → `{width,height,data,bunit,min,max,z1,z2,wcs}`.
3. `renderToImageData(img, 'asinh')` → draw to a `<canvas>` (replaces/overlays the JPEG).
4. On mouse/touch move over the canvas: map to pixel → `pixelValue()` + `pixelToWorld()`; show a
   readout chip: `value <BUNIT> · RA <hms> Dec <dms>`.
5. A small stretch selector (linear/log/asinh/sqrt) + show `z1..z2` (zscale) and min/max.
**Accuracy:** values are physical (`BZERO+BSCALE·raw`) in `BUNIT`; never invent a colorbar range —
use real min/max or zscale. NaN/BLANK pixels render black and read "—".

---

## 5. Known rendering bugs (user-reported — fix first)

The user reports, on phone and desktop:
1. **"Toggling to other surveys really does nothing."** → Investigate `HipsLayer` survey switching:
   confirm the survey `id`→HiPS base-URL map is correct and that switching actually swaps the tile
   source + clears the old tile cache + refetches. Likely the active-survey state isn't propagating
   to the tile URL, or the new survey's tiles 404 and it silently keeps DSS2.
2. **"Not complete 360° yet."** → The sky sphere / HiPS coverage may not cover the full celestial
   sphere (gap at certain RA/Dec, or the base all-sky texture only covers part). Check the sky sphere
   geometry + that order-0/1 HiPS Allsky loads everywhere.
3. **"I can't see the Milky Way."** → The Mellinger Milky Way layer toggle may be off/!broken, or its
   texture isn't loading, or it's occluded by the DSS2 sphere. Check the "Milky Way" button wiring
   and layer ordering/opacity.
4. **"Very shaky" / phone motion "not seamless — should be like Star Walk."** → `deviceSky.ts` drives
   yaw/pitch straight from raw `deviceorientation` every event (jittery). Fix: **low-pass/slerp
   smoothing** of the orientation quaternion (exponential smoothing, e.g. `q.slerp(target, 0.15)` per
   frame), drive it in the render loop (not per sensor event), and damp small jitter. Star Walk feels
   smooth because it filters + interpolates. Also consider a "recenter" and reducing sensitivity.
5. **"How to fly through."** → Add a help card: desktop W/A/S/D + Q/E (already), drag to look, scroll
   zoom; phone = joystick + move-to-look. Surface this in the Help/Install panel.

These are the priority. "It should solve all rendering issues" — treat §5 as the next session's
first task.

---

## 6. Easy install instructions (ship in-app Help + here)

### iPhone (your phone) — via Xcode (free, ~10 min)
1. On the Mac, in the project: `npm run ios:sync` then `npm run ios:open` (opens Xcode).
2. Plug in the iPhone via USB; tap **Trust** on the phone.
3. In Xcode, top bar: pick your iPhone as the run target.
4. Click the project (left) → **Signing & Capabilities** → **Team** → add/select your free Apple ID.
   If the bundle id is taken, change it (e.g. `com.<you>.brahmaand`).
5. Press **▶ (Run)**. First time: on the phone, **Settings → General → VPN & Device Management →**
   trust your developer certificate, then reopen the app.
6. Free signing re-installs every 7 days; re-run ▶ to refresh. (TestFlight/App Store needs the $99/yr
   Apple Developer Program.)

### Android (your friend) — via APK (free, no account)
1. The signed-for-debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk` (~18 MB). Rebuild
   anytime: `cd android && ./gradlew assembleDebug`.
2. Upload it to Google Drive/Dropbox; share the link.
3. Friend: open link → download APK → tap it → Android warns "unknown apps" → **Settings → Allow from
   this source** (for Chrome/Drive/Gmail) → back → **Install** → open **Brahmaand**.
4. Debug APK never expires; Play Protect may show a one-time "install anyway".

*(Also see [docs/IOS.md](IOS.md) and [docs/ANDROID.md](ANDROID.md).)*

---

## 7. Repo public + rename

- Repo is now **public** — the GitHub Pages deploy can now actually publish: enable
  **Settings → Pages → Source: GitHub Actions**, then run the **CI / Deploy** workflow (Actions tab,
  "Run workflow"). It will build and deploy `dist/` to a live URL.
- Renaming to *Brahmaand* (Google transliteration of "universe"): after renaming on GitHub, update the
  local remote: `git remote set-url origin https://github.com/<user>/<new-name>.git`. The in-app
  brand should switch from "★ STAR ATLAS" to "★ Brahmaand" during the redesign. Update README/About
  source links to the new URL.
