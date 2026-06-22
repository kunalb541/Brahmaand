# 07 — Pitfalls: The Problems We Will Face

> Part of the VR Astronomy App blueprint. This is the exhaustive "things that will bite us"
> catalog, compiled from the verified research dumps in `docs/research/`. Every pitfall lists
> **Symptom → Root cause → Mitigation → Bites in (phase)**. Items that rest on unverified
> claims carry a **VERIFY:** marker with a fallback plan.

**Phase key** (map by name if the roadmap doc numbers differently):

| Phase | Scope |
|---|---|
| P0 | Scaffold + offline Gaia pipeline |
| P1 | HiPS sky renderer (desktop) |
| P2 | Gaia 3D star field + flythrough |
| P3 | Object info (TAP/SIMBAD/Sesame/hips2fits) |
| P4 | WebXR / VR mode |
| P5 | Deploy, PWA, caching |
| P6 | Rubin alert layer |

---

## A. Precision, depth, and coordinates

### A1. float32 jitter at parsec scales

- **Symptom:** stars/camera visibly shake or "swim" during slow motion far from the origin;
  close flybys of a distant star wobble; picking rays miss.
- **Root cause:** float32 has a 24-bit significand (relative ε ≈ 1.19e−7). Three.js stores
  vertex data as `Float32Array` and applies transforms after precision is already lost; it has
  **no native floating origin**. With 1 unit = 1 pc, Gaia coordinates reach ~2×10⁴ — fine for
  absolute positions, but camera-relative differences of small magnitudes (sub-AU motion near
  a star at 8 kpc) cancel catastrophically in f32.
- **Mitigation:** Cesium-style camera-relative rendering (decided): authoritative camera
  position in **f64 on the CPU** (JS numbers are f64 — free); render camera pinned at origin;
  per chunk upload `uChunkOffset = chunkOriginF64 − cameraPosF64` (subtraction in f64, *then*
  truncate to f32); vertex positions in chunks are **chunk-local** small numbers. Recompute the
  culling frustum from the offset camera. Unit = parsec, never meters.
- **Bites in:** P2 (first flythrough), regression risk forever after.

### A2. Logarithmic depth buffer vs Points and vs the transparent sky sphere

- **Symptom:** enabling `logarithmicDepthBuffer: true` tanks fill-rate performance, breaks
  MSAA along intersections, and custom `ShaderMaterial` stars sort inconsistently against
  everything else (random occlusion).
- **Root cause:** log depth writes `gl_FragDepth` in the fragment shader → **disables early-Z**
  (three.js #17384); MSAA artifacts (#22017); vertex-only fallback bends large surfaces
  (#13047). With `ShaderMaterial` you must manually add `#include <logdepthbuf_vertex>` /
  `<logdepthbuf_fragment>` or your depth is in a different space than built-in materials'.
- **Mitigation (decided):** **no log depth in v1 at all.** Stars: `depthTest: false`,
  `depthWrite: false`, additive (order-independent). Sky sphere: drawn first,
  `renderOrder: -100`, `depthWrite: false`, camera-centered every frame. Only local opaque
  objects (UI panels, future planets) use the depth buffer with a sane near/far. Revisit log
  depth (or WebGPU reversed-Z) only when planetary surfaces arrive.
- **Bites in:** P1/P2 (tempting "fix" for depth-range angst), P4 (perf cost is fatal on Quest).

### A3. Sky sphere accidentally occluding or being clipped

- **Symptom:** stars vanish behind the sky; or the sky disappears entirely at certain zooms
  (far-plane clipping); or the sky shows parallax when flying.
- **Root cause:** sky sphere given depth write, or radius outside the far plane, or not
  re-centered on the camera.
- **Mitigation:** sky radius = any value comfortably inside the far plane; sphere position
  copied from camera every frame (trivial when camera is pinned at origin: position 0,0,0);
  `depthWrite:false`, drawn first via `renderOrder`. Fade the sky out 50→500 pc from the solar
  origin (it represents infinity; beyond that its baked stars show false parallax against the
  3D Gaia stars — see research/star-rendering §10).
- **Bites in:** P1, then P2 (the fade/parallax half).

### A4. int64 identifiers silently corrupted by JSON / float64

- **Symptom:** Gaia `source_id` or Rubin `diaObjectId` off by a few units after a round trip;
  cache keys collide; broker lookups 404.
- **Root cause:** both are int64 (e.g. `170226393632735260` > 2^53). `JSON.parse` produces
  float64 and silently rounds. TAP `FORMAT=json` returns them as JSON numbers.
- **Mitigation:** never let an id pass through `Number`. For TAP queries that return ids,
  request `FORMAT=csv` and keep ids as strings, or pre-process the raw JSON text to quote
  id fields before parsing; store as `string`/`BigInt`. In binary chunks, ids (if shipped) are
  8-byte fields read via `DataView.getBigUint64`. Same rule for broker payloads (P6).
- **Bites in:** P0 (pipeline), P3 (click-through lookups), P6 (alerts).

### A5. Galactic-frame HiPS rendered in the wrong orientation

- **Symptom:** Mellinger Milky Way layer is rotated/skewed relative to DSS2; objects don't
  line up between layers.
- **Root cause:** `hips_frame = galactic` (Mellinger — verified) means tile HEALPix indices are
  in galactic coordinates, not ICRS.
- **Mitigation:** read `hips_frame` from `properties` (mandatory keyword); parent
  galactic-frame tile meshes under an `Object3D` carrying the fixed galactic↔ICRS rotation,
  or rotate vertices at build time. Keep the scene graph ICRS/J2000 everywhere else. Add the
  cross-survey alignment screenshot to visual regression (08-testing §5).
- **Bites in:** P1.

---

## B. Rendering and GPU

### B1. Texture upload jank

- **Symptom:** dropped frames whenever new sky tiles arrive; hitch on first look at a region.
- **Root cause:** `texImage2D` with an `HTMLImageElement` can trigger synchronous decode +
  format conversion on the main thread; even pre-decoded uploads + mipmap generation steal
  1–3 ms each on the GL thread. One careless tile = one dropped 11–13.7 ms VR frame.
- **Mitigation (decided, see 06-performance §3.1):** worker-pool `fetch` +
  `createImageBitmap({imageOrientation:'flipY'})`, transferred to main; immutable
  `texStorage3D` TEXTURE_2D_ARRAY pool; throttled `texSubImage3D` (≤ 1 tile and ≤ 2 ms per VR
  frame); `renderer.initTexture()` for any one-off textures so upload happens at a controlled
  moment, not first render.
- **Bites in:** P1 (visible as scroll hitching), fatal in P4.

### B2. `gl_PointSize` hard caps (Apple = 64 px)

- **Symptom:** bright stars render as small squares on Macs/iPhones while looking correct on
  other GPUs; star halos clamp.
- **Root cause:** WebGL only guarantees max point size 1.0; Apple M1/M2 report **64 px**; other
  GPUs 512–2048. **VERIFY:** Quest Browser/Adreno value (assumed ~1023) — query on device.
- **Mitigation:** query `gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)` at startup; clamp in the
  vertex shader; conserve energy by boosting intensity ×(s/c)² when clamped; render stars that
  *should* exceed ~32 px through the instanced-quad impostor pass (immune to the cap).
- **Bites in:** P2.

### B3. Points culled whole when their center leaves the frustum

- **Symptom:** large bright stars pop out of existence at screen edges.
- **Root cause:** some drivers cull a point primitive entirely once its center is outside the
  viewport, regardless of radius.
- **Mitigation:** the bright/big stars are impostor quads (B2), which survive partial
  visibility; bulk points are ≤ 2 px where the pop is invisible.
- **Bites in:** P2.

### B4. sRGB / colorspace mismatches (Three.js defaults!)

- **Symptom:** sky imagery looks washed-out or too dark; star colors mismatch between the
  HiPS layer and the point layer; colors shift after a three.js upgrade.
- **Root cause:** since r152 three.js enables color management: `renderer.outputColorSpace`
  defaults to `SRGBColorSpace` and materials encode linear→sRGB in the fragment shader.
  JPEG/PNG HiPS tiles are sRGB-encoded; if their textures are not tagged, they get treated as
  linear and re-encoded → double-gamma washout. Custom `ShaderMaterial`s bypass three's
  automatic encode entirely unless you add it.
- **Mitigation:** set `texture.colorSpace = THREE.SRGBColorSpace` on every tile texture (or
  use `SRGB8_ALPHA8` internal format in the texture-array pool so the *hardware* decodes);
  in custom shaders, do all math in linear and apply one explicit sRGB encode (or rely on the
  sRGB framebuffer). Add a unit "gray-card" visual test: a 50 % gray tile must render at the
  same value through both the built-in and custom material paths.
- **Bites in:** P1/P2; recurs at every three.js upgrade (F2).

### B5. Additive blending + per-fragment sRGB/tone mapping = washed-out clusters

- **Symptom:** dense star clusters and the galactic plane bloom to white far too early;
  overlapping halos look radioactive; enabling ACES tone mapping makes it worse.
- **Root cause:** when rendering straight to the canvas, three.js applies tone mapping and
  sRGB encoding **per fragment before blending**, so additive accumulation sums gamma-encoded
  values — mathematically wrong (energy non-linear).
- **Mitigation:** v1 (decided): accept it — set `material.toneMapped = false` on star
  materials, keep `renderer.toneMapping = THREE.NoToneMapping` (default), control brightness
  via the explicit exposure uniform; the error is only visible where many halos overlap.
  v2: render sky+stars into an RGBA16F **linear** target, blend additively there, then one
  fullscreen tonemap+encode pass. **VERIFY:** RGBA16F fill-rate headroom on XR2 Gen 2 before
  shipping the HDR path in VR (06-performance §3.3 — also conflicts with FFR's
  no-intermediate-targets rule).
- **Bites in:** P2 (visual quality), P4 (the v2 fix may be unaffordable in VR).

### B6. Naive magnitude scaling makes the sky look fake

- **Symptom:** bright stars look like ping-pong balls; faint stars invisible; flythrough
  brightness doesn't change as you approach a star.
- **Root cause:** stellar flux spans ~10^9.6 linear range; displays have 2–3 decades. Mapping
  magnitude → geometric size (the obvious approach) is the classic wrong look ("scaled discs").
- **Mitigation (decided, research/star-rendering §5):** store absolute magnitude; recompute
  apparent magnitude per frame from camera distance in the vertex shader
  (`m = M + 5(log10 d_pc − 1)`); map to **linear intensity** `I = exposure·10^(−0.4(m−m_ref))`
  with a user exposure control; constant ~2 px core size until saturated, then grow area as
  `sqrt(I)`; sub-pixel stars fade alpha rather than shrink. Stellarium/Gaia Sky converge on
  exactly this.
- **Bites in:** P2.

### B7. Seams between HiPS tiles (edge filtering + mipmap bleeding)

- **Symptom:** thin bright/dark lines along tile borders; sparkly borders at glancing angles;
  in atlases, neighboring tile imagery bleeds in at low mips.
- **Root cause:** three separate effects. (1) Bilinear filtering at a tile's edge clamps at the
  texture border while the neighboring pixel lives in a different texture/layer. (2) Texture
  *atlases* bleed across cells in mip levels (mip texels average across cell boundaries).
  (3) `generateMipmap` on partial-coverage PNG tiles (alpha = out-of-coverage) averages
  transparent black into edge mips → dark fringes.
- **Mitigation:** use a TEXTURE_2D_ARRAY (each layer mips independently — kills (2)) — already
  decided; `CLAMP_TO_EDGE` wrap; share **bit-identical** edge vertices between adjacent tile
  meshes (compute corner positions once per corner key, in f64, reuse); if hairlines persist,
  inset UVs by half a texel (`uv*(N−1)/N + 0.5/N`). For (3): premultiply alpha at decode or
  flood-fill border pixels in the worker before upload. **VERIFY:** the "use HiPS parent tile
  as mip level" optimization can itself seam — visual check before adoption.
- **Bites in:** P1.

### B8. HEALPix cell distortion at the poles

- **Symptom:** stretched/warped imagery near the celestial poles; wobbly straight features at
  the corners of order-0..2 tiles; texture swimming when panning near a pole.
- **Root cause:** HEALPix cells are curvilinear diamonds; edges are not great circles, and the
  4 base cells touching each pole are maximally distorted. A 2-triangle quad per tile
  bilinearly stretches the texture across exactly the worst geometry.
- **Mitigation (per HiPS spec §6.3.1 + healpix-math §6.3):** never render orders 0–2 (start at
  order 3 via the Allsky file); subdivide every tile quad into an n×n vertex grid with
  **n = 4 at order ≥ 3** (sub-pixel error), n = 8–16 if lower orders are ever drawn; interior
  vertices from stepping `(t,u)` in the HEALPix projection plane (NOT linear in RA/Dec); UVs
  linear in face (x,y) space. Add a pole-centered pose to visual regression.
- **Bites in:** P1.

### B9. Tile UV orientation: 8 possible wrong answers

- **Symptom:** sky renders but features are mirrored/rotated within each tile; star overlays
  don't line up with imagery.
- **Root cause:** the mapping from JPEG/PNG pixel rows to HEALPix cell corners is derived from
  spec Fig. 4 (E corner at FITS origin; JPEG/PNG stored top-down = vertical flip of FITS).
  Research rates the derived recipe (`uv(E)=(0,0), uv(N)=(1,0), uv(S)=(0,1), uv(W)=(1,1)` with
  `flipY=false`) **MEDIUM confidence**.
- **Mitigation:** **VERIFY:** first rendering spike must diff a recognizable field (Orion belt)
  against Aladin Lite (https://aladin.cds.unistra.fr/AladinLite/) and lock the orientation with
  a visual-regression baseline. Budget one day; there are exactly 8 candidate orientations —
  brute-force them if the derivation is wrong.
- **Bites in:** P1 (blocking, do first).

### B10. FFR artifacts on a star field

- **Symptom:** peripheral stars dim, shimmer, or vanish in VR.
- **Root cause:** fixed foveated rendering reduces peripheral shading resolution; bright
  point on black is the textbook worst case; three.js defaults foveation to **1.0 (max)**.
- **Mitigation:** set foveation explicitly per scene: 0.5 (sky imagery) / 0.3 (star field) on
  Quest 2 (06-performance §3.3); it's adjustable per frame. Re-tune on hardware.
- **Bites in:** P4.

### B11. Multiview stereo bug; Points under multiview

- **Symptom:** right eye renders with wrong projection ("loses the 3D effect"); flicker with
  antialias; point sprites broken per eye.
- **Root cause:** three.js WebGL-backend multiview has an open right-eye projection bug
  (mrdoob/three.js#32538, still open as of 2026-06-11; related #32151), and
  `gl_PointCoord`/Points under `OCULUS_multiview` has historically been fragile.
- **Mitigation:** ship `WebGLRenderer` with multiview **off**; re-evaluate after r185 and after
  #32538 closes. If multiview is ever enabled, re-validate the Points pass; instanced-quad
  impostors are the fallback for all stars.
- **Bites in:** P4.

### B12. WebGL context loss (especially on Quest)

- **Symptom:** black canvas; console "CONTEXT_LOST_WEBGL"; on Quest the whole tab may be
  killed with **no error at all**.
- **Root cause:** GPU memory exhaustion (see E2), driver resets, backgrounding.
- **Mitigation:** listen for `webglcontextlost` (preventDefault) / `webglcontextrestored` and
  rebuild GPU resources from CPU-side caches; keep all source-of-truth data (tile bitmaps in
  the decoded cache, star chunks in ArrayBuffers) CPU-side so restore is cheap; hard LRU
  ceilings so loss is rare in the first place.
- **Bites in:** P1 onward; most frequent in P4.

---

## C. Data services and network

### C1. CORS: ESA Gaia archive is browser-blocked; CDS is fully open

- **Symptom:** `fetch` to `gea.esac.esa.int` fails with a CORS error in the console (works in
  curl); preflights return 403 even from localhost.
- **Root cause (verified live 2026-06-11):** ESA Gaia TAP responses carry **no
  `Access-Control-Allow-Origin` header** and OPTIONS preflights return **403** (origin
  whitelist exists server-side; no public process to join it). ARI Heidelberg and NOIRLab
  Data Lab mirrors also lack CORS. Conversely, **all CDS services are `ACAO: *`** (verified):
  SIMBAD TAP + `/cone`, VizieR TAP, Sesame, hips2fits, MOCServer, alasky/alaskybis tiles.
- **Mitigation (decided):** browser-side Gaia queries go to **VizieR TAP**
  (`https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync`, table `"I/355/gaiadr3"` — quoted,
  it contains `/`). ESA archive is used only server-side in the offline pipeline. If direct
  ESA access ever becomes mandatory (e.g. DR4 before VizieR ingests it), a ~15-line Cloudflare
  Worker proxy is required — reserve the slot in the architecture. **VERIFY:** broker CORS
  (Fink/ALeRCE/ANTARES) is unprobed — test from a browser before P6; fallback is the same
  serverless proxy (which also absorbs their observed 502 flakiness).
- **Bites in:** P3 (if anyone wires ESA directly "because the pipeline already uses it"), P6.

### C2. HiPS partial-survey 404 storms

- **Symptom:** console floods with 404s; sky shows black holes; tile loader retries forever;
  CDS sees us hammering nonexistent URLs.
- **Root cause:** partial-sky surveys (SDSS9 = 36 %, Pan-STARRS = 78 %, Rubin FirstLook =
  0.057 % coverage) simply have **no tile files** outside coverage; out-of-coverage requests
  legitimately 404.
- **Mitigation:** prefetch the coverage MOC per survey (`{base}/Moc.fits`, or easier:
  MOCServer `?ID=...&get=moc&fmt=json` returns `{order:[pixels...]}` JSON — verified) and skip
  requests outside it; treat any residual 404 as "no coverage" (render transparent/black),
  cache the negative result, **never retry**. PNG tiles use alpha for out-of-coverage pixels —
  respect it in the shader.
- **Bites in:** P1 (the moment SDSS is added), P6 (Rubin's tiny footprint).

### C3. alasky `.webp` tiles ship with no Content-Type

- **Symptom:** `<img>`-based loaders or strict response-type checks fail on Rubin FirstLook
  tiles; works for jpg/png.
- **Root cause (verified):** alasky serves `.webp` with **no Content-Type header** (no Apache
  MIME mapping); webp is a de facto Aladin-Lite extension, not in HiPS 1.0 (only 3 CDS
  datasets serve it).
- **Mitigation:** always load tiles via `fetch → blob → createImageBitmap` (sniffs bytes,
  ignores headers) — already the decided pipeline. Pick format from the `hips_tile_format`
  properties keyword; treat webp as optional enhancement.
- **Bites in:** P1/P6.

### C4. hips2fits path and method gotchas

- **Symptom:** 404 from a URL that looks right; HEAD probe returns 405 and health checks
  "fail".
- **Root cause (verified):** the service lives ONLY at
  `https://alasky.cds.unistra.fr/hips-image-services/hips2fits` — bare `/hips2fits` is 404;
  HEAD is rejected (405), GET works.
- **Mitigation:** hardcode the full path; use GET for liveness checks; mirror at
  `alaskybis.cds.unistra.fr` for failover; cap requests to user-triggered cutouts (≤ 512², the
  service caps at 50 Mpixels). **VERIFY:** error behavior of the `object=` param for
  unresolvable names was never probed — handle non-200/non-image responses defensively.
- **Bites in:** P3.

### C5. Sesame's documented hostname is dead

- **Symptom:** name resolution fails with DNS errors.
- **Root cause (verified):** `sesame.unistra.fr` (and `sesame.u-strasbg.fr`,
  `sesame.cds.unistra.fr`) **do not resolve in DNS**. Older docs and snippets all point there.
- **Mitigation:** use `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?<name>` (verified
  working, CORS *); parse XML with `DOMParser` (~10 lines: `jradeg`, `jdedeg`, `oname`,
  `otype`). Avoid the `vizier.cds.unistra.fr` variant (302 redirect + CORS is fragile).
- **Bites in:** P3.

### C6. SIMBAD legacy endpoints lie (HTTP 200 + Java stack trace)

- **Symptom:** "successful" responses that crash the JSON parser.
- **Root cause (verified):** `sim-id?output.format=json` returns HTTP 200 whose body is a Java
  `NullPointerException` dump.
- **Mitigation:** never use legacy `sim-*` endpoints. Use `https://simbad.cds.unistra.fr/cone`
  (distance-sorted JSON via `RESPONSEFORMAT=json` — ideal for gaze/click) and SIMBAD TAP
  `FORMAT=json`. Read columns defensively from the `columns`/`metadata` arrays, not by index
  (the cone service self-reports version `2.7-SNAPSHOT`).
- **Bites in:** P3.

### C7. TAP query timeouts, row caps, and async-job etiquette

- **Symptom:** pipeline extraction dies at 60 s; async job returns exactly 3,000,000 rows
  (silently truncated); browser queries hang for minutes.
- **Root cause (verified):** ESA Gaia sync = 60 s timeout; async = 120 min; **anonymous async
  caps at 3 M rows** (registered = unlimited, free signup, 20 GB quota). SIMBAD TAP defaults
  to 50 k rows (hard 2 M), exec 1080 s default.
- **Mitigation:** the 4.68 M-row extraction (G < 12.5, plx/err > 5) **must run as a
  registered async job** (`Gaia.login()` + `launch_job_async`); poll `{job}/phase`; treat a
  row count equal to a known cap as an error, not success. Browser-side: only TOP-limited cone
  searches; UI timeout + abort controller at 10 s; sync only. **VERIFY:** wall-clock of the
  4.7 M-row join vs the 120-min cap (expected fine; split by hemisphere if not).
- **Bites in:** P0, P3.

### C8. CDS rate limits: ~5–6 req/s per IP, blacklist up to ~1 hour

- **Symptom:** all CDS services suddenly return errors for ~an hour; works from another
  network.
- **Root cause:** CDS-wide etiquette limit (SIMBAD FAQ + astroquery docs): exceeding ~5–6
  queries/s per IP can blacklist the IP. Shared across SIMBAD/VizieR (same infrastructure).
  A gaze-picking loop calling SIMBAD per frame will trip this instantly.
- **Mitigation:** one shared rate-limiter/queue module in front of ALL CDS calls
  (≤ 5 req/s aggregate), debounced gaze lookups (≤ 2 req/s), LRU response cache keyed on full
  URL. Tile fetches are static-file serving and not the same constraint, but keep concurrency
  at the §06 budgets and rely on browser cache + ETags. **VERIFY:** hips2fits/MOCServer real
  enforcement is undocumented — engineer to the documented number anyway.
- **Bites in:** P3 (first interactive picking build), P1 (tile-fetch storms from a buggy LOD
  loop).

### C9. CDS attribution and hotlink-vs-mirror compliance

- **Symptom:** none today — reputational/legal debt that surfaces later; or CDS asks us to
  stop.
- **Root cause:** HiPS hotlinking is the intended usage (Aladin Lite embeds load tiles directly
  from CDS), but the hipslist explicitly forbids **mirroring** without the copyright owner's
  agreement; surveys carry `obs_copyright`/`obs_copyright_url` (DSS2 requires the STScI
  acknowledgment); `hips_status=clonableOnce` governs cloning.
- **Mitigation:** display `obs_copyright` per active survey in the UI; never put our CDN in
  front of CDS (that *is* proxying/mirroring) — service-worker caching per user is fine;
  alasky↔alaskybis client failover; if traffic exceeds hobby scale, email
  cds-question@unistra.fr (**VERIFY:** no written hotlink-volume policy exists). If we ever
  self-host low orders, that's a clone — do it per the clonableOnce rules from the master.
- **Bites in:** P1 (build the attribution UI early), P5.

### C10. Alert brokers: flaky endpoints, unknown CORS, nJy units

- **Symptom:** intermittent 502s from Fink LSST endpoints; magnitudes look absurd.
- **Root cause (verified):** Fink `api.lsst.fink-portal.org` returned intermittent 502s on
  some endpoints; broker photometry is **nJy flux**, not magnitudes; ZTF-era endpoint shapes
  don't exist on the LSST hosts (`/api/v1/latests` is 404 there).
- **Mitigation:** adapter-per-broker behind a `TransientProvider` interface with retry +
  failover (ALeRCE `api-lsst.alerce.online` GET API ↔ Fink POST API — same `diaObjectId`
  resolves in both, verified); convert `mag_AB = −2.5·log10(flux_nJy·1e−9/3631)`; plan a thin
  caching proxy if browser CORS fails (**VERIFY:** broker CORS unprobed). Handle
  `diaObjectId` as string/BigInt (A4).
- **Bites in:** P6.

### C11. Untrustworthy HiPS metadata (`hips_pixel_scale`)

- **Symptom:** LOD order selection wildly wrong for some surveys.
- **Root cause (verified):** DSS2 publishes `hips_pixel_scale = 0.229`, which contradicts the
  spec's "degrees" unit and the order-9 math (~8e−4 deg).
- **Mitigation:** compute pixel scale from `hips_order` + `hips_tile_width`
  (`pix ≈ sqrt(4π/12)/(tileWidth·2^K)`); never trust the keyword. Also generalize the
  "+9 order shift" to `log2(hips_tile_width)` — a future Rubin HiPS may use 256 px tiles.
- **Bites in:** P1.

---

## D. Gaia data

### D1. Negative/zero parallaxes and 1/parallax bias

- **Symptom:** NaN/Infinity positions in the pipeline; stars at absurd distances; the catalog
  visibly "shells" or smears radially.
- **Root cause:** parallax is a noisy measurement that can be ≤ 0; `d = 1000/plx` on noisy
  values is biased (Lutz–Kelker-type) even when positive.
- **Mitigation (decided):** use Bailer-Jones EDR3 distances (`r_med_geo`, fallback
  `r_med_photogeo`) joined on `source_id`; selection cut `parallax_over_error > 5` (live
  counts: G<11.5 → 1,937,515 stars; G<12.5 → 4,683,166); skip the parallax zero-point
  correction (negligible for visualization — document why). Pipeline asserts: no NaN, no
  d ≤ 0, no d > 50 kpc in output chunks.
- **Bites in:** P0.

### D2. The Bailer-Jones table name trap

- **Symptom:** ADQL error "table gaiadr3.gaiadr3_distance does not exist".
- **Root cause (verified live):** on the ESA archive the table is
  **`external.gaiaedr3_distance`** (EDR3 ids — valid to join with DR3, same source list).
  Many online snippets use wrong names. VizieR's copy is catalog `I/352`; GAVO's is
  `gedr3dist.main`.
- **Mitigation:** hardcode `external.gaiaedr3_distance` in the pipeline; note
  `r_med_photogeo` **can be NULL** → fallback order: photogeo → geo. **VERIFY:** NULL
  fractions for `bp_rp`/`teff_gspphot`/`r_med_photogeo` in our cut (run the COUNT queries)
  to finalize color/distance fallbacks.
- **Bites in:** P0.

### D3. Brightest stars are missing or saturated in Gaia

- **Symptom:** Sirius, Betelgeuse, the Pleiades brightest members — missing or with garbage
  astrometry; the naked-eye sky looks wrong in the flythrough.
- **Root cause:** Gaia saturates around G ≲ 3; some very bright stars lack DR3 entries or have
  unreliable parallaxes.
- **Mitigation:** patch the bright end from **ATHYG v3.3**
  (https://codeberg.org/astronexus/athyg, ~2.55 M stars, CC BY-SA 4.0, precomputed XYZ +
  proper names) for G ≲ 3–4; dedupe by position+magnitude against Gaia rows. **VERIFY:** exact
  list of bright stars needing the patch; and confirm license interplay (Gaia CC BY-SA 3.0 IGO
  attribution + ATHYG CC BY-SA 4.0) for the shipped binary chunks — attribution strings in the
  app's data credits.
- **Bites in:** P0/P2 (instantly visible to any stargazer).

### D4. DR4 lands 2026-12-02 with new source_ids

- **Symptom:** pipeline assumptions (table names, counts, id-based chunking) silently break
  when re-run against DR4.
- **Root cause:** DR4 (verified date 2 Dec 2026) is a new source list — source_ids are NOT
  stable across DR3→DR4; no Bailer-Jones-style distance catalog will exist at release.
- **Mitigation:** parameterize the pipeline by release (`gaiadr3.gaia_source` etc. in one
  config); pin v1 to DR3 + BJ-EDR3; treat DR4 adoption as a deliberate migration (re-run
  counts, re-decide distance source). **VERIFY:** whether/when a DR4 distance catalog appears.
- **Bites in:** P0 (design), post-launch.

### D5. `source_id >> 35` = HEALPix order-12 index — unverified

- **Symptom:** chunk naming/spatial bucketing by source_id puts stars in wrong cells.
- **Root cause:** the encoding (`healpix12 = source_id >> 35`, BigInt required) is from memory,
  **MEDIUM confidence**.
- **Mitigation:** **VERIFY:** against the official Gaia DR3 data model
  (https://gea.esac.esa.int/archive/documentation/GDR3/) before using it; the safe path
  (decided in the pipeline doc) computes HEALPix/octree cells from ra/dec/distance directly
  with healpy — never trusts the id encoding.
- **Bites in:** P0.

---

## E. Platform and WebXR

### E1. iOS Safari: no WebXR, gated sensors, tight memory, 7-day storage eviction

- **Symptom:** "Enter VR" missing on iPhone (correct); gyro look-around silently does nothing;
  tab reloads under memory pressure; returning users find their cached catalog gone.
- **Root cause (verified):** iOS Safari has **no WebXR** in 2026 (immersive-vr is visionOS
  Safari only). `DeviceOrientationEvent.requestPermission()` exists on iOS 13+ and **must be
  called from a user gesture on HTTPS**, resolving 'granted'/'denied'. three.js removed
  `DeviceOrientationControls` (~r134). Safari caps script-writable storage (~1 GB, prompted in
  200 MB steps) and **evicts all of it after 7 days of non-use** for non-installed web apps.
  **VERIFY:** practical iOS tab memory ceiling for our GPU usage (commonly ~1–1.5 GB,
  device-dependent) — test on hardware; keep the mobile texture/point budgets (06 §2) small.
- **Mitigation:** mobile = magic-window 3D app: pointer-drag look-around always; opt-in gyro
  behind a visible button calling `requestPermission()` in the click handler; vendor a
  DeviceOrientation camera controller; mobile asset budget tier (stop at G < 9 catalog,
  96-tile pool); sell offline mode as a Chrome/installed-PWA feature, not Safari.
  **VERIFY:** `webkitCompassHeading` behavior for north-aligned "point phone at sky" mode.
- **Bites in:** P4/P5.

### E2. Quest Browser texture-memory crashes (no error, no warning)

- **Symptom:** after minutes of sky browsing the tab dies or the context is lost; nothing in
  the console; works fine for shorter sessions.
- **Root cause:** no documented WebGL texture-memory cap on Quest Browser; exceeding the real
  limit → context loss/tab kill with no useful error. three.js never frees GPU textures
  without explicit `dispose()`.
- **Mitigation:** hard LRU ceilings (06 §2: ≤ 350 MiB total GPU textures on Quest 2 —
  **VERIFY:** via on-device stress test, allocate array layers until context loss and set the
  ceiling at ≤ 60 %); fixed-size texture-array pool (never grows); `renderer.info.memory`
  watched by the DevHUD with assertions; context-loss recovery path (B12).
- **Bites in:** P4.

### E3. WebXR session loss / visibility changes

- **Symptom:** user removes headset or opens the system menu → the app's loop stops; on
  return, the scene is frozen, controls dead, or desktop UI is broken after `sessionend`;
  timers that assumed frames kept running have wrong state.
- **Root cause:** the XR session drives the animation loop; on visibility change rAF stops
  (session `visibilitychange` → `hidden`), and sessions can end at any time without the user
  clicking our UI. OrbitControls left disabled, camera rig left at XR pose, etc.
- **Mitigation:** treat `sessionstart`/`sessionend` (renderer.xr events) as full mode
  transitions: save/restore desktop camera + controls state; never accumulate time from frame
  counts (use timestamps); pause network prefetch on hidden; on `sessionend` re-enable
  OrbitControls and re-run a resize. Test with the Immersive Web Emulator's session-end
  control every sprint (08-testing §7 checklist).
- **Bites in:** P4.

### E4. Secure-context surprises in dev (HTTPS for headset/phone testing)

- **Symptom:** `navigator.xr` is `undefined` on the phone/headset but fine on the dev machine;
  gyro permission never prompts; emulator works, device doesn't.
- **Root cause (verified):** WebXR and `DeviceOrientationEvent.requestPermission` require a
  secure context. `http://localhost` IS secure (emulator dev needs no cert), but
  `http://192.168.x.x:5173` from another device is NOT.
- **Mitigation:** dev recipes, in order: (1) emulator on localhost — zero setup;
  (2) `@vitejs/plugin-basic-ssl@2.3.0` (or `vite-plugin-mkcert@2.1.0`) + `vite --host` →
  accept the cert warning on device; (3) Quest over USB: `adb reverse tcp:5173 tcp:5173` →
  `http://localhost:5173` *on the Quest* is secure with no certs + enables `chrome://inspect`;
  (4) `cloudflared tunnel --url http://localhost:5173` for off-LAN testers.
- **Bites in:** P4 (first device test day — classically loses half a day).

### E5. GC stutter from per-frame allocations

- **Symptom:** periodic multi-ms hitches every few seconds/minutes, worse the longer the
  session runs; smooth in short profiles.
- **Root cause (verified, immersive-web/webxr#1010):** objects allocated per frame and still
  referenced at rAF end get tenured into old-space; major GC eventually fires mid-session.
  Three.js patterns that allocate: `Raycaster.intersectObjects`, `getWorldPosition(new
  Vector3())`, event payloads, array spreads in the loop.
- **Mitigation:** zero-allocation frame loop policy + scratch pools + throttled raycasting
  (06 §3.5); CI canary: 1,000-frame run asserting flat heap (08-testing §6.3).
- **Bites in:** P2 onward; surfaces "randomly" in P4 demos.

### E6. localStorage / storage quota misuse

- **Symptom:** `QuotaExceededError` from localStorage; star-chunk caching fails on Safari;
  Chrome quota mysteriously exhausted by tile caching.
- **Root cause:** localStorage is ~5 MB and synchronous (blocks the frame loop) — useless for
  data; Cache API quotas differ wildly (Chrome ≤ 60 % of disk per origin; Firefox ≤ 50 % free
  disk / 2 GiB safe floor per group; Safari ~1 GB + 7-day eviction). **Opaque (no-cors)
  responses are quota-padded ~7 MB each in Chrome** — caching tiles fetched without CORS
  explodes the quota.
- **Mitigation:** localStorage only for tiny prefs (< 50 KB); all data caching via the service
  worker Cache API with named caches + size budgets; ALWAYS fetch tiles with
  `{mode:'cors'}` before caching (CDS sends `ACAO:*`); call `navigator.storage.estimate()` to
  display usage and `navigator.storage.persist()` before bulk offline downloads.
- **Bites in:** P5.

### E7. Binary chunks don't compress on the CDN

- **Symptom:** chunk downloads are exactly their raw size; "the CDN will gzip it" doesn't
  happen.
- **Root cause (verified):** Cloudflare auto-compresses only whitelisted content types —
  `application/octet-stream` is **never** compressed; raw float32 barely compresses anyway
  (~5–15 %, high-entropy mantissas).
- **Mitigation (decided in deploy doc):** quantize (int16 positions in-cell, uint8 colors) +
  spatial sort + delta encode in the pipeline; pre-compress to `.bin.gz` and decode client-side
  with `DecompressionStream('gzip')` (universal); feature-detect `'brotli'`
  (**VERIFY:** per-browser support is new in 2026 — gzip fallback removes the risk).
  **VERIFY:** actual compression ratios on real Gaia chunks (estimated ~3×; benchmark in P0).
- **Bites in:** P0/P5.

### E8. GitHub Pages looks free but breaks three ways

- **Symptom:** catalog deploy fails at 1 GB; Range requests return corrupted data; COOP/COEP
  can never be set; cache headers uncontrollable.
- **Root cause (verified):** 1 GB published-site cap; no custom headers at all; CDN
  gzip-encodes some responses which breaks Range/Content-Length semantics on binary files.
- **Mitigation (decided):** Cloudflare Pages (app shell, `_headers` support) + R2 behind a
  custom domain (chunks, $0 egress; `r2.dev` subdomain is rate-limited dev-only). Pre-chunked
  whole-file GETs, never HTTP Range. GitHub Pages acceptable only for throwaway demos.
- **Bites in:** P5.

---

## F. Dependencies and ecosystem

### F1. npm package abandonment — the HEALPix library above all

- **Symptom:** a security audit, a TS upgrade, or a bug with no upstream response; or a
  license change pulls the rug (this **actually happened** in this exact niche: `healpixjs`
  switched to a commercial/non-commercial dual license at v2.0.0, April 2026).
- **Root cause:** the astronomy-JS ecosystem is tiny and bus-factor-1. Chosen lib
  `healpix-ts@1.1.0` (MIT, Development Seed, 2026-05-19) is maintained today; its upstream
  `@hscmap/healpix@1.4.12` is frozen since Oct 2022 (still correct — healpy-validated);
  `@fxpineau/healpix` WASM is stale since 2020; `jsvotable` is GPL-3 + stale (avoid — skip
  VOTable entirely, all services emit JSON); `three-mesh-ui` is dormant (use `@pmndrs/uikit`).
- **Mitigation:** (1) pin exact versions; (2) **vendor a snapshot** of the ~1-file
  `@hscmap/healpix` source (MIT) under `vendor/` as the drop-in fallback; (3) the healpy
  golden-vector suite (08-testing §3.1) makes any library swap or in-house port (~400 lines,
  port plan in research/healpix-math §5) verifiable in an afternoon; (4) self-host the
  `@webxr-input-profiles/assets` controller models instead of relying on jsDelivr at runtime.
- **Bites in:** P1 (choice), forever (maintenance).

### F2. Three.js version churn breaking `examples/jsm` (addons) imports

- **Symptom:** after a routine `npm update`, imports like
  `three/addons/webxr/XRButton.js` fail to resolve, shader chunks change names, color output
  shifts, or controls behave differently; online example code doesn't compile against our
  version.
- **Root cause:** three.js has **no semver** — breaking changes land in any rXXX release
  (~6–8 week cadence); addons under `three/addons/*` (`examples/jsm`) are the most churned
  surface (e.g. `DeviceOrientationControls` was removed entirely ~r134); web examples always
  target the latest release; `@types/three` must match the runtime version.
- **Mitigation:** pin **exactly** `three@0.184.0` + `@types/three@0.184.1` (no `^`); upgrade
  deliberately one release at a time against
  https://github.com/mrdoob/three.js/wiki/Migration-Guide with the visual-regression suite as
  the safety net; wrap renderer construction and all addons imports in our own modules
  (`src/platform/`) so churn is contained to one directory; vendor removed-but-needed
  controls (DeviceOrientation). Budget an upgrade pass every ~2 releases (~3–4 months).
  **VERIFY:** r185 (~June/July 2026) ships native-WebGPU XR — re-evaluate renderer choice then,
  not before.
- **Bites in:** every phase; worst when an upgrade is forced (security/bugfix) mid-milestone.

### F3. License contamination from reference implementations

- **Symptom:** none until someone diffs our shader against Aladin Lite's — then it's a legal
  problem.
- **Root cause:** the best HiPS reference (Aladin Lite v3) is GPL-3 per its npm metadata
  (the repo CHANGELOG shows a relicense to LGPL-3.0-or-later in v3.8.0 — embedding unmodified
  may be fine, but **copying code into our MIT-style app is not**); Stellarium Web Engine is
  AGPL-3; Celestia is GPL-2.
- **Mitigation:** hard rule — read GPL/AGPL code for algorithms only, implement clean-room
  from the spec + our research docs; the only permissive HiPS codebase to copy from is
  **wwt-webgl-engine (MIT)**; HEALPix math from michitaro/healpix (MIT) or cdshealpix
  (Apache-2.0 OR MIT). Record provenance in file headers for anything ported.
- **Bites in:** P1/P2 (when stuck on rendering math at 2 a.m.).

### F4. Runtime CDN dependencies you forgot you had

- **Symptom:** controller models fail to load in VR demos on a flaky network or if jsDelivr
  has an outage; app works in dev (cached) but not for fresh users.
- **Root cause:** `XRControllerModelFactory` defaults to fetching GLTFs from
  `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles` at runtime.
- **Mitigation:** self-host the profiles folder in our static assets; point the factory at it.
  Same policy for fonts, WASM transcoders (`KTX2Loader` basis files), and uikit assets:
  everything ships from our origin.
- **Bites in:** P4/P5.

### F5. Float16Array availability

- **Symptom:** chunk decode fails on older browsers (`Float16Array is not defined`).
- **Root cause:** `Float16Array` is Baseline only since April 2025 (Chrome/Edge 135,
  Firefox 129, Safari 18.2); older installs linger.
- **Mitigation:** feature-detect; ship a ~20-line uint16→float32 software decoder fallback
  (or use `DataView.getFloat16` where available — same baseline). Unit-test both paths with
  known bit patterns (08-testing §3.3).
- **Bites in:** P2.

---

## G. Quick-reference: the ten that will actually cost us a week each

| # | Pitfall | One-line insurance |
|---|---|---|
| 1 | B9 tile UV orientation | Day-one visual diff vs Aladin Lite, then a locked baseline image |
| 2 | A1 f32 jitter | Camera-relative rendering from the first star prototype, not retrofitted |
| 3 | B1 upload jank | Worker decode + 2 ms upload budget built into the tile loader's first version |
| 4 | C1 ESA CORS | All browser Gaia via VizieR `"I/355/gaiadr3"`; ESA is pipeline-only |
| 5 | E2 Quest texture death | Fixed-size texture-array pool + dispose discipline + DevHUD assertions |
| 6 | B5/B4 color pipeline | Gray-card test + `toneMapped=false` on stars + sRGB-tagged tiles |
| 7 | C8 CDS blacklisting | One global rate limiter (≤5 req/s) in front of every CDS call |
| 8 | D1/D2 distances | Bailer-Jones `external.gaiaedr3_distance`, plx/err>5, NaN asserts in pipeline |
| 9 | F2 three.js churn | Exact pins + platform wrapper modules + visual regression before upgrades |
| 10 | E4 dev HTTPS | Documented dev recipes (localhost / basicSsl / adb reverse) in the README |
