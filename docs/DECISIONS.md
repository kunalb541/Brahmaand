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
