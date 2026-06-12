# PHASE 2 — HiPS streaming engine (real survey imagery, full LOD) — execution runbook

```yaml
phase: 2
milestone: M2
deliverable: Replace PHASE-1's single static texture with a real HiPS tile-streaming engine:
             Allsky bootstrap, per-tile curvilinear quad meshes, dynamic order selection,
             bounding-cone visible-cell queries, an LRU texture-array tile cache with worker
             decode + throttled uploads, mirror failover, MOC-aware skipping of out-of-coverage
             tiles, and a survey switcher (DSS2 / Pan-STARRS / SDSS / 2MASS / Mellinger).
depends_on: PHASE-1 (sky scene, src/math/frames.ts, src/data/surveys.ts survey registry +
                     properties parser, LookControls, SkyReadout — all reused verbatim)
feeds: PHASE-3 (the sky sphere this builds is what fades out beyond ~50–100 pc during flythrough;
                the per-frame loop and camera-relative pattern are extended there),
       PHASE-5 (picking ray + pointAt already exist; this phase does not change them)
design_docs: docs/03-hips-implementation.md   ← THIS PHASE IMPLEMENTS THAT DOC SECTION-BY-SECTION.
             Read it fully before step 1; every step below cites the §N it realizes.
             Also docs/01-architecture.md (module boundaries), docs/06-performance.md (budgets),
             docs/07-pitfalls.md (sRGB, gl_PointSize, texSubImage stalls, seams).
research: docs/research/hips-format.md (URLs, Allsky layout, tile math — all live-verified 2026-06-11),
          docs/research/healpix-math.md (healpix-ts API + port plan),
          docs/research/performance-quest.md (texture-array pool, upload throttling)
est_effort: 4–6 sessions  (this is the highest-risk milestone — budget generously)
risk: HIGH — UV orientation (§6.4 of doc 03) and HEALPix-library correctness are blocking unknowns;
      both are gated FIRST in this runbook (step groups 0 and 1) before anything visual is built.
```

This phase is split into **2a** (steps 0–6: a *static* full-sky order-3 grid textured from the
Allsky file, no dynamic LOD) and **2b** (steps 7–11: dynamic order selection, the tile cache,
worker decode, failover, survey switching). Ship and commit 2a green before starting 2b — 2a
proves the geometry, frame, and UV-orientation math; 2b is "only" caching and scheduling on top.

> **Golden rule of this phase (doc 03 §6.4):** there is exactly **one** site where tile-image
> orientation is decided — the `uvFromCellCoords(a,b)` function. Set `imageOrientation:"none"`,
> `flipY:false`, `colorSpaceConversion:"none"` everywhere else and *never* add a compensating flip
> anywhere but that one function. Eight orientations are possible; you will pick the right one
> empirically in step 6. Scattering flips across worker/texture/shader is the single most common
> way this engine becomes unfixable.

---

## Step group 0 — HEALPix library spike (BLOCKING, do before any rendering)

Realizes doc 03 §5. The whole engine sits on `healpix-ts`; prove it before building on it.

### 0.1 Install + pin

```bash
cd /Users/kunalbhatia/Downloads/vr-astronomy-app
pnpm add healpix-ts@1.1.0        # MIT, Development Seed — pin EXACT, no ^
```

If install fails or the package is yanked, fall back **immediately** to
`pnpm add @hscmap/healpix@1.4.12` (MIT, frozen, healpy-validated) and adapt names per doc 03 §5
Fallback A; only port by hand (Fallback B, ~400 lines) if both are unavailable.

### 0.2 Generate healpy golden fixtures (one-time, Python)

`tools/fixtures/gen_healpix_fixtures.py` (needs `pip install healpy numpy`):

```python
import healpy as hp, numpy as np, json, os
np.random.seed(42)                    # deterministic — fixtures are committed
out = {"cases": []}
for nside in (1, 2, 64, 1024, 2048):
    # random + pole/seam stress points (phi=0, theta=0/pi, face boundaries)
    thetas = np.concatenate([np.random.uniform(0, np.pi, 64),
                             [1e-7, np.pi-1e-7, np.pi/2, np.pi/2]])
    phis   = np.concatenate([np.random.uniform(0, 2*np.pi, 64),
                             [0.0, 0.0, 0.0, np.pi/4]])
    for th, ph in zip(thetas, phis):
        ipix = int(hp.ang2pix(nside, th, ph, nest=True))
        tc, pc = hp.pix2ang(nside, ipix, nest=True)
        corners = hp.boundaries(nside, ipix, step=1, nest=True)  # shape (3,4): N,E,S,W per healpy
        out["cases"].append({
            "nside": int(nside), "theta": th, "phi": ph, "ipix": ipix,
            "center": [float(tc), float(pc)],
            "corners": corners.T.tolist(),   # 4 xyz vectors, healpy order N,E,S,W
        })
    # one query_disc per nside (non-inclusive + inclusive fact=64)
    v = hp.ang2vec(np.pi/2, 0.3)
    out.setdefault("discs", []).append({
        "nside": int(nside), "vec": v.tolist(), "radius": 0.15,
        "exact":     sorted(int(x) for x in hp.query_disc(nside, v, 0.15, nest=True, inclusive=False)),
        "inclusive": sorted(int(x) for x in hp.query_disc(nside, v, 0.15, nest=True, inclusive=True, fact=64)),
    })
os.makedirs("tools/fixtures", exist_ok=True)
json.dump(out, open("tools/fixtures/healpix_golden.json", "w"))
print("wrote", len(out["cases"]), "cases")
```

Commit `tools/fixtures/healpix_golden.json`. **Note the healpy corner order is N,E,S,W**; doc 03
§5 asserts healpix-ts `cornersNest` returns **N,W,S,E** — the order differs, so the test below maps
indices explicitly rather than comparing element-wise.

### 0.3 `src/sky/healpix/healpix.test.ts` — pin the library to the fixtures

```ts
import { describe, expect, it } from 'vitest';
import golden from '../../../tools/fixtures/healpix_golden.json';
import { ang2PixNest, pix2AngNest, cornersNest, queryDiscInclusiveNest } from 'healpix-ts';

describe('healpix-ts vs healpy', () => {
  it('ang2pix exact-integer matches', () => {
    for (const c of golden.cases)
      expect(ang2PixNest(c.nside, c.theta, c.phi)).toBe(c.ipix);
  });
  it('pix2ang center within 1e-9', () => {
    for (const c of golden.cases) {
      const { theta, phi } = pix2AngNest(c.nside, c.ipix);
      expect(theta).toBeCloseTo(c.center[0], 9);
      // phi compared mod 2π (seam)
      const dphi = Math.abs(((phi - c.center[1] + Math.PI) % (2*Math.PI)) - Math.PI);
      expect(dphi).toBeLessThan(1e-9);
    }
  });
  it('cornersNest returns 4 unit vectors; set matches healpy corner set', () => {
    for (const c of golden.cases.filter((_,i)=>i%7===0)) {  // sample
      const got = cornersNest(c.nside, c.ipix);             // expected order N,W,S,E
      expect(got.length).toBe(4);
      // compare as a SET (order convention differs from healpy N,E,S,W):
      for (const hv of c.corners) {
        const hit = got.some((g:any)=>Math.hypot(g[0]-hv[0],g[1]-hv[1],g[2]-hv[2])<1e-9);
        expect(hit).toBe(true);
      }
    }
  });
  it('queryDiscInclusive is a superset of exact and subset of healpy-inclusive', () => {
    for (const d of golden.discs) {
      const got = new Set<number>();
      queryDiscInclusiveNest(d.nside, d.vec as any, d.radius, (p:number)=>got.add(p));
      for (const e of d.exact) expect(got.has(e)).toBe(true);          // superset of exact
      for (const g of got) expect(d.inclusive.includes(g)).toBe(true); // subset of inclusive
    }
  });
});
```

**Gate:** all four green. If `cornersNest` order is *not* N,W,S,E, record the actual order in a
comment and use it consistently in step 4 (the geometry step asserts corner positions). If the
disc test fails, the library is unusable — switch to Fallback A and re-run.

### 0.4 Frame-rotation helper

`src/sky/healpix/frame.ts` — the galactic↔ICRS rotation for Mellinger (doc 03 §6.5). Copy the
`GAL_TO_ICRS` `Matrix3` verbatim from doc 03 §6.5 and add its unit test (the l=0,b=0 → RA 266.405,
Dec −28.936 assertion). Equatorial/ICRS surveys use identity. Expose:

```ts
export function icrsToSurveyMatrix(frame: 'equatorial'|'galactic'|'ecliptic'): THREE.Matrix3
export function surveyToIcrsMatrix(frame: 'equatorial'|'galactic'|'ecliptic'): THREE.Matrix3
```

(`ecliptic` may throw "not implemented" in v1 — no starter survey uses it; Mellinger is the only
non-equatorial one. VERIFY against each survey's `hips_frame` at load.)

---

## Step group 1 — Tile URL + properties (cheap, pure, fully testable)

Realizes doc 03 §3, §4. Most of this already exists from PHASE-1 (`src/data/hipsProperties.ts`).

### 1.1 `src/sky/tile-url.ts`

Copy `EXT`, `tileUrl`, `allskyUrl`, and the tree-arithmetic helpers **verbatim from doc 03 §4**.
Add the worked-example test:

```ts
import { describe, expect, it } from 'vitest';
import { tileUrl } from './tile-url';
it('builds the spec Dir bucket', () => {
  expect(tileUrl('https://alasky.cds.unistra.fr/DSS/DSSColor', 9, 2752671, 'jpeg'))
    .toBe('https://alasky.cds.unistra.fr/DSS/DSSColor/Norder9/Dir2750000/Npix2752671.jpg');
  expect(tileUrl('B', 3, 301, 'jpeg')).toBe('B/Norder3/Dir0/Npix301.jpg');
});
```

> **Trap (doc 03 §4):** use `Math.floor`/multiply, never `>>`/`<<`, for `Dir` and tree math — JS
> bitwise ops are 32-bit and overflow above order 14.

### 1.2 Runtime descriptor

PHASE-1 already merges registry ⊕ properties via `mergeProperties`. Add the fields doc 03 §3 needs
that PHASE-1 may have skipped: `minRenderOrder` (always `max(3, hips_order_min ?? 3)`),
`skyFraction` (from `moc_sky_fraction`, default 1.0), and `frame`. Add a unit test asserting
`minRenderOrder >= 3` for every starter survey.

---

## Step group 2 — Tile geometry (the curvilinear quad) (2a)

Realizes doc 03 §6. This is the geometry that makes imagery not warp.

### 2.1 `src/sky/geometry.ts`

Copy `tileGrid(order, npix, n, radius)` **verbatim from doc 03 §6.2** (it uses the low-level
`nest2fxy`/`fxy2tu`/`tu2za` exports of healpix-ts). Add the shared index buffer (a standard
`(n+1)×(n+1)` grid → `2n²` triangles) as a memoized helper keyed by `n`:

```ts
export function gridIndexBuffer(n: number): Uint16Array { /* standard grid triangulation */ }
```

### 2.2 Pin the geometry against `cornersNest` (the §6.2 assertion)

```ts
import { cornersNest } from 'healpix-ts';
import { tileGrid } from './geometry';
it('tileGrid corners match cornersNest (N,W,S,E ↔ (a,b)=(1,1),(0,1),(0,0),(1,0))', () => {
  const order = 3, npix = 301, n = 1, R = 1;
  const { pos } = tileGrid(order, npix, n, R);          // (n+1)^2 = 4 verts
  const corners = cornersNest(1 << order, npix);        // [N,W,S,E]
  const at = (a:number,b:number)=>{ const i=(b*(n+1)+a); return [pos[3*i],pos[3*i+1],pos[3*i+2]]; };
  const near=(p:number[],q:number[])=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<1e-9;
  expect(near(at(1,1), corners[0])).toBe(true); // N
  expect(near(at(0,1), corners[1])).toBe(true); // W
  expect(near(at(0,0), corners[2])).toBe(true); // S
  expect(near(at(1,0), corners[3])).toBe(true); // E
});
```

If this fails, the corner-order convention differs — fix the index→(a,b) mapping here (and only
here) until it passes. This test is the foundation for the UV-orientation work in step 6.

> The positions `tileGrid` emits are in the **survey frame** (doc 03 §6.5). The mesh group carries
> the `surveyToIcrs` rotation (step 5). Keep geometry survey-frame; rotate the group, not the verts.

### 2.3 `SUBDIV` constant

`export const SUBDIV = 4;` (doc 03 §6.3). Do not parameterize per tile in v1.

---

## Step group 3 — Allsky bootstrap (2a) — first paint < 1.5 s

Realizes doc 03 §11. The Allsky file gives the whole low-res sky in one request.

### 3.1 `src/sky/allsky.ts`

- Fetch `{base}/Norder3/Allsky.{ext}` trying formats in registry preference order; **fall back
  across formats on 404** (doc 03 §11 — `Allsky.webp` may 404 even when webp tiles exist).
- Decode to one ordinary `THREE.Texture` (`colorSpace = SRGBColorSpace`, `flipY = false`,
  `generateMipmaps = false`, `minFilter = LinearFilter`).
- Detect sub-tile size: `cellPx = image.width / 27` (doc 03 §11 — 27 tiles wide).
- Provide `allskySubRect(npix, cellPx)` verbatim from doc 03 §11.

### 3.2 Wire: as soon as `properties` resolves, kick off the Allsky fetch in parallel with the
order-3 mesh build (step 4). Keep the Allsky texture resident forever (~4 MB) — it is the universal
fallback (step 9 / doc 03 §12.1).

---

## Step group 4 — Static order-3 sky (2a milestone) — `sky-layer.ts` v1

Realizes doc 03 §11 (render path) + §13 (composition). Build all **768** order-3 cells as one
merged geometry, textured from the Allsky sub-rects. No dynamic LOD yet.

### 4.1 `src/sky/sky-material.ts` (Allsky variant first)

A `sampler2D` ShaderMaterial (doc 03 §16, the "plain variant"): vertex passes `uvCell` →
`uvFromCellCoords` (step 6) → scaled into the cell's Allsky sub-rect; fragment samples the Allsky
texture, multiplies by `uGlobalFade`. Material flags: `depthWrite:false, depthTest:false,
transparent:true`, winding per §4.3 below.

```ts
// the ONE orientation site (doc 03 §6.4) — start with the documented guess, settle in step 6:
export function uvFromCellCoords(a: number, b: number): [number, number] {
  return [a, b];   // candidate 0 of 8; step 6 may swap/flip to one of: [b,a],[1-a,b],[a,1-b],...
}
```

### 4.2 Build the merged order-3 mesh

For each `npix` in `0..767`: `tileGrid(3, npix, SUBDIV, R)` → append positions/uvCell into shared
arrays; per-vertex also write the cell's Allsky sub-rect `(ox,oy,scale)` so the shader maps
`uv = subrect.xy + uvFromCellCoords(uvCell)*subrect.scale`. One `BufferGeometry`, one draw call.
`R = 0.5 * camera.far` (doc 03 §13.3); `frustumCulled = false`; `renderOrder = -100`.

### 4.3 Winding / `side`

Camera is *inside* the sphere. Either emit inward-facing winding or set
`material.side = THREE.BackSide`. Pick one, assert it in step 6's visual test (doc 03 §16 note).
Start with `BackSide` + natural winding (simplest).

### 4.4 Camera-relative sky group (doc 03 §13.3)

Parent the sky mesh under a `THREE.Group skyGroup`; each frame
`skyGroup.position.copy(camera.position)`. In PHASE-2 the camera never leaves the origin, so this is
a no-op now — **add it anyway** so PHASE-3's flythrough inherits a correct sky.

### 4.5 Replace PHASE-1's static sphere in `main.ts`

Delete the `createStaticSkySphere` usage; add the order-3 sky layer. Keep LookControls, SkyReadout,
constellation overlay, HUD untouched.

**2a acceptance (commit here):**

| # | Action | Expected |
|---|---|---|
| 2a.1 | `pnpm dev` | Full low-res sky from the Allsky file in < 1.5 s; HUD ≥ 60 fps; 1 draw call for the sky. |
| 2a.2 | Network tab | One `properties` + one `Allsky.*` fetch (200, CORS ok); **no** `Norder0/1/2` requests ever. |
| 2a.3 | Constellation overlay (PHASE-1) toggled on | Lines land on the right star patterns in the Allsky imagery (frame + UV consistent). |
| 2a.4 | `pnpm test` | healpix, geometry-corner, tile-url suites green. |

---

## Step group 5 — Survey frame + the galactic Mellinger case (2a)

Realizes doc 03 §6.5. Set `skyGroup`'s child mesh-group rotation from `surveyToIcrsMatrix(frame)`.
For DSS2 (`equatorial`) it is identity; load Mellinger (`galactic`) as a second sky layer and
**blink-test** it against DSS2 at the galactic center (l=0 b=0 ↔ RA 266.405 Dec −28.936). They must
overlap. If they don't, the rotation matrix is wrong — regenerate it with astropy per doc 03 §6.5
fallback. (You can defer Mellinger to after 2b; equatorial surveys are the priority.)

---

## Step group 6 — Settle the UV orientation (BLOCKING gate before 2b)

Realizes doc 03 §6.4 + §18.2 — *the* correctness risk of the whole engine.

1. Point the camera at Orion (`window.goto(83.82,-5.39)` from PHASE-1), FOV ~10°, **DSS2** survey.
2. Open the same field in Aladin Lite (https://aladin.cds.unistra.fr/AladinLite/) at the same
   RA/Dec/FOV.
3. Compare **slant and mirror parity** of the belt + sword. If our render is rotated/mirrored,
   change ONLY `uvFromCellCoords` to the next candidate of the 8:
   `[a,b] [b,a] [1-a,b] [a,1-b] [1-a,1-b] [b,1-a] [1-b,a] [1-b,1-a]`.
   Re-test after each change. Do **not** touch `imageOrientation`, `flipY`, or add shader flips.
4. When it matches: screenshot both, commit to `docs/assets/uv-orientation-orion.png`, and write
   the winning mapping + a one-line proof into `uvFromCellCoords`'s comment (`// settled PHASE-2 §6`).
5. Append the decision to `docs/DECISIONS.md` (e.g. "HiPS tile UV = [b, 1-a]; side=BackSide").

**Gate:** orientation verified against ≥ 3 fields (Orion's belt, Crab Nebula RA 83.63/Dec 22.01, a
near-pole field) before starting 2b. Everything downstream trusts this.

---

## Step group 7 — Dynamic order + visible cells (2b)

Realizes doc 03 §7, §8. Now the engine picks an order from FOV and lists the cells to load.

### 7.1 `src/sky/lod.ts`

Copy `tilePixRad`, `pickOrder` (doc 03 §7) and `boundingCone`, `visibleCells` (doc 03 §8)
**verbatim**. `viewportHeightPx()` = `renderer.domElement.height` on desktop; per-eye framebuffer
height in XR (PHASE-6 wires that — a constant 1080 is fine for now). `biasOrders()` returns 0 on
desktop, −0.5 in XR (doc 03 §10.4).

### 7.2 Tests (no GPU needed)

- `pickOrder`: 60° FOV / 1080 px → order 3; 1° FOV → order 9 (doc 03 §7 reference numbers).
- `visibleCells`: a narrow cone at a known axis returns a small set (30–80) that includes the cell
  directly under the axis (`ang2PixNest` of the axis); a wide cone (>π/3) returns all `12·4^k`.
- Hysteresis: assert the order doesn't change for a <10% FOV nudge (doc 03 §7).

---

## Step group 8 — Tile worker (decode off-thread) (2b)

Realizes doc 03 §10.1. Copy `tile-worker.ts` **verbatim from doc 03 §10.1**. Wire abort via a
`MessagePort`/`AbortController` map. Spin up 2 workers (desktop and VR both — doc 03 §10.1).

> **Trap (doc 03 §3, §10.1):** alasky serves `webp` **without a Content-Type header**. The
> `fetch → blob → createImageBitmap` path doesn't care — never branch on `resp.headers`. Set
> `imageOrientation:"none", premultiplyAlpha:"none", colorSpaceConversion:"none"` in
> `createImageBitmap` (the orientation is owned by `uvFromCellCoords`).

---

## Step group 9 — TileManager: cache, fetch, upload, fallback, failover (2b core)

Realizes doc 03 §9, §10.2, §12, §14, §15. This is the heart of the phase. Implement
`src/sky/tile-manager.ts` following the doc 03 §15 reference class **method by method**; do not
improvise the control flow — it is already specified.

### 9.1 GPU texture-array pool — `src/sky/tile-pool.ts`

Realizes doc 03 §9.1. Allocate once with `gl.texStorage3D(TEXTURE_2D_ARRAY, 1, SRGB8_ALPHA8, 512,
512, LAYERS)`; `LAYERS = 128` (Quest 2) / 192 (Quest 3) / 384 (desktop) — pick from a device tier
guess for now (PHASE-6/8 refine). Expose `acquireLayer(rec)` (LRU-evicts per the §9.1 rules: never
evict tiles drawn this frame or serving as fallback ancestors) and the raw `tex` for `texSubImage3D`.

> Three.js note: you need a `THREE.DataArrayTexture` wrapper around the GL texture so the
> ShaderMaterial can bind it as `sampler2DArray`. Create the `DataArrayTexture(null,512,512,LAYERS)`,
> let three allocate it, then `texSubImage3D` into `renderer.properties.get(tex).__webglTexture`.
> VERIFY this handle path against three r184 source (`WebGLTextures.js`) at scaffold time; FALLBACK:
> upload via `texture.image = {data...}` + `needsUpdate` per-layer is slower but avoids private
> handles — only if the direct path is blocked.

### 9.2 Tile record + state machine

Copy `TileRecord`/`TileState` and the mermaid state machine from doc 03 §9.2. The `records` Map is
the single source of truth and the dedup (doc 03 §9.4) — no second promise map.

### 9.3 Reconcile + upload

Implement `reconcile(nowMs)` and `drainUploads(nowMs)` from doc 03 §10.2 / §15 **verbatim**.
`MAX_UPLOADS_PER_FRAME` = 1 (VR) / 4 (desktop); `MAX_CONCURRENT` = 6 (VR) / 12 (desktop). Center-out
priority via `sortByAngularDistance(want, axis)`.

> **Trap (doc 07 + doc 03 §10.2):** `texSubImage3D` during a frame can stall. The throttle (≤ N per
> frame, ≤ budget ms) is mandatory, not optional. Instrument with `performance.now()` brackets and
> `console.warn` on breach (doc 03 §17).

### 9.4 Best-available fallback + crossfade

Realizes doc 03 §12. Implement `ancestorSubUv` (doc 03 §12.1) and the two-binding crossfade
(`aLayerA/aUvRectA/aLayerB/aUvRectB/aMix`, 300 ms, doc 03 §12.2). The Allsky order-3 cell is the
ultimate fallback (always resident from step 3). Upgrade `sky-material.ts` to the `sampler2DArray`
two-lookup shader (doc 03 §16) — the Allsky-only variant from step 4 becomes the §16 "plain variant"
used only for the order-3 base mesh.

### 9.5 MOC pre-check (partial surveys)

Realizes doc 03 §14.1. For any survey with `skyFraction < 0.99` (SDSS9 0.36, Pan-STARRS 0.78, Rubin
FirstLook 0.00057), fetch the MOC JSON
`https://alasky.cds.unistra.fr/MocServer/query?ID={hipsId}&get=moc&fmt=json` at layer load and run
`mocCovers` (doc 03 §14.1) **before** queueing a fetch — this prevents 404 storms. 404s that still
happen are negative-cached for the session, never retried, never logged as errors.

### 9.6 Mirror failover + circuit breaker

Realizes doc 03 §14.2. `baseUrls = [alasky, alaskybis]`. On network/5xx (NOT 404): retry once on
the next mirror; then exponential backoff (1/4/16/60 s) while the cell stays visible; per-host
circuit breaker (≥5 fails / 30 s → demote host 60 s).

---

## Step group 10 — Per-frame integration + survey switcher (2b)

Realizes doc 03 §13, §15 (per-frame call graph).

### 10.1 Per-frame loop (`main.ts`)

```text
onFrame(now):
  controls.update(dt)
  skyGroup.position.copy(camera.position)        # §13.3
  for layer of activeSkyLayers: layer.tileManager.update(camera, now)   # §15
  readout.update()
  renderer.render(scene, camera)                 # sky renderOrder -100 → drawn first
  hud.tick()
```

`TileManager.update` does only map lookups, array diffs, and ≤budget uploads (doc 03 §10.3 —
zero steady-state allocation; preallocate `want`, scratch `Vector3`s).

### 10.2 Survey switcher UI

`src/ui/surveyPicker.ts`: a dropdown listing the registry surveys. On change: build a new
`TileManager` for the target, keep the old one alive, crossfade `uGlobalFade` over 400 ms (doc 03
§15 `dispose`), then dispose the old (abort fetches, `bitmap.close()`, `pool.dispose()`). Cap active
surveys at 2 (doc 03 §9.1). Show the survey's `obs_copyright` attribution in a footer (mandatory —
README "Attribution is mandatory"; doc 02 §10).

### 10.3 `uGlobalFade` hook for PHASE-3

Expose `skyLayer.setGlobalFade(x)` writing the `uGlobalFade` uniform. PHASE-3 drives it from camera
distance (50→100 pc). In PHASE-2 it stays 1.0.

---

## Step group 11 — Performance + cleanup pass (2b)

Realizes doc 03 §17, docs/06-performance.md.

- Dev HUD: extend PHASE-0's stats with `renderer.info.render.calls`, `.memory.textures`, GPU pool
  layer count, decoded-cache size. `console.warn` on any breach of the doc 03 §17 budget table.
- 10-second idle-orbit allocation capture (Chrome allocation timeline) → flat line (zero
  steady-state allocation). Fix any per-frame `new`/spread/closure (doc 03 §10.3).
- Confirm sky = ≤ 4 draw calls (1 tile mesh + 1 order-3 base while any cell falls back, + ≤1 per
  extra active survey during a switch).

---

## Acceptance tests (phase exit — all must pass; ordered, each gates the next)

These mirror doc 03 §18 (read it — it has the rationale). Commit only when green.

| # | Action | Expected |
|---|---|---|
| 1 | `pnpm test` | healpix-vs-healpy, geometry-corner, tile-url, lod, MOC suites all green (doc 03 §18.1). |
| 2 | Orientation gate (step 6) | DSS2 Orion/Crab/pole fields match Aladin Lite slant+parity; screenshots committed (doc 03 §18.2). |
| 3 | Galactic frame (step 5) | Mellinger blink-aligns with DSS2 at l=0 b=0; rotation unit test green (doc 03 §18.3). |
| 4 | Cold load (cache cleared, fast-3G throttle) | Full Allsky sky < 1.5 s after properties; **zero** Norder0/1/2 requests (doc 03 §18.4). |
| 5 | Zoom Crab Nebula 60°→0.5° | Orders walk 3→9 on DSS2, 3→11 on Pan-STARRS; every transition crossfades, no pops, no blank cells (doc 03 §18.5). |
| 6 | Pan across SDSS9 boundary | **Zero** 404s in the network log (MOC pre-check); transparent outside coverage; Rubin FirstLook shows imagery only in its ~23 deg² with no error spam (doc 03 §18.6). |
| 7 | DevTools-block `alasky.cds.unistra.fr` | All tiles load from `alaskybis` within one retry; no user-visible stall > 1 s (doc 03 §18.7). |
| 8 | 2 min random panning at order 9 | GPU layer count ≤ pool size; `renderer.info.memory.textures` stable; decoded cache ≤ cap; flat allocation timeline (doc 03 §18.8). |
| 9 | Survey switch DSS2 → Pan-STARRS → SDSS9 | Takes effect < 1 s, crossfades, no WebGL context loss; attribution footer updates to each survey's `obs_copyright`. |
| 10 | `pnpm typecheck && pnpm lint && pnpm build` | Clean. |

## Exit state

A real, streaming, multi-survey HiPS sky on a camera-relative sphere with a correct, test-pinned
HEALPix/geometry/UV foundation, an LRU texture-array cache, worker decode, throttled uploads, mirror
failover, MOC-aware partial-survey handling, and a `setGlobalFade` hook. PHASE-3 adds the 3D Gaia
star field in front of this sphere and drives `setGlobalFade` during flythrough.

## VERIFY ledger carried out of this phase (track in docs/DECISIONS.md)

1. UV orientation winner (step 6) — **resolved here**, recorded with screenshot.
2. `cornersNest` corner order N,W,S,E (step 0.3) — resolved here.
3. `DataArrayTexture` private-handle upload path in r184 (step 9.1) — verify at scaffold; fallback noted.
4. Real `texSubImage3D` cost on device (doc 03 §10.2) — unmeasured until PHASE-6/8 hardware.
5. Quest texture-memory ceiling / pool layer count (doc 03 §17) — unmeasured until hardware.
6. No-mips aliasing on device (doc 03 §9.3) — revisit in PHASE-6; `biasOrders=-0.5` is the first lever.
