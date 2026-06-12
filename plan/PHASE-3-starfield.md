# PHASE 3 — 3D star-field flythrough (day-1 ATHYG data) — execution runbook

```yaml
phase: 3
milestone: M3
deliverable: Leave Earth and fly through a real 3D star field. A hybrid Three.js renderer
             (THREE.Points bulk pass + instanced-quad impostors for bright stars) consuming the
             GSC1 binary chunk format, fed on day 1 by a small ATHYG→chunk script (NO dependency
             on the Gaia pipeline), with camera-relative (floating-origin) rendering, in-shader
             photometry + exposure, octree LOD streaming, fly controls, and a planetarium↔space
             mode transition that fades the PHASE-2 HiPS sphere out as you leave the Sun.
depends_on: PHASE-2 (the HiPS sky sphere + setGlobalFade hook + per-frame loop + camera rig),
            PHASE-1 (src/math/frames.ts, LookControls.pointAt)
feeds: PHASE-4 (produces real Gaia GSC1 chunks that REPLACE the ATHYG day-1 chunks with zero
                runtime change — same manifest schema), PHASE-5 (3D star picking),
       PHASE-6 (per-eye sizing of the star shader in VR)
design_docs: docs/04-star-catalog-pipeline.md  ← PART B (Runtime) IS THIS PHASE. Read it fully.
             Every step cites the §B-N it realizes. §A8/§A9 (chunk + manifest format) is the
             contract the day-1 script must honor byte-for-byte.
             Also docs/01-architecture.md, docs/06-performance.md (budgets), docs/07-pitfalls.md
             (float32 precision, sRGB additive, gl_PointSize clamp).
research: docs/research/star-rendering.md (photometry, impostors, precision, prior art),
          docs/research/gaia-pipeline.md §A4 (ATHYG), docs/research/performance-quest.md
est_effort: 5–8 sessions
risk: HIGH — shader photometry tuning, camera-relative precision plumbing, and LOD heuristics are
      the most novel engineering in the app. The day-1 ATHYG path keeps it unblocked by PHASE-4.
```

> **Why ATHYG first (doc 04 §A4 "Day-1 fallback"):** the runtime cannot tell ATHYG chunks from
> Gaia chunks — same `GSC1` format, same `manifest.json` schema. Building the runtime against a
> 330 k-star ATHYG set means PHASE-3 ships a working flythrough *before* the heavy Gaia pipeline
> (PHASE-4) exists, and PHASE-4 is then a pure data swap. Do **not** reach for Gaia here.

> **The two correctness fundamentals of this phase (doc 04 §B5, §B6):**
> 1. **Camera-relative rendering** — the authoritative camera position is **float64 on the CPU**;
>    the Three.js camera stays at the rig origin; per-chunk `uChunkOffset = chunkCenter − cameraPos`
>    is computed in f64 then truncated to f32. Skip this and flybys jitter past ~1e5 pc.
> 2. **Photometry, not size∝brightness** — stored absolute mag → per-frame apparent mag from camera
>    distance → linear intensity; size stays constant and only grows (as √I) past saturation.
>    `size ∝ brightness` is the classic "ping-pong-ball stars" bug — banned.

---

## Step group 0 — Day-1 data: ATHYG → GSC1 chunks (`tools/athyg-daydata/`)

Realizes doc 04 §A4 (day-1 fallback) producing the §A8/§A9 format. This is a **small standalone
Node/TS script**, not the Python pipeline — it must emit the *identical* format so PHASE-4 swaps in
cleanly. Keep it ≤ ~250 lines.

### 0.1 Acquire ATHYG mag ≤ 10 subset

```bash
mkdir -p tools/athyg-daydata/data
# VERIFY exact raw paths by browsing https://codeberg.org/astronexus/athyg (data/ dir).
# The mag<=10 subset (~330k stars) is the target; if only full files exist, download and filter.
curl -L -o tools/athyg-daydata/data/athyg_mag10.csv.gz \
  "https://codeberg.org/astronexus/athyg/raw/branch/main/data/subset/athyg_v33_mag10.csv.gz"  # VERIFY path
```

License: **CC BY-SA 4.0** — credit "ATHYG v3.3, astronexus.com, CC BY-SA 4.0" goes in the manifest
`attribution` array and the app About panel (doc 04 §A4).

### 0.2 `tools/athyg-daydata/build.ts` (run with `tsx`)

Per star, from ATHYG columns (`ra` deg, `dec` deg, `dist` pc, `ci` = B−V, `mag`, `proper`):

1. **Distance:** use ATHYG `dist` (pc) directly; drop rows with `dist ≤ 0` / non-finite.
2. **XYZ (ICRS axes, parsecs):** doc 04 §A6 — `x=d·cosδ·cosα, y=d·cosδ·sinα, z=d·sinδ`. Store
   **ICRS axes** (pre-swizzle) — the runtime applies `three.xyz = icrs.yzx` once (doc 04 §B4).
3. **Absolute mag:** `M = mag − 5·(log10(dist) − 1)` (doc 04 §A6).
4. **Color index:** `ci` (B−V) → Teff via the **unmodified Ballesteros** formula (doc 04 §A5 — it
   is *defined* for B−V, so no approximation caveat here) → palette index (doc 04 §A5 log-spaced
   1500–40000 K). Generate the 256-entry **linear-light** palette with `palette.py`'s logic ported
   to TS (or precompute it once and inline the array). NULL `ci` → 6500 K.
5. **Flags (doc 04 §A7):** bit 0 (ATHYG-patched) = 1 for all (this IS ATHYG); bit 1
   (bright-impostor) = 1 when `M < −1.0`.
6. **Names sidecar:** harvest `proper` → `names.json` (`{ "<id>": "Sirius", ... }`) — NOT in chunks
   (doc 04 §A4).

### 0.3 Chunk + manifest writer

For day 1 you may emit a **single octree level is overkill** — but to keep the format identical and
PHASE-4 a true no-op, build a *minimal octree* (doc 04 §A7 algorithm, `CAPACITY=65536`): for 330 k
stars that yields ~6–10 chunks. Write each as `GSC1` (doc 04 §A8 byte layout — magic `GSC1`,
version 1, chunk-relative f32 xyz, f16 absMag, u8 colorIdx, u8 flags) and a `manifest.json` (doc 04
§A9 schema, `release:"athyg-v3.3"`, the linear palette, attribution). gzip each chunk
(`c{id:04}_{sha256[:8]}.bin.gz`). Output to `public/catalogs/athyg-v3.3/`.

> Reuse the magnitude-stratified insertion (sort ascending by apparent `mag` first) so the root
> chunk already reproduces the naked-eye sky (doc 04 §A7) — this matters for first-paint and for
> the acceptance test "Orion recognizable from the root chunk."

### 0.4 Round-trip check

A tiny `build.test.ts`: decode chunk 0 back, assert Sirius (α CMa, RA 101.287°, Dec −16.716°) is
present within 0.05° when converted back to ra/dec and carries flag bit 0 (doc 04 §A11.4). Assert
`sum(chunk.starCount) === manifest.starCount`.

**Gate:** `public/catalogs/athyg-v3.3/manifest.json` + chunks exist and round-trip. Now the runtime
has real data to consume.

---

## Step group 1 — Manifest + chunk fetch + parse (runtime)

Realizes doc 04 §B2, §B3.

### 1.1 `src/stars/manifest.ts`

Fetch + validate `CatalogManifest` (doc 04 §A9 schema). Assert `formatVersion===1`,
`axisMapping==='three.xyz = icrs.yzx'` (the runtime refuses a manifest it can't honor), expand
`palette` (256×[r,g,b]) into a `Uint8Array(768)`.

### 1.2 `src/stars/chunkFetcher.ts`

Copy **verbatim from doc 04 §B2**: `fetchChunk` (with `DecompressionStream('gzip')` and the
`byteLength` integrity check), the `(level asc, angularSize desc)` priority queue, backoff retry,
CPU-side `ArrayBuffer` LRU (256 MB Quest / 512 MB desktop). `MAX_CONCURRENT = isXRPresenting() ? 4
: 6`.

> **Trap (doc 07 / doc 04 §A10):** chunks are `application/octet-stream`, which CDNs do **not**
> auto-compress, so compression is baked in as `.gz`; the runtime always decodes with
> `DecompressionStream('gzip')`. Do not assume the transport compressed it.

### 1.3 `src/stars/chunkParser.ts`

Copy **verbatim from doc 04 §B3**: zero-copy typed-array views over `GSC1` (positions `Float32Array`
at byte 16, `absMagBits` `Uint16Array` at `16+12N`, `colorIdx`/`starFlags` `Uint8Array`), plus the
palette expansion to a `colors` `Uint8Array(3N)`. Add the magic/version/size guards.

### 1.4 Parser test

Feed `tools/athyg-daydata` chunk 0 through `parseChunk`; assert `starCount`, that positions are
finite, and that `colors` are non-zero. (Reuses real day-1 data — no synthetic fixture needed,
though a 2-star synthetic GSC1 buffer is a nice-to-have for edge cases.)

---

## Step group 2 — Geometry + impostor split (runtime)

Realizes doc 04 §B4, §B8.

### 2.1 `src/stars/starChunk.ts`

Copy `buildGeometry` (doc 04 §B4) **verbatim** — note the **in-place axis swizzle**
`three.xyz = icrs.yzx` done once here, the `Float16BufferAttribute` for `aMag` (with the VERIFY note
+ Float32 fallback), and the normalized `aColor`. Copy `buildPoints` (`frustumCulled=false`,
`renderOrder=10`, `matrixAutoUpdate=false`). Store the chunk's **swizzled** `center` (f64 JS number
Vector-like) on the chunk object for §B5.

### 2.2 Pre-split bright stars (doc 04 §B8)

At parse time, partition each chunk's index range into **bulk** (flag bit 1 clear) and **impostor**
(bit 1 set) ranges — the recommended pre-split avoids a per-vertex branch for 99.9% of stars. Bulk
indices → the Points geometry; impostor stars → the instanced pass (step 4).

---

## Step group 3 — Star ShaderMaterial (bulk Points pass)

Realizes doc 04 §B6 — the photometric heart.

### 3.1 `src/stars/starMaterial.ts`

Copy `createStarMaterial` + `STAR_VERT` + `STAR_FRAG` **verbatim from doc 04 §B6**. Key points:
- Uniforms shared across all chunk materials (one write updates all): `uExposure`, `uMRef=6.5`,
  `uMinPointSize`, `uCoreSizePx`, `uMaxPointSize`, `uSizeScale`, `uFade`; per-chunk `uChunkOffset`.
- `AdditiveBlending`, `transparent:true`, `depthWrite:false`, `depthTest:false` (doc 04 §B1 — **no
  `logarithmicDepthBuffer` anywhere**; stars are additive light over the depth-less sky sphere).

### 3.2 Capability probe (mandatory — doc 04 §B6)

```ts
const gl = renderer.getContext();
const maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];  // spec guarantees only 1.0!
const uMaxPointSize = Math.min(maxPt, isXRPresenting() ? 8 : 64); // Apple GPUs report 64
```

> **Trap (doc 07):** `gl_PointSize` is clamped per-GPU (64 px on Apple M1/M2). Truly bright stars
> must go through the impostor pass (step 4), not rely on huge points. The shader's energy-conserving
> clamp (doc 04 §B6) is only a safety net.

### 3.3 `uSizeScale` wiring

`uSizeScale = drawingBufferHeight / 1080` on resize; per-eye height in XR (PHASE-6). A single shared
value is fine in v1 (doc 04 §B6).

---

## Step group 4 — Bright-star impostor pass

Realizes doc 04 §B8. One `InstancedBufferGeometry` quad pass per chunk for flag-bit-1 stars:
per-instance position (3×f32, swizzled), color (3×u8), absMag (f16). Vertex shader = the **same**
photometric math as §B6 but billboards corners from the view-matrix basis and sizes in
world-space→pixels (no `gl_PointSize` clamp); fragment = same PSF (+ optional diffraction-spike
texture later). `renderOrder=11`, additive, no depth. Budget ≤ 5 k sprites in view (doc 04 §B7
table). Start simple: a single shared quad, per-instance attributes; defer diffraction spikes to a
polish pass.

---

## Step group 5 — Camera-relative rendering (the precision refactor)

Realizes doc 04 §B5 — **this phase introduces the floating origin**; do it deliberately.

### 5.1 The authoritative f64 camera — `src/core/locomotion.ts`

- `cameraPos: {x,y,z}` as plain JS numbers (**f64**) — owned here, not by `THREE.Camera`.
- The `THREE.PerspectiveCamera` sits at the **rig origin**; orientation comes from LookControls
  (PHASE-1) for looking, and a new fly intent for moving (step 6). The rig never translates in
  world space for stars; instead, every chunk's offset moves.
- Per frame, per resident chunk: `uChunkOffset.set(cx−px, cy−py, cz−pz)` where `c*` is the chunk's
  swizzled f64 center and `p*` is `cameraPos` — subtraction in f64, then the `Vector3.set` truncates
  to f32 (doc 04 §B5). One scratch Vector3 per material; **zero allocation** in the loop.

### 5.2 Sky sphere stays camera-relative too

PHASE-2 already does `skyGroup.position.copy(camera.position)`. Since the THREE camera stays at
origin, the sky sphere is centered on the rig — correct. The HiPS imagery and the 3D stars share the
ICRS frame + the `yzx` axis mapping, so at the origin bright stars coincide with their imagery
counterparts (acceptance test 7).

### 5.3 Sanity test

Unit-test the offset math: a chunk centered at icrs `(1e4,0,0)` pc with the camera at the same
position must yield `uChunkOffset ≈ (0,0,0)` (within f32 epsilon) — proving no precision loss at
flythrough scale.

---

## Step group 6 — Fly controls + mode transition

Realizes doc 04 §B9 + the roadmap's "travel-to-star / mode transition" deliverable.

### 6.1 Fly intent

Extend `src/core/locomotion.ts`: WASD (+ Q/E up/down) translate `cameraPos` along the LookControls
look basis; pointer still rotates (LookControls). **Speed scales with distance to the nearest
resident star** (or to the origin when near the Sun) so you don't crawl in deep space or rocket
through the solar neighborhood — `speed = clamp(k · nearestDist, minSpeed, maxSpeed)`. Hold-Shift =
boost. This is the desktop path; PHASE-6 maps the same intent to XR thumbstick.

### 6.2 Planetarium ↔ space transition

Drive PHASE-2's `skyLayer.setGlobalFade(x)` from `dist = length(cameraPos)`:
`fade = 1 − smoothstep(50, 100, dist)` (doc 04 §B9 / doc 03 §13.5). At the Sun: sky fully visible,
stars overlaid. Past 100 pc: only stars (+ a future Milky Way backdrop — open question, v1 ships
black). Re-fade in on return. Add a "Return to Earth" button that flies `cameraPos` back to origin
(ease over ~2 s) and resets LookControls.

### 6.3 Travel-to-star

`flyTo(targetPosF64, durationS)` — eased translate of `cameraPos` toward a star/object (used by
PHASE-5 search "fly there" in 3D mode). Stop a few pc short so the target fills the view.

---

## Step group 7 — LOD walking, culling, fades, budgets

Realizes doc 04 §B7. Implement `src/stars/lod.ts` **following doc 04 §B7 step-by-step**:
breadth-first octree want-set (`THETA_LOD` 0.35 desktop / 0.45 VR), hysteresis (drop at 0.7×
threshold), per-chunk frustum cull by camera-relative bounding sphere (chunks just outside stay
loaded — VR head rotation is fast; only the draw is skipped), 400 ms `uFade` in/out, LRU eviction
(never evict root). Enforce the budget table (doc 04 §B7) with dev-HUD assertions:

| | Quest 2 | Quest 3 | Desktop | Mobile 2D |
|---|---|---|---|---|
| Star chunk draw calls | ≤ 48 | ≤ 64 | ≤ 128 | ≤ 32 |
| Points post-cull | ≤ 300 k | ≤ 600 k | ≤ 2 M | ≤ 200 k |
| Impostor sprites | ≤ 5 k | ≤ 10 k | ≤ 20 k | ≤ 5 k |

All bulk chunks share **one** ShaderMaterial program (per-chunk uniforms only) — doc 04 §B7.

---

## Step group 8 — Exposure UI + integration

Realizes doc 04 §B6.1, §B9.

### 8.1 Exposure slider

`src/ui/exposure.ts`: HTML slider, `stops ∈ [−4,+4]` → `uExposure = 2^stops`, default 0. One
subscriber writes the shared uniform (updates all chunk materials at once). This is an app intent
(`setExposure`) so PHASE-6's VR uikit slider dispatches the same thing.

### 8.2 Per-frame loop (extend PHASE-2's)

```text
onFrame(now):
  locomotion.update(dt)                          # f64 cameraPos (step 5,6)
  controls.update(dt)                            # look orientation
  skyGroup.position.copy(camera.position)        # camera at rig origin
  skyLayer.setGlobalFade(fadeFromDistance())     # step 6.2
  for layer of activeSkyLayers: layer.tileManager.update(camera, now)
  starField.update(camera, locomotion.cameraPos, now)   # LOD walk, uChunkOffset writes, fades
  readout.update()
  renderer.render(scene, camera)                 # sky(-100) → stars(10) → impostors(11) → UI
  hud.tick()
```

Draw order is critical (doc 04 §B9): HiPS sphere `renderOrder −100` (depth-less) → star Points
`10` → impostors `11`. Nothing z-fights; additive stars sit over the imagery.

---

## Step group 9 — Performance + zero-allocation pass

Realizes doc 04 §B7, docs/06. 10 s idle-flight allocation capture → flat. Preallocate all scratch;
no closures in the frame loop; throttle LOD re-walk to camera moves > 1% of nearest node halfSize
(doc 04 §B2/§B7). Confirm 1 M-star (when on the full set) and 330 k-star (ATHYG day-1) flythroughs
hold 60 fps desktop with draw calls in budget.

---

## Acceptance tests (phase exit — mirror doc 04 §C runtime gates)

| # | Action | Expected |
|---|---|---|
| 1 | `pnpm dev`, cold load | Root ATHYG chunk visible < 1.5 s after page load (manifest + root fetched parallel to renderer init). |
| 2 | At the origin, default exposure | Naked-eye sky recognizable: Orion, Pleiades, Crux; **Sirius brightest**; bright-star colors plausible (Betelgeuse warm, Rigel blue). |
| 3 | Bright Gaia/ATHYG stars vs HiPS imagery | Coincide within **< 0.1°** at the origin (validates frame + `yzx` axis-mapping consistency between PHASE-2 and PHASE-3). |
| 4 | Fly Sun → Pleiades (~136 pc) and back | Correct parallax (cluster grows/brightens, background shifts), **no positional jitter** anywhere (camera-relative math), no chunk pops (fades). |
| 5 | Cross the catalog diagonally | Memory stays under the CPU-LRU budget; draw calls within the §B7 table; **steady-state zero allocations** (DevTools allocation timeline flat). |
| 6 | Mode transition | Flying past ~100 pc fades the HiPS sphere fully out; returning fades it back; "Return to Earth" works. |
| 7 | Exposure slider −4…+4 | Sky dims/brightens smoothly; faint stars fade via alpha (not shrink-to-nothing); no ping-pong-ball growth on bright stars. |
| 8 | Kill the network mid-flight | App keeps rendering resident chunks; missing chunks load when connectivity returns — no crash, no spinner lock. |
| 9 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | Clean / green (incl. day-1 build round-trip + offset-math tests). |

## Exit state

A real 3D star-field flythrough running on day-1 ATHYG data in the GSC1 format, with floating-origin
precision, honest photometry, exposure control, octree LOD, fly + travel-to controls, and a
planetarium↔space transition wired to the PHASE-2 sky. **PHASE-4 swaps the ATHYG chunks for Gaia
DR3 chunks with no runtime change.**

## VERIFY ledger carried out of this phase (track in docs/DECISIONS.md)

1. ATHYG raw-download paths on Codeberg (step 0.1) — confirm at build time.
2. `THREE.Float16BufferAttribute` raw-bits construction in r184 (doc 04 §B4, D#9) — read source; Float32 fallback.
3. Impostor threshold `M < −1.0` + per-platform point ceilings (doc 04 D#10) — tune on first device test.
4. What replaces the sky beyond 100 pc (Milky Way billboard vs starless map) — v1 ships black (doc 04 §B9).
5. 3D star pick latency without per-star source_id (doc 04 D#4) — measured in PHASE-5.
