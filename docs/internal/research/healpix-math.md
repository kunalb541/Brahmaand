# HEALPix math & JS libraries for a HiPS sky renderer

```yaml
topic: HEALPix math (NESTED scheme, boundaries, query_disc, LOD hierarchy)
       + survey of JS/npm HEALPix libraries, for a TypeScript/Three.js HiPS renderer
date: 2026-06-11
author: research agent (web-verified June 2026)
confidence:
  math: HIGH — formulas cross-checked against healpix.sourceforge.io docs and the
        actual source of michitaro/healpix (itself unit-tested against healpy)
  library-versions: HIGH — read directly from registry.npmjs.org / crates.io on 2026-06-11
  licenses: HIGH for MIT/Apache packages; healpixjs (fab77) dual-license read from
        registry metadata, exact non-commercial terms NOT read in full
  hips-spec: HIGH — read from IVOA REC-HiPS-1.0 PDF
  gaia-source_id-encoding: MEDIUM — from memory, flagged UNVERIFIED below
```

---

## 1. Executive summary

- HEALPix divides the sphere into 12 base faces, each subdivided into `Nside × Nside`
  equal-area quad cells (`Nside = 2^order`), total `Npix = 12 · Nside²`. HiPS tiles
  **are** HEALPix NESTED cells, so a HiPS renderer needs exactly: `ang2pix`/`pix2ang`,
  cell **corner vectors** (to build tile quad geometry), a **cone/disc query** (to decide
  which tiles to fetch for the current view), and the trivial **parent/child bit math**
  for LOD.
- **Recommendation:** use **`healpix-ts`** (npm, MIT, Development Seed, v1.1.0 published
  2026-05-19) — a maintained, documented TypeScript fork of `@hscmap/healpix` that adds
  the hierarchy helpers (`nestParent`/`nestChildren`/`nestAncestor`) and box queries a
  tile loader wants. Fallback: pin `@hscmap/healpix` 1.4.12 (MIT, frozen since 2022,
  healpy-validated), or port ~400 lines of pure math (full port source included below).
- Aladin Lite v3 does **not** expose a reusable JS HEALPix module: its core is the Rust
  crate **`cdshealpix`** (Apache-2.0 OR MIT, v0.9.1, active as of March 2026) compiled
  to WASM *inside* the GPL-3 `aladin-lite` bundle. The standalone WASM npm build
  (`@fxpineau/healpix` 0.1.3) has been stale since July 2020 — do not depend on it.

---

## 2. HEALPix fundamentals (VERIFIED math)

### 2.1 Geometry and counts

VERIFIED against https://healpix.sourceforge.io/html/intro_Geometric_Algebraic_Propert.htm :

- The sphere is split into **12 base pixels (faces)**; at resolution `Nside` each face is
  an `Nside × Nside` grid → `Npix = 12 · Nside²` **equal-area** pixels.
- For HiPS / NESTED use, `Nside = 2^order` (order = "depth"; healpy calls it `norder`).
  `order2nside(o) = 1 << o`, `nside2npix(n) = 12 n²`, pixel area `= 4π / Npix` sr.
- Pixel centers sit on `4·Nside − 1` **iso-latitude rings**. The sphere splits at
  `|z| = |cos θ| = 2/3` into an **equatorial belt** and two **polar caps**.
- Pixel boundaries are *not* geodesics: in the belt they satisfy `cos θ = a ± b·φ`;
  in the caps `cos θ = a + b/φ²` style curves (i.e. corners of a cell are NOT connected
  by great circles — relevant when tessellating tile quads, see §6.3).

### 2.2 Face numbering and layout

VERIFIED (implied by the `fxy2tu` source in §2.7, consistent with Górski et al. 2005,
ApJ 622, 759, https://arxiv.org/abs/astro-ph/0409513 ):

- Faces `0–3`: north polar; `4–7`: equatorial; `8–11`: south polar.
- Face row `f_row = ⌊f/4⌋ ∈ {0,1,2}`. In the standard "rhombus" layout each face is a
  diamond; the face-center offsets used by the projection are
  `F1 = f_row + 2` (ring offset) and `F2 = 2·(f mod 4) − (f_row mod 2) + 1` (azimuth offset).
- Within a face, NESTED uses local coordinates `(x, y) ∈ [0, Nside)²` with **x toward
  south-east, y toward south-west** along the diamond edges (axes of the bit-interleave).

### 2.3 RING vs NESTED

VERIFIED (same sourceforge page):

- **RING**: pixels numbered north→south along iso-latitude rings; good for spherical
  harmonics; *not* what HiPS uses.
- **NESTED**: pixel index = `f · Nside² + interleave(x, y)` where `interleave` is the
  Morton/Z-order bit-interleave of the in-face coordinates. Hierarchical by
  construction — this is the HiPS scheme (VERIFIED in IVOA HiPS 1.0, see §3).
- **UNIQ** (multi-order) encoding: `uniq = 4 · Nside² + ipix` — packs (order, ipix)
  into one integer; used by MOC coverage maps.

### 2.4 The HEALPix projection (z/φ → t/u) — the core of everything

The clean way to implement ang2pix/pix2ang/corners is via the intermediate **HEALPix
planar projection**: `(z = cos θ, a = φ)` → `(t, u)`, where the 12 faces tile the plane
as diamonds of half-diagonal `π/4`. VERIFIED — verbatim from
https://raw.githubusercontent.com/michitaro/healpix/master/src/index.ts
(MIT; unit-tested against healpy):

```typescript
// constants: PI_2 = π/2, PI_4 = π/4, PI_8 = π/8
// sigma(z) = sign(z) * (2 - sqrt(3 * (1 - |z|)))   // polar-cap radial function

export function za2tu(z: number, a: number) {        // forward projection
    if (Math.abs(z) <= 2 / 3) {                      // equatorial belt (cylindrical equal-area)
        const t = a
        const u = 3 * PI_8 * z                        // u = (3π/8)·z
        return { t, u }
    } else {                                          // polar caps (Collignon)
        const p_t = a % PI_2
        const sigma_z = sigma(z)
        const t = a - (Math.abs(sigma_z) - 1) * (p_t - PI_4)
        const u = PI_4 * sigma_z
        return { t, u }
    }
}

export function tu2za(t: number, u: number) {        // inverse projection
    const abs_u = Math.abs(u)
    if (abs_u >= PI_2) return { z: sign(u), a: 0 }   // pole
    if (abs_u <= PI_4) {                              // equatorial belt
        return { z: (8 / (3 * Math.PI)) * u, a: t }
    } else {                                          // polar caps
        const t_t = t % PI_2
        const a = t - ((abs_u - PI_4) / (abs_u - PI_2)) * (t_t - PI_4)
        const z = sign(u) * (1 - (1 / 3) * square(2 - 4 * abs_u / Math.PI))
        return { z, a }
    }
}
```

### 2.5 Projection plane → face + in-face coords (t,u → f,x,y)

VERIFIED (same source):

```typescript
export function tu2fxy(nside: number, t: number, u: number) {
    const { f, p, q } = tu2fpq(t, u)   // identify diamond face f and fractional coords p,q ∈ [0,1)
    const x = clip(Math.floor(nside * p), 0, nside - 1)
    const y = clip(Math.floor(nside * q), 0, nside - 1)
    return { f, x, y }
}

export function fxy2tu(nside: number, f: number, x: number, y: number) {
    const f_row = Math.floor(f / 4)
    const f1 = f_row + 2                       // F1
    const f2 = 2 * (f % 4) - (f_row % 2) + 1   // F2
    const v = x + y                            // "vertical" diagonal coordinate
    const h = x - y                            // "horizontal" diagonal coordinate
    const i = f1 * nside - v - 1               // ring index within projection
    const k = f2 * nside + h + 8 * nside       // azimuth index (offset to stay positive)
    const t = (k / nside) * PI_4
    const u = PI_2 - (i / nside) * PI_4
    return { t, u }
}
```

### 2.6 NESTED index ⇄ (f, x, y): Morton bit-interleave

VERIFIED (same source). `ipix_nest = f · Nside² + bitCombine(x, y)` where bits of `x`
go to even positions and bits of `y` to odd positions:

```typescript
export function fxy2nest(nside, f, x, y) { return f * nside * nside + bit_combine(x, y) }

function nest2fxy(nside, ipix) {
    const nside2 = nside * nside
    const f = Math.floor(ipix / nside2)          // face = ⌊ipix / Nside²⌋
    const { x, y } = bit_decombine(ipix % nside2) // de-interleave Morton code
    return { f, x, y }
}
```

`bit_combine` in this implementation handles `x < 2^16, y < 2^15` with 32-bit ops →
**hard limit `order ≤ 15` (Nside ≤ 32768)** for the interleave done in 32-bit JS bitwise
math (the README states "norder <= 15", VERIFIED at https://github.com/michitaro/healpix ).
Above that you need BigInt or split-word interleave (see `@gkucmierz/healpixjs-bigint`, §4).

### 2.7 ang2pix / pix2ang / pix2vec (NESTED) — composition

VERIFIED signatures from the same source:

```text
ang2pix_nest(nside, θ, φ)  = fxy2nest(nside, ...tu2fxy(nside, ...za2tu(cosθ, φ)))
pix2ang_nest(nside, ipix)  : nest2fxy → fxy2tu (cell CENTER) → tu2za → {θ = acos z, φ = a}
pix2vec_nest(nside, ipix)  : same, then za2vec: (√(1−z²)·cos a, √(1−z²)·sin a, z)
```

Conventions (healpy-compatible): `θ` = colatitude ∈ [0, π] (0 = north pole),
`φ` = longitude ∈ [0, 2π). RA/Dec ↔ θ/φ: `θ = π/2 − dec`, `φ = ra` (radians, ICRS for
most HiPS — check the survey's `hips_frame` property; galactic HiPS exist).

### 2.8 nest2ring / ring2nest

VERIFIED: both implemented by round-tripping through `(f, x, y)`:
`nest2ring(nside, ipix) = fxy2ring(nside, ...nest2fxy(nside, ipix))`, and the inverse
via `ring2fxy`. The ring index needs the ring-structure bookkeeping (north cap rings
`i < Nside` have `4i` pixels; belt rings have `4·Nside`; south cap mirrors). A HiPS
renderer only needs NESTED; keep ring conversion only for ingesting RING-ordered
datasets (e.g. some all-sky FITS maps).

### 2.9 boundaries / corners of a cell — what builds your tile quads

VERIFIED verbatim source (this is the function your renderer calls per tile):

```typescript
export function corners_nest(nside: number, ipix: number): V3[] {
    const { f, x, y } = nest2fxy(nside, ipix)
    const { t, u } = fxy2tu(nside, f, x, y)   // cell center in projection plane
    const d = PI_4 / nside                     // half-diagonal of the cell diamond
    const xyzs: V3[] = []
    for (const [tt, uu] of [[0, d], [-d, 0], [0, -d], [d, 0]]) {  // N, W, S, E corners
        const { z, a } = tu2za(t + tt, u + uu)
        xyzs.push(za2vec(z, a))                // unit vectors on the sphere
    }
    return xyzs
}
```

- Corner order is **N, W, S, E** (offsets +u, −t, −u, +t in the projection plane); this
  matches healpy's documented convention for `healpy.boundaries(..., step=1)`
  (returns shape `(3, 4·step)` array of unit vectors; step>1 samples along edges —
  VERIFIED at https://healpy.readthedocs.io/en/latest/generated/healpy.boundaries.html ).
- For sub-sampled boundaries (curved edges), step in `t` or `u` by `d/step` between
  corners — equivalent to healpy `step=k` or cdshealpix `path_along_cell_side`.

### 2.10 Parent / child relations (LOD) — trivial in NESTED

VERIFIED by construction of the Morton index (and present as named API in `healpix-ts`
and cdshealpix):

```text
parent(ipix)        = ipix >> 2                  // one order up
children(ipix)      = [4·ipix, 4·ipix+1, 4·ipix+2, 4·ipix+3]
ancestor(ipix, Δ)   = ipix >> (2Δ)
descendants(ipix,Δ) = [ipix << 2Δ , (ipix+1) << 2Δ)   // contiguous range!
```

Use `Math.floor(ipix / 4)` / multiplication instead of `>>` above order 14 (32-bit
bitwise overflow in JS; numbers stay exact as float64 up to 2^53). The contiguous-range
property of descendants is the key trick for tile caches and MOC/range queries.

### 2.11 query_disc — cells intersecting a cone (tile-loading primitive)

healpy semantics (VERIFIED at
https://healpy.readthedocs.io/en/latest/generated/healpy.query_disc.html ):
`query_disc(nside, vec, radius, inclusive=False, fact=4, nest=False)`;
`inclusive=False` returns pixels whose **centers** are inside;
`inclusive=True` returns all overlapping pixels **plus possibly a few extra**
(conservative over-approximation — exactly what tile loading wants; extra tiles cost a
wasted fetch, missing tiles cost holes in the sky). `fact` refines the test at
`fact × nside`.

Algorithm (VERIFIED verbatim from michitaro/healpix, an inclusive ring-sweep —
~50 lines, the largest function you'd have to port):

```typescript
export function query_disc_inclusive_nest(nside, v, radius, cb) {
    if (radius > PI_2) throw new Error(`query_disc: radius must < PI/2`)
    const pixrad = max_pixrad(nside)             // worst-case center→corner distance
    const d = PI_4 / nside
    const { z: z0, a: a0 } = vec2za(v[0], v[1], v[2])
    const sin_t = Math.sqrt(1 - z0 * z0)
    const cos_r = Math.cos(radius), sin_r = Math.sin(radius)
    const z1 = z0 * cos_r + sin_t * sin_r        // top z of the cone
    const z2 = z0 * cos_r - sin_t * sin_r        // bottom z of the cone
    const u1 = za2tu(z1, 0).u, u2 = za2tu(z2, 0).u
    const cover_north_pole = sin_t * cos_r - z0 * sin_r < 0
    const cover_south_pole = sin_t * cos_r + z0 * sin_r < 0
    let i1 = Math.floor((PI_2 - u1) / d)         // first candidate ring
    let i2 = Math.floor((PI_2 - u2) / d + 1)     // last candidate ring
    // ... pole-cap handling: walk full rings near a covered pole ...
    const theta = Math.acos(z0)
    for (let i = i1; i <= i2; ++i)
        walk_ring_around(nside, i, a0, theta, radius + pixrad, ipix => {
            if (angle(pix2vec_nest(nside, ipix), v) <= radius + pixrad) cb(ipix)
        })
}

export function max_pixrad(nside) {              // healpy.max_pixrad equivalent
    const unit = PI_4 / nside
    return angle(tu2vec(unit, nside * unit), tu2vec(unit, (nside + 1) * unit))
}
```

Note the test is `center-distance ≤ radius + max_pixrad` — a circumscribing-circle
over-approximation (can return a few non-overlapping tiles near the disc edge; harmless
for tile loading). cdshealpix's `cone_coverage_approx` is the same idea with tighter
bounds and a BMOC output.

### 2.12 Frustum → cone for tile-loading (renderer-level, not a HEALPix primitive)

No JS library exposes a true frustum query; standard practice (Aladin Lite does the
equivalent) is:

1. Compute the camera's **bounding cone**: axis = view direction (as a unit vector in
   the sky frame), half-angle `α = atan(tan(fovY/2) · √(1 + aspect²·tan²… ))` — or simply
   the angle from view axis to a screen **corner** ray: `α = acos(dot(axis, cornerRay))`,
   take the max over 4 corners. For an inside-out celestial sphere the camera is at the
   center, so every screen pixel maps to exactly one sky direction — the visible region
   IS a cone for symmetric frusta.
2. `query_disc_inclusive_nest(nside_tile, axis, α)` → candidate tile list.
3. Optional exactness pass: discard tiles whose 4 corner vectors AND center all fall
   outside the frustum planes (dot-product tests against the 4 side-plane normals).
4. For very wide FoV (>~120°) or order 0–2, skip the query and take all 12·4^order cells.

---

## 3. HiPS ⇄ HEALPix linkage (VERIFIED, IVOA HiPS 1.0)

Source: REC-HiPS-1.0, 2017-05-19,
https://www.ivoa.net/documents/HiPS/20170519/REC-HIPS-1.0-20170519.pdf

- A HiPS **tile at order K is the HEALPix NESTED cell `Npix` at order K** (`Nside = 2^K`).
- File layout: `NorderK/DirD/NpixN.{ext}` with `D = ⌊N / 10000⌋ · 10000`
  (e.g. order-7 tile 13651 → `Norder7/Dir10000/Npix13651.jpg`).
- Default tile width **512 px**; a 512×512 tile covers the cell with sub-pixels at
  HEALPix order `K + 9` (`9 = log2(512)`). General: pixel-level order = `K + log2(hips_tile_width)`.
- `properties` file keys: `hips_order` (max K available), `hips_tile_width`,
  `hips_tile_format` (jpeg/png/fits), `hips_frame` (equatorial/galactic).
- `Norder3/Allsky.{ext}` preview file: all order-3 tiles packed in one image — load this
  first for instant whole-sky display before streaming individual tiles.
- Practical consequence: your tile loader runs `query_disc` at the **tile order** K
  (≤ ~11 for current surveys), far below the order-15 JS limit. The order-15 limit only
  bites if you index *individual image pixels* (order K+9 up to 20) — which a renderer
  never needs to do on the CPU (the GPU samples the texture).

---

## 4. JS/npm HEALPix library survey (verified on registry.npmjs.org, 2026-06-11)

| npm package | version | published | license | lang | boundaries? | query_disc? | hierarchy API? | verdict |
|---|---|---|---|---|---|---|---|---|
| **healpix-ts** | 1.1.0 | 2026-05-19 | MIT | TS, zero deps | yes (`cornersNest`) | yes (`queryDiscInclusiveNest`, `queryBox…`) | yes (`nestParent/Children/Ancestor/Descendants`) | **RECOMMENDED** |
| **@hscmap/healpix** | 1.4.12 | 2022-10-06 | MIT | TS, zero deps | yes (`corners_nest`) | yes (`query_disc_inclusive_nest`) | no (do `>>2` yourself) | solid fallback; frozen since 2022; healpy-validated |
| healpixjs (fab77) | 2.0.0 | 2026-04-28 | **dual commercial / non-commercial** (changed at 2.0) | JS port of HEALPix Java/C++ | partial (NEST only) | unclear | unclear | avoid — license risk for an app |
| @gkucmierz/healpixjs-bigint | 1.0.2 | 2026-03-06 | (per healpixjs) | JS+BigInt | — | — | — | only if order > 15 ever needed |
| @fxpineau/healpix | 0.1.3 | 2020-07-08 | (cdshealpix: Apache-2.0 OR MIT) | Rust→WASM | yes | yes | yes | **stale 6 yrs** — don't depend on it |
| @bmatthieu3/healpix | 0.1.5 | 2020-07-08 | same | Rust→WASM | — | — | — | stale twin of the above |
| @eopf-dggs/healpix-geo | 0.2.0 | 2026-03-19 | Apache-2.0 | Rust→WASM | yes ("cell vertex positions and Z-order curve") | unverified | unverified | Earth-observation DGGS focus; young (0.x); watch it |
| @fxpineau/moc-wasm | 0.11.0 | 2025-09-26 | Apache-2.0 OR MIT | Rust→WASM | n/a | cone→MOC (cell list) | via MOC orders | maintained CDS WASM; overkill for tiles, great for survey-coverage masks later |
| healpix (substack) | 1.0.0 | 2016-07-22 | BSD | JS | no | no | no | GIS toy, lonlat only — not astronomy-grade |
| healpix.js (kapadia, GitHub only) | — | ~2013, unpublished | — | JS | — | — | — | abandoned, not on npm |
| @developmentseed/deck.gl-healpix | 0.2.0 | 2026-05-12 | MIT | TS | (renders cells in deck.gl) | — | — | proof that healpix-ts is in production use |

Details:

- **healpix-ts** — https://github.com/developmentseed/healpix-ts ,
  https://www.npmjs.com/package/healpix-ts . README states it is "highly based on
  michitaro/healpix … forked, organized, documented, and new features added". Exports
  (VERIFIED from docs/API.md): `ang2PixNest/Ring`, `pix2AngNest/Ring`, `pix2VecNest`,
  `lonLat2PixNest`, `pix2LonLatNest`, `cornersNest`, `cornersNestLonLat`,
  `queryDiscInclusiveNest`, `queryBoxInclusiveNest`, `nest2ring`, `ring2nest`,
  `nestParent`, `nestChildren`, `nestAncestor`, `nestDescendants`, `isNestAncestor`,
  `orderpix2uniq`/`uniq2orderpix`, `maxPixelRadius`, plus all the low-level
  `za2tu/tu2za/tu2fxy/fxy2nest/nest2fxy/bitCombine` building blocks. Inherits the
  **order ≤ 15** limit (fine for HiPS tile orders ≤ ~11; see §3). Backed by
  Development Seed (also ships `deck.gl-healpix` on top of it). 2 releases in 2026.
- **@hscmap/healpix** — https://www.npmjs.com/package/@hscmap/healpix ,
  https://github.com/michitaro/healpix . MIT, written for the HSC (Subaru Hyper
  Suprime-Cam) sky map viewer. "Tests against healpy are used to show correctness"
  (Python test suite in repo). CDN build:
  `https://unpkg.com/@hscmap/healpix@latest/standalone/dist/healpix.js`. Frozen but
  small, pure, and correct — pinning it is low-risk.
- **healpixjs (fab77)** — v1.x (2022–2025) was the engine behind FITS/HiPS experiments
  of an ESAC developer; **v2.0.0 (2026-04) switched to a dual commercial/non-commercial
  license** (LICENSE-COMMERCIAL.md / LICENSE-NONCOMMERCIAL.md per npm metadata) and
  drags in a `jsfitsio` dependency. Unsuitable default for an open-source app.
- **cdshealpix (Rust) & Aladin Lite v3** — https://github.com/cds-astro/cds-healpix-rust
  (crate v0.9.1, 2026-03-09, Apache-2.0 OR MIT, https://crates.io/api/v1/crates/cdshealpix ).
  Provides in `cdshealpix::nested`: `hash` (ang2pix), `center`, `vertices` (4 corners),
  `path_along_cell_side`, `cone_coverage_approx[_custom]`, `elliptical_cone_coverage`,
  `polygon_coverage`, `zone_coverage`, `neighbours`, `parent`, `children`, `siblings`,
  `external_edge`, `to_uniq`, `bilinear_interpolation`, BMOCs. Aladin Lite v3
  (npm `aladin-lite` 3.9.0-beta, 2026-06-01, **GPL-3**,
  https://github.com/cds-astro/aladin-lite ) compiles it to WASM via wasm-bindgen
  **internally** — it is not re-exported as a standalone JS API. The repo's own WASM
  bindings dir is described as "Not really maintained so far: if you need it, please
  let us know!" → a fresh wasm-pack build of cdshealpix is *possible* (an afternoon of
  work, Apache/MIT licensed) but you'd own the build pipeline.

---

## 5. Recommendation & fallback plan

**Primary: `npm i healpix-ts` (MIT).** Reasons: TypeScript-native (no WASM async-init
ceremony in the render path), zero runtime deps, tree-shakeable ESM + CJS + d.ts,
maintained in 2026, API is a superset of what the tile loader needs
(corners + inclusive disc query + parent/child), and its math lineage
(michitaro → healpy test suite) is verifiable.

**Fallback A (drop-in): pin `@hscmap/healpix@1.4.12`.** Same math, same API minus the
hierarchy sugar (write `parent = ipix >> 2` yourself). Frozen-but-correct is acceptable
for 20-year-old math.

**Fallback B (port it):** the entire needed surface is ~400 lines of dependency-free
TypeScript. Port order (each verifiable against healpy in a Python cross-check script):

1. `za2tu`, `tu2za`, `sigma` — §2.4 (≈40 lines)
2. `tu2fpq`/`tu2fxy`, `fxy2tu` — §2.5 (≈50 lines)
3. `bitCombine`, `bitDecombine`, `fxy2nest`, `nest2fxy` — §2.6 (≈60 lines)
4. `ang2pixNest`, `pix2angNest`, `pix2vecNest`, `cornersNest` — §2.7/2.9 (≈60 lines)
5. `maxPixrad`, `queryDiscInclusiveNest` (+ `walk_ring`, `walk_ring_around`) — §2.11 (≈120 lines)
6. parent/child one-liners — §2.10

Port from `michitaro/healpix` (MIT — keep the attribution header) or transliterate from
`cdshealpix` Rust (Apache-2.0 OR MIT). Test harness: generate
`(nside, θ, φ) → ipix`, `ipix → corners`, `disc → pixel set` fixtures with healpy
(`pip install healpy`) for nside ∈ {1, 2, 64, 1024, 2^11}, random points + pole/seam
edge cases (φ = 0, θ = 0/π, face boundaries), assert exact integer equality for
indices and ≤1e-12 vector error for corners; assert the JS disc result is a **superset**
of healpy's `inclusive=False` result and subset of `inclusive=True, fact=64`.

**Do NOT** adopt: `@fxpineau/healpix` (stale 2020 WASM), `healpixjs@2` (license),
substack `healpix` (wrong domain), Aladin Lite internals (GPL-3 + not exported).

**Later option:** if exact cone coverage or MOC algebra is wanted (e.g. Rubin alert-sky
coverage masks), add `@fxpineau/moc-wasm` (0.11.0, 2025-09-26, CDS-maintained) — it
complements rather than replaces the per-frame TS math.

---

## 6. Renderer integration notes (how the math is actually used)

### 6.1 Tile-selection loop (per camera change, debounced)

```typescript
import { order2nside, queryDiscInclusiveNest, nestAncestor } from 'healpix-ts'

function visibleTiles(viewDirSky: V3, fovHalfAngle: number, tileOrder: number): number[] {
  if (tileOrder <= 2 || fovHalfAngle > Math.PI / 3) {
    return [...Array(12 * 4 ** tileOrder).keys()]          // whole sky at coarse order
  }
  const out: number[] = []
  queryDiscInclusiveNest(order2nside(tileOrder), viewDirSky, fovHalfAngle, p => out.push(p))
  return out
}
// LOD: pick tileOrder so that one tile ≈ screen; rule of thumb used by HiPS clients:
// tileOrder ≈ log2( (512 * sqrt(screenPixelsPerRadianOfFov)) ... ) — in practice:
// choose smallest K with  nside2resol(2^K)*512 < fovY/viewportHeightPx*512, clamp to
// [hips_order_min(=3), hips_order from properties file].
```

### 6.2 LOD fallback chain

While an order-K tile is in flight, render its order-(K−1) ancestor's texture with
sub-UV = quadrant from the 2 low bits of the child index walked up via
`nestAncestor(ipix, 1)`; the Morton structure makes the quadrant `(ipix & 3)`
↦ (x,y) sub-square via bit de-interleave of the dropped bits.

### 6.3 Tile mesh geometry

Per visible cell: `cornersNest(nside, ipix)` → 4 unit vectors (order N,W,S,E) → scale by
sky-sphere radius. Because cell edges are not geodesics (§2.1) and texture mapping
inside the cell is the HEALPix projection (not equirectangular), subdivide each tile
quad into an n×n grid (Aladin Lite uses small grids; n=4–8 is enough below ~order 3
errors): interior grid points come from stepping `(t, u)` between corners
(`fxy2tu` center ± fractions of `d = π/4/nside`) then `tu2za` → `za2vec`. UV coordinates
map linearly in (x,y)-within-face space — i.e. the de-interleaved sub-cell coordinates —
NOT linearly in RA/Dec.

### 6.4 Precision

All indices for order ≤ 15 fit comfortably in float64 (`Npix(15) ≈ 1.3e10 < 2^53`);
avoid 32-bit `|0`/`>>` tricks above order 14; healpix-ts/hscmap already guard this
(bit ops only on the ≤16-bit x/y halves).

---

## 7. UNVERIFIED / assumed (flagged for the implementer)

- **Gaia DR3 `source_id` encodes the NESTED HEALPix index at order 12 in its high bits**
  (`healpix12 = source_id >> 35` — equivalently `floor(source_id / 2^35)`; do it with
  BigInt since source_id > 2^53). From memory of the Gaia data-model docs
  ( https://gea.esac.esa.int/archive/documentation/GDR3/ ) — verify the shift (35) before
  using it to spatially chunk the star-field preprocessing; if confirmed, Gaia chunking
  by HEALPix cell is *free* (sort by source_id).
- **healpixjs v1.x license**: assumed permissive before the 2.0 dual-license switch; not
  checked — irrelevant if avoided.
- **@eopf-dggs/healpix-geo cone-search coverage**: npm description confirms vertices +
  Z-order only; whether its WASM exposes cone coverage was not verified.
- **Exact corner order returned by healpy** (N,W,S,E) is asserted from the michitaro
  test-suite equivalence and community convention; healpy's own doc page does not state
  the order explicitly. Pin it with a unit test, don't assume.
- **HiPS tile pixel orientation inside the 512×512 image** (which image corner maps to
  which cell corner / row direction): defined in the HiPS spec body but not re-verified
  here at the needed level of detail. Validate empirically against Aladin Lite rendering
  of a known field during implementation (a flipped tile is instantly visible).
- `tu2fpq` body was not captured verbatim (only its contract: diamond-face
  identification + fractional in-face coords). It is ~20 lines in
  https://github.com/michitaro/healpix/blob/master/src/index.ts — read it when porting.

---

## 8. Decisions recommended

1. **Adopt `healpix-ts@^1.1.0` (MIT)** as the single HEALPix dependency for tile math:
   `cornersNest` for geometry, `queryDiscInclusiveNest` for tile selection,
   `nestParent/nestChildren/nestAncestor` for LOD, `ang2PixNest` for gaze→cell lookup.
2. **Vendor a fallback**: commit a snapshot of `@hscmap/healpix@1.4.12` source (MIT,
   ~1 file) under `vendor/` or be prepared to port per §5 — both upstreams are
   small-bus-factor projects.
3. **NESTED-only** in the app. No RING anywhere in the render path (HiPS is NESTED by
   spec); keep `nest2ring` available only in offline preprocessing scripts (healpy side).
4. **Cap all CPU-side HEALPix math at order ≤ 13** (tile orders); never index image
   pixels (order K+9) in JS — that is the GPU's job via texture UVs. This keeps the
   order-15 library limit irrelevant and everything in fast float64.
5. **Frustum handling = bounding-cone + `queryDiscInclusive` + optional plane-test
   refinement** (§2.12); accept over-fetch of edge tiles, dedupe via the contiguous
   descendant-range property for cache keys (`[ipix<<2Δ, (ipix+1)<<2Δ)`).
6. **Do not take a WASM HEALPix dependency now.** Revisit only if profiling shows
   query_disc as a hotspot (it won't be at tile orders ≤ 11, ≤ a few hundred cells per
   query); the maintained WASM escape hatch is building `cdshealpix` 0.9.x with
   wasm-pack ourselves (Apache-2.0 OR MIT) — not the stale `@fxpineau/healpix`.
7. **License hygiene**: avoid `healpixjs@2` (commercial dual-license) and avoid linking
   any code from `aladin-lite` (GPL-3); cdshealpix Rust and both TS libraries are
   MIT/Apache — compatible with any app license.
8. Write the **healpy cross-validation fixture suite** (Python, offline, §5) on day one
   of implementation; it doubles as the regression net if we ever swap libraries.

## 9. Open questions

1. Exact HiPS tile-image orientation convention (image row/col ↔ cell x/y axes) — verify
   against Aladin Lite output on a recognizable field (e.g. Orion) during the first
   rendering spike.
2. Does `healpix-ts`'s `queryBoxInclusiveNest` operate in lon/lat space (geo heritage)
   or sky frame? Inspect `src/disc.ts`/`box.ts` before using box queries; the cone query
   path is the one inherited from the healpy-validated upstream.
3. Confirm Gaia DR3 `source_id >> 35 = healpix order-12 nested index` from the official
   data model before designing star-chunk file naming around it.
4. healpy corner ordering (N,W,S,E) vs our port — lock with a unit test.
5. For VR stereo (two eye frusta): one shared bounding cone (union) per frame, or
   per-eye queries? (Likely shared — eye separation is angularly negligible against a
   celestial sphere at infinity.) Decide in the WebXR milestone.
6. If Rubin/LSST HiPS ships at hips_order > 11 with 256-px tiles (order shift 8), the
   LOD-selection heuristic constant in §6.1 needs the `hips_tile_width` generalization —
   read it from the `properties` file rather than hardcoding 512/9.
