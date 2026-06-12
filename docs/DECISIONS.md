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
