# Decision log

One line per non-trivial decision: date · what · why. Newest at the bottom.
See [plan/AGENT_INSTRUCTIONS.md](../plan/AGENT_INSTRUCTIONS.md) §6.

## 2026-06-12 — Implementation kickoff (PHASE-0 + PHASE-1)

- **Canonical phase numbering = PHASE-n maps to milestone Mn** (0–8). README/ROADMAP were
  reconciled to this; the phase files' `milestone:` tags already followed it.
- **Single-page app at repo root** (`index.html`, `src/`, `public/`) — not an `app/`
  subfolder — matching the bulk of the runbooks (`src/sky`, `src/stars`, `public/`).
- **Sky-sphere UVs generated from `raDecToWorld`** (custom geometry) instead of
  `SphereGeometry` + a guessed `rotation.y`. Guarantees the imagery, constellation overlay,
  and star labels align by construction — no runtime calibration. (Improves on PHASE-1 §3.)
- **Real assets vendored** under `public/` (DSS2 + Mellinger all-sky JPEGs from CDS hips2fits,
  d3-celestial constellation lines) so the app runs offline with zero API calls.
- **Frame convention:** world +Y = NCP, +Z = vernal equinox, +X = RA 90°. `pointAt` uses
  `yaw = atan2(−d.x, −d.z)` (camera looks down −Z; bug found by running it).

## 2026-06-12 — PHASE-2 (HiPS streaming) — implemented as a pragmatic subset

- **Library:** `healpix-ts@1.1.0` (MIT). Verified live: `cornersNest` → 4 `[x,y,z]` corners;
  `queryDiscInclusiveNest(nside, [x,y,z], radius, cb)` takes an **array** vector (not `{x,y,z}`)
  and throws for radius > π/2. HEALPix→world swizzle = `world.(x,y,z) = hp.(y,z,x)`.
- **Tile UV orientation (the doc 03 §6.4 gate): `ORIENT = 4`** = `(1−a, 1−b)`, settled by
  screenshot — the streamed field is continuous across tile boundaries (Alnitak / Orion's Belt,
  M42 verified at order 7–9). Lives in one function `uvFromAB` in `tileGeometry.ts`.
- **Per-tile meshes + per-tile `THREE.Texture`** (not the texture-array pool of doc 03 §9).
  Simpler, correct, ~35–115 draws at order 7–9, 60 fps desktop. Pool is a PHASE-8 optimisation.
- **Main-thread `createImageBitmap` decode** (no worker yet), **no MOC**, **single base URL**
  (no mirror failover). All deferred to PHASE-6/8.
- **Tiles overlay the base equirect sphere**; streaming only kicks in at order ≥ 6
  (`MIN_STREAM_ORDER`) where tiles beat the 4k base. Below that = base sky only.
- **Cone margin is order-aware** (`min(0.02, 1.5·cellRad)`) — a fixed 0.02 rad margin
  ballooned tile counts to ~530 at order 9; order-aware cuts it to ~40.
- **Pruning keeps recently-wanted tiles of any order** as a coarse fallback so gaps show
  lower-order detail instead of black while finer tiles stream in.
- **Streaming restricted to equatorial surveys (DSS2).** Mellinger is galactic-frame — needs
  the gal→ICRS rotation (doc 03 §6.5); equirect-only for now.
- **Known v1 cosmetics (acceptable):** tile geometry uses linear-interp-between-corners
  (not the exact curved HEALPix projection of doc 03 §6.1) → sub-pixel edge error at high
  orders; visible brightness steps between DSS2 tiles are the survey's own per-tile JPEG levels.
- **Loop wrapped in try/catch** — three's `setAnimationLoop` permanently stops the loop if the
  callback throws; the guard surfaces the error and keeps rendering.

## 2026-06-12 — PHASE-3 (3D star-field flythrough) — implemented as a pragmatic subset

- **Data source = HYG v4.1** (astronexus, CC BY-SA 4.0), not the blueprint's ATHYG/Gaia pipeline.
  HYG ships precomputed equatorial XYZ (parsecs) + B−V + mags + names in one CSV — fastest path
  to real 3D distances. `tools/build-stars.mjs` filters to 109,400 stars (finite dist ≤ 5000 pc,
  Sun excluded) → `public/catalogs/hyg.bin` (2.0 MB: posF32×3N · colU8×3N · absMagF32×N).
- **World coords baked at build time** (`world = hyg.(y,z,x)` swizzle) for simplicity. The full
  PHASE-4 pipeline stores ICRS and swizzles at runtime (doc 04 §A6) — deviation noted.
- **No octree LOD / no chunking / no impostor pass.** 109k stars = one `THREE.Points` buffer,
  one draw call, 60 fps. The octree streaming of doc 04 §A7/§B7 is for the multi-million Gaia set.
- **No floating-origin (camera-relative) rendering.** HYG stars are ≤ 5000 pc → float32 world
  positions are jitter-free at this scale; camera distance comes straight from `modelViewMatrix`.
  RTC (doc 04 §B5) becomes necessary only with the full Gaia catalogue out to kpc.
- **Photometry shader** = doc 04 §B6: stored absolute mag → per-frame apparent mag from camera
  distance → linear intensity (inverse-square); size grows only past saturation (√I); faint stars
  fade via alpha. Additive, depth-test off, over the sky sphere. Verified flying into Orion: the
  constellation distorts (stars at different distances) and approached stars brighten/grow.
- **Colour** = Ballesteros B−V→Teff → Tanner-Helland Teff→sRGB, softened 35% toward white.
- **Planetarium↔space transition:** the Earth-view sphere (HiPS + equirect sky + constellations +
  labels) follows the camera and fades out between 30 and 150 pc from the Sun (HiPS suspended);
  fades back on return. "Return to Earth" button resets the rig to the origin.
- **Fly controls** (`src/core/flyControls.ts`): WASD + Q/E translate the rig in world space;
  speed scales with distance from the Sun; Shift boosts. Look still comes from LookControls.

## 2026-06-12 — PHASE-5 (object info, search & cutouts) — implemented, fully verified

- **Endpoints re-verified live 2026-06-12** (all CORS `*`): SIMBAD TAP
  `simbad.cds.unistra.fr/simbad/sim-tap/sync`, Sesame `cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV`,
  hips2fits `alasky.cds.unistra.fr/hips-image-services/hips2fits`.
- **Cone search + detail via SIMBAD TAP (ADQL), not the /cone REST endpoint** — the doc's
  `/simbad/cone?...RESPONSEFORMAT=json` returned **HTML** when probed, so it's unused. Cone =
  `CONTAINS(POINT,CIRCLE)=1 ORDER BY DISTANCE(...)`; detail = `basic LEFT JOIN allfluxes`. JSON
  `{metadata,data}` everywhere — no VOTable (banned: only parser is GPL-3 + stale).
- **`allfluxes` columns frozen to U,B,V,R,I,G,J,H,K** (verified to exist via TAP_SCHEMA; the table
  also has JWST/SDSS bands we ignore). Null fluxes omitted (scientific-honesty rule).
- **otype decoded from a static ~40-entry map** (raw code shown if unknown) instead of fetching the
  `otypedef` table — avoids a network dependency; covers the common cases.
- **One shared token-bucket limiter (4 req/s)** fronts every CDS call (CDS blacklists ~5–6 req/s);
  LRU caches on TAP query string and Sesame name; `AbortController` cancels stale lookups.
- **Click-vs-drag** = pointerup with < 6 px movement and < 500 ms dwell → unproject screen-centre
  ray → `worldToRaDec` → cone search. Search box: Enter → Sesame (or `"ra dec"` direct parse) →
  animated `flyTo` (LookControls slerp + eased FOV, extended objects get a wider FOV) → identify.
- **Verified:** search M31 → AGN panel + fly-to + Andromeda cutout; search Sirius → `* alf CMa`
  SB\*, V −1.46, plx 379 mas, ≈ 2.6 pc; click Betelgeuse → `* alf Ori` red supergiant, Sp
  M1-M2Ia-Iab, ≈ 152.7 pc — all real SIMBAD data, browser-direct, no backend.
- **Deferred** (per the runbook): VR/uikit panel mirror → PHASE-6; SW caching of cutouts → PHASE-8;
  VizieR Gaia cross-match section; 3D-star picking by catalogue id (click uses sky direction).

## 2026-06-12 — PHASE-7 (live transient layer) — implemented on ZTF, LSST-ready

- **Broker reality (probed live 2026-06-12):** the Rubin/LSST broker endpoints respond
  (`api-lsst.alerce.online` OpenAPI 200, CORS `*`) but **`/list_objects` 500s on every query** and
  Fink LSST `/latests` 404s — the young LSST APIs aren't reliably serving data yet. So the feature
  is built on the **ALeRCE ZTF** broker (LSST's precursor survey) — real 2026 alerts, CORS-open.
- **Cone search, not full-table sort.** ALeRCE's unfiltered `order_by=lastmjd` over the whole table
  times out; the **cone search is spatially indexed and fast/reliable**, so the app fetches
  transients *near the current view* (and merges a bundled sky-wide snapshot). `order_mode` must be
  uppercase `DESC`/`ASC`; objects redirect to a trailing-slash URL.
- **Adapter seam:** `src/data/transients.ts` keys everything off `SURVEY='ztf'`; an `lsst` adapter
  (same ALeRCE shape, different host) is a one-line swap once `/list_objects` stabilises.
- **IDs are strings** (`oid`; LSST `diaObjectId` is int64 > 2^53 — never a JS number).
- **Static fallback** `public/transients/tonight.json` (72 real ZTF objects, fetched by
  `tools/build-stars`-style `tools/build-transients.mjs`) so markers show even when the live broker
  is down; the app queries live first and merges.
- **Markers** = `THREE.Points` ring shader on the sky sphere, coloured by age (cyan→orange over
  ~30 d), sized by detection count; follow the camera; Earth-view only; nearest-marker picking
  beats SIMBAD on click. **Detail panel** adds an SVG light-curve sparkline (g/r/i bands, mag vs
  time, y inverted) + a DSS2 field cutout + ALeRCE link.
- **Verified:** "Tonight" toggle → real markers across the sky; click ZTF19abbtwvp → unclassified
  variable, last seen 2026-06-11, 79 detections, real g/r light curve (19.0→16.9), field cutout.
- **Deferred:** the LSST swap (pending broker stability), Rubin First Look HiPS layer, a "tour"
  mode, the nightly cron to refresh `tonight.json` (PHASE-8).

## 2026-06-12 — PHASE-4 (real Gaia catalogue) — 638k stars, pragmatic pipeline

- **`tools/build-gaia.mjs`** fetches **638,856 real Gaia DR3 stars** (`G<10.5`,
  `parallax_over_error>5`, `ruwe<1.4`) from the ESA TAP and writes the same binary format as
  the HYG set → `public/catalogs/gaia.bin` (12.1 MB).
- **Fetch strategy:** the anonymous **async** job errors on the full 639k result, and a single
  **sync** call caps near ~100k rows (~90 s each), so the script **partitions by RA into 12 bands
  fetched 3-at-a-time** (disjoint → no dedup). Completes in ~2–3 min.
- **Distances = 1000/parallax**, not Bailer-Jones. The `external.gaiaedr3_distance` join exceeds
  the anonymous async limit; for this **bright, high-S/N subset** (`parallax_over_error>5`,
  ~<20% parallax error) 1/parallax is reliable. The full faint catalogue still needs Bailer-Jones
  (docs/04 §A3) — documented deviation.
- **Colour** from `teff_gspphot` when present, else Ballesteros(`bp_rp`) → the same palette as HYG.
- **Gaia + HYG both render.** Gaia's `ruwe`/parallax cuts drop the very brightest saturated stars
  (Sirius, Vega…); HYG patches them. Two `THREE.Points` passes, one shared exposure; ~748k stars
  total at ~40–60 fps, one draw call each. (The blueprint's octree LOD is for the multi-million
  faint catalogue; unnecessary at this size.)

## 2026-06-12 — PHASE-6 (WebXR controllers) — implemented, emulator-verification-pending

- **`src/core/xrInput.ts`** adds, on top of the existing `renderer.xr.enabled` + VRButton:
  controller pointing rays; **trigger (selectstart) → `pickSkyDirection`** (the *same* identify
  path as a desktop click — transient marker wins, else SIMBAD); **left thumbstick → fly** (moves
  the rig, speed scales with distance from the Sun); **right thumbstick → snap-turn** (±30°,
  re-armed at centre); **foveation 0.4 + 90/72 Hz** requested on `sessionstart`.
- **All inert until a session starts** — `update()` early-returns when `!isPresenting`, the
  controllers are pose-less/invisible on desktop. Verified: desktop unaffected (748k stars, click
  + search still work, zero loop errors; `navigator.xr` present but no device → VRButton shows
  "VR NOT SUPPORTED", as expected).
- **Honest limitation:** the team has no headset and IWER couldn't be injected into the preview
  here, so the immersive session itself is **verification-pending in the Immersive Web Emulator**
  (and on a real Quest). The implementation follows the three.js r184 WebXR controller API; the
  desktop-regression and code paths are verified. No 3D controller *models* (avoids the
  `@webxr-input-profiles` asset dependency) — a ray line is shown instead.
- **Deferred:** in-VR UI panels (uikit), comfort vignette, hand-tracking, magic-window phone mode.

## 2026-06-12 — PHASE-8 (ship) — deploy infra ready; go-live gated on repo visibility

- **Service worker** `public/sw.js` (registered prod-only): same-origin app shell + catalogs +
  textures cache-first (offline after first load); CDS HiPS tiles/cutouts cache-first, capped at
  1500, **CORS-only** (never opaque — avoids Chrome quota blowup); SIMBAD/ALeRCE/Sesame/Gaia hosts
  **never cached** (dynamic). `CACHE_VERSION` bump invalidates.
- **CI/CD** `.github/workflows/deploy.yml`: on push to `main` → `npm ci` → typecheck → test →
  build → `upload-pages-artifact` → `deploy-pages`. `.nojekyll` shipped.
- **`base: './'` (relative)** + relative asset fetches (`catalogs/…`, `textures/…`) make the build
  work at a GitHub Pages **project subpath** (`/Bramhaand.com/`) with no per-host config.
- **About/credits panel** (ⓘ button) lists every data provider + licenses + source link.
- **Go-live blocker (a user decision):** the repo is **private on a free GitHub plan**, and Pages
  on private repos needs a paid plan. Free options: make the repo **public** (then the workflow
  publishes to `kunalb541.github.io/Bramhaand.com/`), or deploy to **Cloudflare Pages** (needs a
  Cloudflare account). All deploy code is ready either way.
- **Deferred:** R2/object hosting for the 12 MB catalog (fine on Pages for now), nightly
  `tonight.json` refresh cron, custom domain, COOP/COEP (only needed if SAB/threads are added).

## 2026-06-12 — V2 Phase A (telescope-res, hemispheres, iOS app)

- **Survey ladder** (docs/config/surveys.ts): added Pan-STARRS (north, order 11, 0.2″),
  DES + DECaPS (south, order 11), unWISE (all-sky IR), Rubin (order 12), HST + JWST (order 14,
  ~25 mas) — all URLs/orders/formats live-verified via the CDS MocServer 2026-06-12.
- **Compositing model:** DSS2 (jpeg, all-sky) stays the universal base sphere; high-res surveys
  have `texture:null` and stream as **transparent HiPS overlays** (`transparent:true` so PNG
  no-coverage alpha + missing tiles let the DSS2 base show through). Verified: M13 resolved into
  stars (Pan-STARRS), Fornax cluster galaxies (DES) — north + south. Per-cell *auto* best-survey
  (MOC compositing) is the next step; manual selection ships now.
- **Smoothness:** per-tile **fade-in** (250 ms opacity 0→1) kills pops; coarse tiles persist
  under fine ones via the existing prune window + render-order layering. (Full prefetch ring +
  exact curved-cell geometry remain for V2 Phase B.)
- **iOS app via Capacitor** (not a Swift/Metal rewrite): same `dist/` build → WKWebView + native
  plugins. `capacitor.config.ts`, `docs/IOS.md` (Xcode + CocoaPods sideload steps), `ios:*`
  scripts; `/ios` git-ignored (generated by `npx cap add ios`). **Could not build here** — the Mac
  has only Command Line Tools, no full Xcode/CocoaPods — so the native build is user-side.
- **Mobile UX (verified in browser):** pinch-to-zoom (two-finger → FOV; 70°→17.5° on a 4× spread),
  resume-look on finger lift, `viewport-fit=cover` + safe-area insets, HUD collapses to a chip on
  phones (<560 px). Full bottom-sheet redesign deferred to a later UX pass.

## 2026-06-12 — V2 Phase B (research features, part 1)

- **VizieR multiwavelength catalogue overlay** (src/data/vizier.ts + src/sky/catalogOverlay.ts):
  toggle any of Gaia DR3 (optical), 2MASS (near-IR), AllWISE (mid-IR), Chandra CSC2 (X-ray) as
  coloured dot markers over the current field; several at once for cross-band comparison. VizieR TAP
  cone queries (CORS `*`, JSON — verified 2026-06-12, column names per-catalogue verified). Markers
  use the same `raDecToWorld` as everything else (aligned by construction); fetch follows the view,
  rate-limited, cached. **Known cap artifact:** `TOP 1500` returns a spatially-biased subset in
  pathologically dense fields (e.g. a globular core); fine on normal fields. Auto best-survey MOC
  compositing and a per-marker catalogue-row popup are follow-ups.
- **Shareable deep-link views** (URL hash `#ra&dec&fov&survey`): a ⌁ Share button copies a link to
  the exact view; opening such a link restores RA/Dec + FOV + survey on boot (verified: reload with
  a hash → camera + FOV + Pan-STARRS all restored). The key research-collaboration primitive
  ("here's the field I'm looking at").
- **Deferred (Phase B remainder):** quantitative FITS mode (hips2fits `format=fits` → pixel readout
  + stretch + colormap), export (FITS/CSV/VOTable/PNG), blink/compare, engine texture-array pool +
  worker decode + exact curved cells.

## 2026-06-12 — ML classifications, dual mode, native iOS + Android projects

- **Broker ML surfaced** (the user's "their ML algo + flagged or not"): per-object
  `/probabilities` (ALeRCE classifiers — `lc_classifier` + forced-photometry betas; CORS-verified)
  → class chip "Class NN% · ML: lc_classifier" + pro top-3 ranking; **ZTF real-bogus** from
  detections (`drb` deep-learning score, `rb` fallback) → "✓ likely real / ~ uncertain /
  ⚠ possibly bogus" with the score. Verified live (ZTF19abbtwvp → Periodic-Other 20%, drb 0.05 ⚠).
  `bestClass` = ranking-1 of `lc_classifier`. Classifier-filtered cone queries also verified
  (note: the filter matches any classifier version; per-object probabilities are authoritative).
- **Pro/Public dual mode** (`src/config/mode.ts`): one codebase, two experiences. `?mode=` URL
  param (persists) or the ◆ PRO ⇄ ◇ Explore toggle; `.pro-only` elements (catalogs row, RA/Dec
  readout, fps/tile status, exposure, classifier detail) hidden in public. Two store listings can
  bake different defaults via the shell URL. Default = pro (customers are professionals first).
  Fixed a TDZ boot-killer (applyMode called before `const modeBtn` initialized — module-level
  ReferenceError silently stopped everything after it, including startLoop).
- **Native projects committed** (`ios/` via **SPM** — no CocoaPods; `android/` Gradle), generated
  by `cap add`, synced with the current build; template .gitignores exclude artifacts.
  **Honest status:** "Xcode is installed" wasn't true on disk yet (no Xcode.app found; CLT only —
  likely still downloading), and there's no Java/Android SDK — so the **binary builds are
  user-side**: docs/IOS.md + docs/ANDROID.md are one-click runbooks (`ios:sync`/`ios:open`,
  `android:sync`/`android:open`).

## 2026-06-12 — All-sky alert ingest + classification-coloured markers

- **All-sky ingest:** `tools/build-transients.mjs` now tiles the whole ZTF-visible sky
  (dec > −31) with a dense cone grid (RA count ∝ cos dec, radius ~8°, concurrency 4) — the
  broker's full-table `lastmjd` sort times out, but indexed cone searches don't. Merges +
  dedupes into an all-sky `tonight.json`. "Most of the heavy work the broker already does"
  (detection + ML classification); we ingest oid/position/recency/**class**.
- **Markers coloured by the broker's ML class** (not age): supernovae red-orange, AGN/QSO purple,
  pulsating/eclipsing blue, YSO/CV green, unclassified grey; recent alerts brighter; size ∝ ndet.
  `classGroup()` maps the ALeRCE taxonomy → 5 display groups.
- **Legend + per-class filter** (bottom-right): live per-group counts; tap a class to show/hide
  it across the whole sky. Real/bogus (`drb`) + full classifier ranking remain in the click panel.
- **Real-time seam:** the all-sky snapshot is the instant baseline (rebuilt nightly via the
  PHASE-8 cron); the runtime still fires a live cone query near the current view and merges, so
  what you're looking at is freshest. LSST host swaps in via the `SURVEY` adapter when stable.

## 2026-06-12 — Live alerts, Pro-gating, native builds (Xcode + Android Studio present)

- **Live alerts:** cone-cache TTL (30 s) + a 30 s poll while "Tonight" is on → fresh alerts stream
  in; "● LIVE · N alerts · updated Xs ago" indicator. Verified the broker serves single requests
  fine (it only throttles concurrent bursts — which is why the dense all-sky cone-grid ingest was
  abandoned for the runtime-live + small-snapshot model).
- **Classified snapshot:** the broker's **classifier-ordered** query (`order_by=probability`)
  returns the classified all-sky population; 3 pages = **709 alerts, all classified** (mostly LPV —
  the highest-confidence class). Markers now colour by class (blue/periodic here). Variety (SNe/AGN,
  which sit deeper in probability rank) is a nightly-cron deep-paging follow-up; the loose
  `class_name` filter can't isolate them.
- **Alerts are Pro-only** (`.pro-only` on Tonight/legend/live/HiPS-status) — hidden in Explore mode,
  shown in Pro. Verified both ways.
- **Native builds succeed on this machine:** Xcode 26.5 → `xcodebuild` **BUILD SUCCEEDED**
  (iphonesimulator, SPM, no CocoaPods); Android Studio JBR + SDK android-36 → `assembleDebug`
  **BUILD SUCCESSFUL** → `app-debug.apk` (~18 MB). Both are user-side to *sideload* (signing/device).
- **ANTARES broker:** reachable but its search API is POST/Elasticsearch-DSL (not a simple GET) —
  the `ADAPTERS` seam in transients.ts supports adding it; deferred as a small follow-up. ALeRCE
  remains the working source.
- **UX fixes:** bottom status line stacked above attribution (overlap gone); the WASD/QE hint is
  spelled out on desktop and replaced with "pinch to zoom · tap to identify" on touch.

## 2026-06-12 — ANTARES primary broker + simpler public mode

- **ANTARES (NOIRLab) is now the primary alert broker** (`BROKER='antares'` in transients.ts) —
  it carries the **real Rubin/LSST alert stream** (`lsst:` alert ids) plus ZTF, with community-
  filter **tags** (e.g. `high_amplitude_variable_star_candidate`, `lsst_scimma_quality_transient`,
  `lantern_xgboost` classifier), light curves (CSV), catalogue cross-matches and thumbnails —
  fuller than ALeRCE-ZTF and CORS-open. ALeRCE-ZTF kept as the alternate (`BROKER='ztf'`).
  Verified: ANT2020suiq → tags + 1188 detections + light curve in the panel.
  - cone search = `filter[cone]=ra,dec,radiusDeg` (caps ~10 loci/region); light curve from
    `/loci/{id}` `attributes.lightcurve` CSV (`ant_mjd`,`ant_passband`,`ant_mag`; empty mag = upper
    limit). Tags shown in the panel; `fetchProbabilities` short-circuits (ANTARES is tag-based).
  - Snapshot (`tools/build-transients.mjs`) rebuilt from ANTARES (recent pass + cone grid). The
    recent LSST window + cone caps make the all-sky baseline modest; the runtime live cone fills in
    per region, and each alert is richer. Honest trade: ANTARES = fewer-but-fuller vs ZTF's bulk.
- **Public (Explore) mode is now genuinely simple:** the observatory/survey picker is `.pro-only`
  (hidden), and an **auto-survey** picks the deepest survey for the view by declination
  (Pan-STARRS north / DES south) so telescope detail "just appears" on zoom — verified
  (survey row hidden, attribution auto-switched to Pan-STARRS). The public never sees observatory
  names. Alerts/ingest are Pro-only.

## 2026-06-12 — broker is a runtime toggle (ZTF default, LSST toggle) + GPS/gyro real-sky registration

- **Broker is now a runtime toggle, defaulting to dense ZTF.** Per the user ("ingest all alerts —
  does not have to be LSST, can be ZTF; LSST should be future or a toggle, or together with ZTF"):
  `activeBroker` (in transients.ts) defaults to **`'ztf'`** (ALeRCE) and a Pro **`⚡ ZTF ⇄ 🔭 LSST`**
  button flips to **`'antares'`** (Rubin/LSST). `setBroker()` clears the cone/lc/prob caches;
  `brokerName()`/`surveyLabel()`/`objectPageUrl()` are now functions of the active broker, and
  `loadSnapshot(broker)` loads the matching snapshot. Verified both ways in-browser (ZTF → 1146
  classified markers; LSST → the ANTARES set).
- **Dense classified ZTF snapshot (`tools/build-transients-ztf.mjs`).** Instead of a cone grid
  (ALeRCE throttles those), it pulls the most-recent objects of **each lc_classifier class**
  (SNIa/SNIbc/SNII/SLSN · QSO/AGN/Blazar/YSO/CV-Nova · LPV/E/DSCT/RRL/CEP/Periodic-Other) — one
  request per class, spaced out. Result: **1146 already-classified all-sky alerts** spanning every
  group, dec −28°→+83°, each keeping its ML class for marker colour. → `public/transients/tonight.json`.
  ANTARES snapshot kept as `public/transients/tonight-antares.json`. This is the "ingest all alerts,
  all classifications" ask, robust to throttling. ZTF is a northern survey (dec ≳ −28°); the deep
  south is covered by the imagery survey ladder and by the ANTARES/LSST toggle.
- **GPS + gyro/compass real-sky registration (`deviceSky.ts`).** The phone magic-window now has two
  modes, picked automatically: **ABSOLUTE** — altitude from the gravity-referenced gyro, azimuth
  from the compass (`webkitCompassHeading` on iOS / absolute `alpha` on Android), observer lat/lon
  from GPS, and Local Sidereal Time → real (RA, Dec) via the standard horizon→equatorial transform;
  hold the phone up and it shows the actual sky overhead and auto-switches N↔S. **RELATIVE** — the
  prior gyro-only window when GPS/compass are denied/unsupported. Altitude is exact; the azimuth
  `AZ_SIGN`/`AZ_OFFSET_DEG` knobs are the one thing to calibrate against a known star on a real phone.
  iOS `Info.plist` gained `NSLocationWhenInUseUsageDescription` + `NSMotionUsageDescription`; Android
  manifest gained `ACCESS_*_LOCATION` + compass/location `uses-feature` (optional). On-device.
- **UX:** search box moved top-right (was top-centre, overlapped the top-left HUD on narrow widths).

## 2026-06-13 — Rendering-bug root causes (sky sphere, survey switching, gyro feel)

- **Sky sphere `BackSide` → `DoubleSide`** (`src/sky/skySphere.ts`): `buildSkyGeometry` mirrors u
  for the inside-view RA convention, so its triangle winding made `BackSide` cull the *base sky*
  from the sphere centre — the cause of the missing half-sky / missing Milky Way. `DoubleSide` is
  winding-agnostic (same choice already proven on the HiPS tile meshes); full 360° base imagery
  and the Mellinger Milky Way are back.
- **`hips.clear()` was mis-attached to the auto-survey `if`** (`src/main.ts`): in Pro mode (where
  auto-survey is off) the `else` branch ran every frame and wiped the HiPS layer — the reason
  survey switching and zoomed tile streaming looked completely dead. Re-bound so tiles are only
  dropped on leaving Earth view (`else if (hips.tileCount)`); a comment at the call site records
  the trap.
- **Star-Walk-smooth gyro** (`src/core/deviceSky.ts`): sensor events now only write a *target*
  direction; the render loop eases the displayed direction toward it with a dt-corrected
  exponential filter, `alpha = 1 − exp(−dt/τ)` (τ ≈ 0.12 s gyro-only, 0.3 s compass-fused —
  compass heading jitters more, smooth harder). Easing the 3-D look **vector** (normalized lerp)
  instead of scalar yaw/pitch avoids the yaw ±π wraparound glitch. The compass is never used
  directly for azimuth: it estimates a slowly-corrected constant north offset for the (continuous)
  gyro frame, sampled only in poses where the heading is meaningful.

## 2026-06-13 — Zero-overlap app-frame redesign

- **One CSS app-frame, no floating HUDs:** top bar (brand + search + help + about + PRO toggle),
  accordion left dock (Imagery / Overlays / Live alerts / Tools — one section open at a time),
  docked right detail panel, time bar, and a one-line bottom status. Nothing overlaps anything at
  any width; on phones the dock collapses into a ☰ drawer. Pro ⇄ Public share the same shell
  (`.pro-only` hides sections rather than re-laying-out).
- **Reticle on every popup cutout:** the small circle marking "the object is HERE" now draws on
  every image we pop up — object panel cutout, transient field, the science/template/difference
  triptych stamps, and the FITS canvas — so no popup leaves the user hunting for the target.

## 2026-06-13 — FITS quantitative mode: manual DataView parse, no library

- **Parse hips2fits `format=fits` ourselves** (`src/data/fits.ts`, rendered by
  `src/ui/fitsView.ts`) rather than pull in a FITS library: the need is narrow (single-HDU images
  from one known producer) and a `DataView` reader covering BITPIX 8/16/32/−32/−64 with
  BZERO/BSCALE, NaN and BLANK handling is small, dependency-free and fully testable. References
  in-file: FITS 4.0 standard, Greisen & Calabretta 2002 for the gnomonic **TAN WCS**
  (pixel → RA/Dec, drives the hover per-pixel physical-value readout).
- **IRAF zscale display limits by default** (robust line fit over sorted samples → contrast-
  limited z1/z2 — the astronomer's expected default), stretches linear/log/√/**asinh** with asinh
  as the default (usable on both faint structure and bright cores).

## 2026-06-13 — Solar system + time machine

- **Ephemeris = JPL approximate Keplerian elements (valid 1800–2050) + truncated lunar theory**
  (`src/data/ephemeris.ts`): planets heliocentric J2000 ecliptic → geocentric → J2000 equatorial,
  arcminute-class accuracy; Moon ~1–2 arcmin. The lunar/solar theory natively yields
  ecliptic-of-date, so longitudes are precessed by −50.29″/yr to J2000 before converting with
  ε(J2000) — everything shares the app's ICRS/J2000 frame by construction. Moon gets topocentric
  parallax when an observer location is set; magnitudes are approximate (Müller/Meeus) and
  labelled approximate in the panel.
- **Validated against two hard historical anchors** (in the 8 ephemeris unit tests): the
  2020-12-21 Jupiter–Saturn great conjunction and the 2017-08-21 total solar eclipse — the latter
  both geocentric and topocentric from a point on the totality path. If those reproduce, the
  pipeline (elements, lunar theory, precession, parallax) is wired right.
- **Moon phase is drawn correctly:** illuminated fraction from Sun–Moon geometry, bright limb
  oriented toward the Sun.
- **Sim clock rebasing model** (`src/core/simTime.ts`): `sim(t) = baseSim + (realNow − baseReal) ·
  rate`, re-based on every rate/time change so there is no drift; rate 0 = paused, negative =
  backwards, ±1 s/s to ±1 yr/s from the time bar (−1d/+1d steps, click-date entry, ● Now, amber
  when warped). The whole solar-system/observability/horizon-grid pipeline reads this clock, not
  `Date.now()` — observability (alt/az/airmass, rise/transit/set, tonight curve) follows the
  warped time for free.

## 2026-06-13 — Stellarium-parity sweep

- **Messier fetched from SIMBAD TAP at build time** (`tools/build-messier.mjs` →
  `public/data/messier.json`), not hand-typed: 110 positions/types from the authoritative source,
  regenerable, and immune to transcription errors. Clickable labels with zoom decluttering.
- **IAU constellation boundaries** from d3-celestial GeoJSON (BSD-3, Olaf Frohn) — same vendored
  source as the stick figures, so the two stay mutually consistent.
- **Horizon (alt/az) grid rebuilt ~1 Hz** (`src/sky/grids.ts`): it depends on observer + sim
  time, so it cannot be static geometry like the equatorial grid; 1 Hz tracks even fast time-warp
  without per-frame rebuild cost. Precession circles added alongside the ecliptic.
- **📐 measure tool:** two-click great-circle separation in °/′/″ with a drawn arc, chainable —
  the missing quantitative companion to the FOV framing circle (5°→5′, true angular size).
- **Hotkeys + ⌘K:** single-key toggles (C/B/L/M/G/E/H/P/T/F, [ ] ±1 day, N now, / search, ? help)
  and a ⌘K/Ctrl-K command palette that lists commands and falls through to sky search.
- **ANTARES Streams dropdown** via `fetchByTag` (`src/data/transients.ts`): the broker's tag
  search is POST/ElasticSearch-DSL, so 12 community tags (e.g. `nuclear_transient`, anomaly
  detectors, `sso_confirmed`) are queried with a small DSL body — the follow-up deferred on
  2026-06-12 is done.

## 2026-06-13 — Good-neighbour hardening + CI gating

- **`politeFetch`** (`src/data/transients.ts`): on 429/503 it backs off exponentially,
  **honouring a `Retry-After` header when present**, max 3 tries, then degrades gracefully to the
  snapshot baseline instead of retry-storming the broker. Sits under the existing client rate
  limiters (CDS ≈4/s, brokers 3/s) and cone cache.
- **Hidden tabs stop polling** (`visibilitychange` in `src/main.ts`): live alert polling pauses
  when the tab is hidden and fires an instant catch-up fetch on return — no background traffic,
  no stale view on refocus. HiPS stays hotlinked + browser-cached, never mirrored.
- **CI: Pages deploy is manual-dispatch-only.** "CI / Deploy" runs typecheck + tests + build on
  every push (green), but the deploy job only runs on `workflow_dispatch` — Pages isn't enabled
  yet, and gating it keeps pushes green instead of failing on a deploy step that can't succeed.

## 2026-06-20 — Ephemeris: adopt astronomy-engine, retire the homegrown model

- **Switched `src/data/ephemeris.ts` to the `astronomy-engine` library** (Don Cross, **MIT**,
  ~90 KB, VSOP87/ELP-based) for Sun/Moon/planets, **replacing** the homegrown "JPL approximate
  Keplerian elements + truncated lunar theory" of 2026-06-13. **Why:**
  - **Accuracy jumps from arcminutes to arcseconds**, validated against **JPL Horizons**. The
    homegrown elements were arcminute-class at best.
  - **It fixes a real bug.** The approximate-elements code **omitted the JPL Table-2a correction
    terms** (the periodic terms applied to Jupiter–Neptune), which caused **~54′ error for Uranus
    and ~41′ for Neptune** — nearly a full degree, enough to put a planet in the wrong place at the
    eyepiece. astronomy-engine's VSOP87 series has no such gap.
  - **MIT licence** — commercial-friendly, no redistribution blocker (see DATA-LICENSES.md /
    SCALING-COMMERCIAL.md). Small enough (~90 KB) to bundle without hurting the $0/static design.
- **What the new ephemeris gives us:** Sun/Moon/planets in **J2000 ICRS**, **aberration-corrected**,
  **topocentric** when an observer location is set; planet magnitudes that **include Saturn's ring
  tilt**; the Moon's **illuminated fraction / phase exact** (no longer a truncated-theory
  approximation). The whole solar-system/observability/horizon pipeline still reads the sim clock,
  so nothing downstream changed.
- **Verified live:** 2017 eclipse Sun–Moon separation 0.109°, new-moon illuminated fraction 0,
  Saturn 0.24 mag, Neptune 7.82 mag, Moon 377447 km. The two historical anchors (2020 great
  conjunction, 2017 total eclipse) still pass in the ephemeris unit tests.
- **The homegrown model is retired** — the 2026-06-13 "approximate elements + lunar theory" entry
  is superseded by this one. (Magnitudes are no longer labelled "approximate"; they're library
  values to arcsecond-consistent precision.)

## 2026-06-20 — Lomb-Scargle period-finding (browser-direct)

- **Added a Lomb-Scargle periodogram + phase-folding** (`src/data/periodogram.ts`, unit-tested),
  wired into the Pro transient/alert panel. **Why Lomb-Scargle:** it is *the* standard period
  estimator for **unevenly-sampled** survey light curves — exactly what ZTF/LSST photometry is —
  where a plain FFT can't be used. Covers the bread-and-butter periodic populations: variable
  stars, eclipsing binaries, RR Lyrae / Cepheids.
- **How it presents:** runs on the **best-sampled photometric band**, shows the periodogram and,
  when the peak is significant, the **phase-folded light curve** plus
  "P = … · FAP … · significant/tentative" (false-alarm probability gates the "significant" claim,
  honouring the accuracy-first guardrail — a tentative peak is labelled tentative).
- **Pure client math, no backend** — fits the $0/static design; no token, no proxy.
- **Verified live** on RR Lyrae **ZTF18abntqrg** → **P = 11.75 h, FAP < 0.1%**, independently
  corroborating the broker's ML classification "RRL 85%".

## 2026-06-20 — Rendered horizon, CSV export, label gating, gyro + UI polish

- **Rendered horizon** (`src/sky/horizon.ts`) instead of just the alt/az *grid*: a translucent
  ground hemisphere below the horizon (dims the below-horizon sky), a bright horizon line, and
  N/E/S/W cardinal markers, built from observer location + time — the Stellarium/Star-Walk ground
  that makes "what's actually up right now" read instantly. Works in both look-around and phone-gyro
  modes; on the existing "Horizon" toggle.
- **Light-curve CSV export** (detections + upper limits) — a no-backend client download (Blob URL),
  available to **all** users, so anyone can take the photometry into their own tools.
- **Bug fix: Messier labels are now gated to the planetarium (Earth) view** — they were floating
  over the deep-space flythrough where they're meaningless; now hidden once you leave Earth, like
  the other Earth-view overlays.
- **Gyro smoothing tuned smoother** (`SLERP_TAU` 0.13, `DRIFT_TAU` 2.5) — a small comfort tweak on
  the device-sky filter.
- **UI de-boxed** — panels softened (less boxy radii), modern sliders / dropdowns / scrollbars; a
  visual-polish pass, no behavioural change.
