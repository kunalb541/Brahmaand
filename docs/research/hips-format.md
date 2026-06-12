# HiPS (Hierarchical Progressive Survey) — implementation-level research

```yaml
topic: HiPS format internals for a custom WebGL/Three.js sky renderer
date: 2026-06-11
researcher: research agent (web + live HTTP verification)
confidence: |
  HIGH for everything marked VERIFIED — taken directly from the IVOA HiPS 1.0
  Recommendation PDF (read in full sections 4-6 + appendix) or confirmed by live
  curl requests against alasky.cds.unistra.fr on 2026-06-11 (HTTP status, CORS
  headers, properties files, tiles, Allsky files, MocServer, hips2fits).
  MEDIUM for the in-tile pixel orientation recipe (derived from spec Fig. 4 +
  standard HEALPix conventions; must be verified empirically against Aladin Lite
  during implementation).
  LOW/UNVERIFIED items are explicitly labeled.
spec: IVOA HiPS 1.0, REC 2017-05-19 (still the latest version as of 2026-06)
primary_sources:
  - https://www.ivoa.net/documents/HiPS/  (landing page; latest = 1.0)
  - https://www.ivoa.net/documents/20170519/REC-HIPS-1.0-20170519.pdf
  - https://arxiv.org/pdf/1708.09704 (identical REC text, easier to fetch)
  - https://aladin.cds.unistra.fr/hips/list (master HiPS list, HTML)
  - https://github.com/cds-astro/aladin-lite (reference WebGL implementation)
```

---

## 1. Spec status (VERIFIED)

- The current standard is **HiPS 1.0, IVOA Recommendation, 2017-05-19**. No newer
  version exists as of June 2026. Landing page: https://www.ivoa.net/documents/HiPS/ ;
  REC PDF: https://www.ivoa.net/documents/20170519/REC-HIPS-1.0-20170519.pdf
- The properties-file keyword `hips_version = 1.4` refers to the *HiPS structure
  version* defined by this 1.0 REC (historical numbering from pre-IVOA Aladin days).
  Do not confuse the two. (VERIFIED: spec §4.4.1 mandatory keyword #4 says
  `hips_version: ... word "1.4" corresponds to this document specification`.)
- Foundational paper: Fernique et al. 2015, A&A 578, A114 (spec reference [1]).
- HEALPix reference: Górski et al. 2005, ApJ 622, 759 (spec reference [5]).

## 2. The `properties` file (VERIFIED, spec §4.4.1)

Plain UTF-8 text at `{baseURL}/properties`. One `keyword = value` per line, LF
(optionally CRLF) terminated; `#`-prefixed lines are comments; blank lines ignored;
whitespace around `=` ignored; keyword order irrelevant; keywords cannot contain
`=` or spaces.

**9 mandatory keywords** (spec §4.4.1):

| keyword | meaning | format/example |
|---|---|---|
| `creator_did` | unique HiPS ID | IVOID, e.g. `ivo://CDS/P/DSS2/color` |
| `obs_title` | short dataset title | free text, one line |
| `dataproduct_type` | `image` \| `catalog` \| `cube` | word |
| `hips_version` | structure version | `1.4` (= this REC) |
| `hips_release_date` | last update | ISO8601 `YYYY-MM-ddTHH:MMZ` — clients use it for cache invalidation |
| `hips_status` | list of words | (`private`\|`public`) (`master`\|`mirror`\|`partial`) (`clonable`\|`unclonable`\|`clonableOnce`); default `public master clonableOnce` |
| `hips_tile_format` | space-separated list of available tile formats; **first one is the default suggested to the client** | one or many of `fits` `jpeg` `png` (`tsv` for catalogs) |
| `hips_order` | **deepest** available HEALPix order | positive int |
| `hips_frame` | coord frame of the tile grid | `equatorial` (ICRS) \| `galactic` \| `ecliptic` |

Conditionally mandatory: `dataproduct_subtype = color|live` (for RGB tile HiPS —
all our starter surveys are `color`), `hips_cube_depth` (cubes only).

**Renderer-relevant optional keywords** (all seen live on alasky, VERIFIED):

| keyword | meaning |
|---|---|
| `hips_order_min` | shallowest published order (alasky surveys publish `0`, but spec §4.3.1 allows omitting orders 0–2; treat order 3 as the safe floor) |
| `hips_tile_width` | tile width in px, power of 2, **default 512** (every survey checked uses 512) |
| `hips_pixel_scale` | pixel angular resolution at deepest order, degrees |
| `hips_initial_ra` / `hips_initial_dec` / `hips_initial_fov` | suggested home view (degrees, ICRS) |
| `hips_pixel_cut` | suggested display cut `min max` (FITS tiles) |
| `hips_pixel_bitpix` | FITS BITPIX of fits tiles (-64,-32,8,16,32,64) |
| `moc_sky_fraction` | fraction of sky covered, 0–1 |
| `moc_access_url` | URL of the Moc.fits coverage map |
| `obs_copyright`, `obs_copyright_url`, `hips_creator`, `client_category` | attribution / UI metadata |

Real example (VERIFIED live 2026-06-11,
https://alasky.cds.unistra.fr/DSS/DSSColor/properties):

```
creator_did          = ivo://CDS/P/DSS2/color
hips_version         = 1.4
hips_order           = 9
hips_order_min       = 0
hips_frame           = equatorial
hips_tile_width      = 512
hips_tile_format     = jpeg
dataproduct_type     = image
dataproduct_subtype  = color
hips_status          = public master clonableOnce
hips_pixel_scale     = 0.229        # arcsec-ish units: degrees! (0.229" is wrong; value is in deg? see Open questions)
hips_initial_ra      = 085.30251
hips_initial_dec     = -02.25468
hips_initial_fov     = 2
moc_sky_fraction     = 1
hips_license         = ODbL-1.0
```

Parser sketch:

```ts
function parseHipsProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
```

## 3. Tile addressing and URL construction (VERIFIED, spec §6.1/§6.2 + Appendix)

```
properties  ->  {baseURL}/properties
tile        ->  {baseURL}/Norder{K}/Dir{D}/Npix{N}{.ext}
                  K   = HiPS order
                  N   = HEALPix NESTED pixel index at order K
                  D   = floor(N / 10000) * 10000        (integer division)
                  ext = .jpg | .png | .fits  (lowercase; .webp de facto, see §5)
Allsky      ->  {baseURL}/Norder{K}/Allsky{.ext}        (K typically 3)
MOC         ->  {baseURL}/Moc.fits
metadata    ->  {baseURL}/metadata.fits (image) / metadata.xml (catalog)  [optional]
preview     ->  {baseURL}/preview.jpg   (256x256)                         [optional]
index       ->  {baseURL}/index.html                                      [optional]
```

- The extension MUST be lowercase and MUST be `.jpg` for JPEG, `.png` for PNG,
  `.fits` for FITS (spec §4.2.1.3).
- Spec example: cell 10302 at order 6 → `Norder6/Dir10000/Npix10302.fits`.
- Live-verified examples (all HTTP 200 on 2026-06-11):
  - `https://alasky.cds.unistra.fr/DSS/DSSColor/Norder3/Dir0/Npix301.jpg`
  - `https://alasky.cds.unistra.fr/DSS/DSSColor/Norder9/Dir2750000/Npix2752671.jpg`
  - `https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook/Norder3/Dir0/Npix433.webp`

Tree arithmetic (spec Appendix, VERIFIED):

```
parent of tile N at order K   -> tile floor(N/4) at order K-1
children of tile N at order K -> tiles 4N, 4N+1, 4N+2, 4N+3 at order K+1
number of tiles at order K    -> 12 * 4^K        (NSIDE = 2^K)
tile angular size at order K  ~= sqrt(4*PI / (12*4^K)) = 58.63 deg / 2^K
tile pixel angular size       ~= sqrt(4*PI / (12 * (tileWidth * 2^K)^2))
```

Reference table for 512-px tiles (spec Fig. 5, VERIFIED): order 0 = 12 tiles /
58.63° each; order 3 = 768 tiles / 7.33° / 51.5″ per pixel; order 7 = 196 608
tiles / 27.5′ / 3.2″; order 9 = 3 145 728 tiles / 6.87′ / 0.81″; order 11 =
50 331 648 tiles / 1.72′ / 0.20″; order 12 → 100 mas/px.

```ts
const tileUrl = (base: string, order: number, npix: number, ext: string) =>
  `${base}/Norder${order}/Dir${Math.floor(npix / 10000) * 10000}/Npix${npix}.${ext}`;
```

A HiPS may be a **partial tree** (partial-sky surveys like SDSS/Pan-STARRS/Rubin):
out-of-coverage tiles return **404**. Use `Moc.fits` (IVOA MOC, HEALPix-based,
always equatorial) to skip requests outside coverage (spec §4.4.2, §6.3.1).

## 4. The Allsky preview file (VERIFIED, spec §4.3)

Purpose: one HTTP request bootstraps the whole low-res sky (the low orders are
otherwise hundreds of requests, and order 0–2 tiles are hugely distorted).

- Located at `{baseURL}/Norder{K}/Allsky.{ext}`, K between 0 and 3 (in practice
  **order 3** on alasky). The regular tiles at that order must also still exist.
- Layout (image HiPS): all `12*4^K` tiles packed **side by side, left-to-right,
  row-major by tile index**, into a grid whose **width in tiles =
  `floor(sqrt(numTiles))`**. At order 3: width = `floor(sqrt(768)) = 27` tiles,
  rows = `ceil(768/27) = 29` (last row partially filled). Each packed tile is
  downsampled to a power of two, **typically 64×64** → a 1728×1856 px image.
- VERIFIED live: `https://alasky.cds.unistra.fr/DSS/DSSColor/Norder3/Allsky.jpg`
  (200, 806 KB) and `.../Rubin/CDS_P_Rubin_FirstLook/Norder3/Allsky.png` (200).
  `Allsky.webp` does NOT exist for DSS (404).

```ts
// Sub-rect of tile n inside an order-3 Allsky image with 64px cells:
const col = n % 27, row = Math.floor(n / 27);
const rect = { x: col * 64, y: row * 64, w: 64, h: 64 };
// Detect cell size at runtime: cell = image.width / 27 (alasky: 1728/27 = 64).
```

Recommended client behavior (spec §6.3.1): load Allsky first, slice it into 768
order-3 textures, render immediately; replace with real `Norder3+` tiles as they
stream in.

## 5. Tile formats (VERIFIED)

- Spec-defined image tile formats (§4.2.1.3): **FITS** (full dynamic range,
  science pixels), **JPEG** (lossy, small), **PNG** (lossless + alpha; alpha used
  to mark out-of-coverage pixels in partial surveys). Catalog HiPS uses `.tsv`.
- **WebP is a de facto extension, not in HiPS 1.0**, supported by Aladin Lite v3
  and served by CDS for a few recent surveys
  (https://github.com/cds-astro/aladin-lite CHANGELOG lists webp support).
  VERIFIED via MocServer query `hips_tile_format=*webp*`: only **3** datasets at
  CDS serve webp today, including `CDS/P/Rubin/FirstLook` (`hips_tile_format =
  png webp`). Mainstream surveys (DSS2, Pan-STARRS, SDSS9, 2MASS, Mellinger) are
  **jpeg-only** in their color variants. So: implement jpg+png first; webp is a
  cheap add (the browser decodes it natively via `<img>`/`createImageBitmap`).
- GOTCHA (VERIFIED): alasky serves `.webp` tiles with **no `Content-Type`
  header** (Apache has no MIME mapping for it there). `fetch` → `blob` →
  `createImageBitmap(blob)` works regardless of the missing header.
- FITS tiles: needed only if you want client-side stretch/colormap of raw survey
  pixels — requires a JS FITS decoder; skip for v1.
- Pixel row order (spec §4.2.1.3 Note, VERIFIED): *"Contrary to the FITS
  convention, in JPEG and PNG the lines of the pixel array are stored in
  top→down direction."* I.e. a jpg/png tile is the vertical flip of the FITS
  tile. This matters for UV orientation (§7).
- Which survey serves what: read `hips_tile_format` from `properties` (it is
  mandatory) and pick the first listed format you support.

## 6. How a tile maps onto the sphere (VERIFIED spec §4.1–4.2 + HEALPix)

- HiPS tiles are **HEALPix cells in the NESTED numbering scheme only** (spec
  §4.1: "HiPS must use the NESTED numbering scheme only"), in the frame given by
  `hips_frame`.
- A single tile at order K covers exactly one HEALPix cell of NSIDE = 2^K: an
  **equal-area curvilinear quadrilateral ("rhombus/diamond")** on the sphere,
  with 4 corners conventionally called N/E/S/W (N–S and E–W are the diagonals).
  It is NOT a lat/lon rectangle and its edges are not great circles.
- A 512-px tile packs the values of the 512×512 = 2^9×2^9 HEALPix sub-cells of
  order K+9 that subdivide the cell ("shift order" S=9; tileWidth=2^S, spec
  §4.2.1). So *texture pixels themselves sit on the HEALPix grid* of order K+9.
- Geometry math you need (HEALPix standard, spec Appendix):
  - `pix2ang_nested(N, K)` → cell center (lon, lat)
  - cell corner/boundary computation (`pix2corners_nested`, or `boundaries`)
  - `ang2pix_nested(lon, lat, K)` → which cell contains a direction (for picking)
  - cone/disc query → list of cells intersecting the view frustum
- Frame trap: `hips_frame` may be `galactic` (e.g. **Mellinger**, VERIFIED).
  Then tile N's HEALPix coordinates are galactic; rotate to ICRS with the fixed
  galactic↔ICRS rotation matrix before placing vertices, or parent the whole
  tile mesh under a rotated Object3D.

## 7. Rendering approach (spec §6.3.1 + standard practice)

Spec's suggested algorithm (VERIFIED, §6.3.1 — spec is non-prescriptive):

1. Pick the HiPS order so ~1 tile pixel covers ~1 screen pixel.
2. Compute the list of HEALPix NESTED indices covering the view (HEALPix lib).
3. Fetch those tiles (cache them — spec §6.2 *strongly recommends* client caching).
4. Draw each tile on its HEALPix cell. *"The fast method uses only the 4 corners
   of the HEALPix cell and draws the tile in two complementary triangles ...
   mapping the bilinear stretch of the tile. This drawing step may be improved
   ... by subdividing each tile in sub HEALPix cells and by this way, reduce the
   projection distortions."* — i.e. the standard approach is a **curvilinear
   quad subdivided into an n×n vertex grid**, not a 2-triangle quad.

Order selection (from the spec pixel-size formula):

```ts
// screenPixRad: angular size of one screen pixel at view center (fov/height)
function pickOrder(screenPixRad: number, tileWidth = 512, minOrder = 3, maxOrder = 11) {
  let k = minOrder;
  const pixSize = (K: number) => Math.sqrt(4 * Math.PI / 12) / (tileWidth * 2 ** K);
  while (k < maxOrder && pixSize(k) > screenPixRad) k++;
  return k;     // clamp to survey's hips_order / hips_order_min
}
```

Building one tile mesh in Three.js (the HEALPix "face coordinate" method used by
Aladin Lite / cdshealpix — exact, no boundary interpolation hacks):

- NESTED index decomposition: `face = N >> (2K)` (0..11), and `(x, y)` inside
  the face by de-interleaving the low `2K` bits of N (even bits → x, odd → y).
- HEALPix defines a bijection from continuous face coordinates
  `(face, u∈[0,1], v∈[0,1])` to the sphere (the inverse HEALPix projection).
  Grid vertex `(i, j)` of an n×n-subdivided tile = inverse projection of
  `(face, (x + i/n)/2^K, (y + j/n)/2^K)`.
- Build a `BufferGeometry` with `(n+1)^2` vertices, indexed 2n² triangles,
  UVs assigned per §below. n = 4 is fine for order ≥ 3 tiles (7.3°); use
  n = 8–16 if you ever draw order 0–2 tiles (better: never draw them — start at
  order 3 via Allsky, which is what `hips_order_min` omission anticipates).
- Distortion warning (spec §4.3): the 4 base cells touching the poles are the
  worst; with order ≥ 3 + n ≥ 4 subdivision the error is sub-pixel for typical
  FoV. This is exactly why the Allsky/order-3 floor exists.

UV orientation (MEDIUM confidence — derived, must verify empirically):

- Spec Fig. 4 shows the FITS tile array with the cell's **E corner at the FITS
  origin**, x axis running along the E→N edge and y axis along the E→S edge;
  jpg/png are the top-down flip of FITS (§5). Combining: for a jpg/png tile
  uploaded to WebGL with `flipY = false`, use approximately
  `uv(E)=(0,0), uv(N)=(1,0), uv(S)=(0,1), uv(W)=(1,1)` where N/E/S/W are the
  cell corners from HEALPix (N = (x+1,y+1) face corner, S = (x,y), E = (x+1,y),
  W = (x,y+1) in nested face coords).
- DO NOT trust this blindly: get one DSS tile rendering, open the same field in
  Aladin Lite (https://aladin.cds.unistra.fr/AladinLite/), and check orientation
  + mirror parity. There are 8 possible orientations; one screenshot comparison
  ("is Orion's belt slanting the right way") settles it in minutes.

Reference implementation to crib from: **Aladin Lite v3**
(https://github.com/cds-astro/aladin-lite, Rust→WASM + WebGL2, GPL-3.0 — fine to
*read* for algorithm understanding; do not copy code into a non-GPL project) and
its HEALPix core https://github.com/cds-astro/cds-healpix-rust.

HEALPix-in-JS options (UNVERIFIED npm state — check before committing):
`@hscmap/healpix` (TS port used by hscMap), `healpix` npm package, or compile
`cds-healpix-rust` to WASM. Needed functions: ang2pix/pix2ang nested, face
decomposition, inverse face projection, cone search. Worst case the math is
~300 lines from the Górski 2005 paper.

## 8. CORS on the CDS servers (VERIFIED by live requests, 2026-06-11)

Both hosts return permissive CORS on properties, tiles (GET with an `Origin:`
header) and Allsky files:

```
access-control-allow-origin: *
access-control-allow-methods: GET, OPTIONS
access-control-allow-headers: *
```

- VERIFIED on `https://alasky.cds.unistra.fr/...` and the mirror
  `https://alaskybis.cds.unistra.fr/...` (identical content, same ETags), and on
  `https://aladin.cds.unistra.fr/hips/list`, MocServer, and hips2fits responses.
- Aladin Lite itself is served from `aladin.cds.unistra.fr` (and embedded on
  arbitrary third-party pages) while loading tiles from `alasky*` — i.e. its
  normal operation IS a cross-origin load, confirming CORS in practice.
- Servers speak HTTP/2 (good for many small parallel tile fetches), send
  `ETag`/`Last-Modified` (enable browser revalidation), and `alaskybis` is the
  documented failover mirror. Legacy hostname `alasky.u-strasbg.fr` still
  appears inside properties files; always prefer the `.cds.unistra.fr` names.

## 9. Discovery: master HiPS list and MocServer (VERIFIED)

- Human-browsable master list (~the whole HiPS network, CDS-aggregated):
  **https://aladin.cds.unistra.fr/hips/list** (HTML table; 200, CORS *).
- Machine-readable HiPS list of the alasky server (spec §5.2 hipslist format =
  concatenated properties records separated by blank lines, mandatory keys
  `creator_did`, `hips_release_date`, `hips_service_url`, `hips_status`):
  **https://alasky.cds.unistra.fr/hipslist** (200, CORS *).
- **MocServer** — the queryable aggregator Aladin Lite uses, best option for an
  app: `https://alasky.cds.unistra.fr/MocServer/query?...`
  - Count image HiPS: `?expr=dataproduct_type%3Dimage%20%26%26%20hips_service_url%3D*&get=number`
    → **1349** records (live 2026-06-11).
  - Full JSON records: `...&get=record&fmt=json` (returns every properties
    keyword + `hips_service_url`, ready to feed a survey picker).
  - By ID: `?ID=CDS/P/DSS2/color&get=record&fmt=json`; coverage:
    `?ID=...&get=moc&fmt=json` (JSON `{order: [pixels...]}` — VERIFIED).

## 10. Recommended starter surveys (ALL VERIFIED live, 2026-06-11)

| Survey | Base URL (append `/properties`, `/Norder...`) | `creator_did` | max order | formats | frame | sky frac |
|---|---|---|---|---|---|---|
| DSS2 color | `https://alasky.cds.unistra.fr/DSS/DSSColor` | ivo://CDS/P/DSS2/color | 9 | jpeg | equatorial | 1.0 |
| Pan-STARRS DR1 color (z/zg/g) | `https://alasky.cds.unistra.fr/Pan-STARRS/DR1/color-z-zg-g` | ivo://CDS/P/PanSTARRS/DR1/color-z-zg-g | 11 | jpeg | equatorial | 0.781 |
| SDSS9 color | `https://alasky.cds.unistra.fr/SDSS/DR9/color` | ivo://CDS/P/SDSS9/color | 10 | jpeg | equatorial | 0.363 |
| Mellinger color | `https://alasky.cds.unistra.fr/MellingerRGB` | ivo://CDS/P/Mellinger/color | 4 | jpeg | **galactic** | 1.0 |
| 2MASS color (JHK) | `https://alasky.cds.unistra.fr/2MASS/Color` | ivo://CDS/P/2MASS/color | 9 | jpeg | equatorial | 1.0 |
| Rubin First Look | `https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook` | ivo://CDS/P/Rubin/FirstLook | 12 | **png webp** | equatorial | 5.66e-4 |

Mirror: replace host with `alaskybis.cds.unistra.fr` (verified identical).
All are `hips_tile_width = 512`, `hips_order_min = 0`, `hips_status = public
master clonableOnce`. Note Mellinger's galactic frame and its low max order (4)
— it is the classic low-zoom "pretty Milky Way" base layer; switch to
DSS2/Pan-STARRS as the user zooms.

### Rubin/LSST availability (VERIFIED)

- **Yes — one Rubin HiPS is publicly reachable without auth**:
  `CDS/P/Rubin/FirstLook` at
  `https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook/` —
  HiPS of the June 2025 "First Look" imagery (release date 2025-06-26, order 12
  ≈ 100 mas/px, `png webp`, coverage ≈ 0.057 % of sky ≈ 23 deg² around the
  Trifid/Lagoon region; `hips_initial_ra=271.60, dec=-23.88, fov=6`).
  Copyright: RubinObs/NOIRLab/SLAC/NSF/DOE/AURA, use policy at
  https://rubinobservatory.org/media/design-resources/use-policy.
  Tiles verified 200 with CORS (e.g. `Norder3/Dir0/Npix433.webp`).
- The proper survey HiPS (DP1/DP2 coadds) live inside the Rubin Science
  Platform (`data.lsst.cloud`), which requires data-rights login (UNVERIFIED
  directly — endpoint not probed; based on Rubin docs, DP1 https://dp1.lsst.io/
  is data-rights restricted). DP2 (LSSTCam science commissioning) is slated
  Jul–Sep 2026 per https://rubinobservatory.org/for-scientists/data-products/recent-data-releases ;
  Rubin alerts have been public-streaming since 2026-02-24. Design the layer
  system so a Rubin HiPS base URL can be dropped in later.

## 11. hips2fits cutout service (VERIFIED)

`GET https://alasky.cds.unistra.fr/hips-image-services/hips2fits` — returns a
projected cutout of any HiPS (for object-info panels). HEAD is rejected (405);
GET verified 200, `image/jpeg`, CORS *:

```
https://alasky.cds.unistra.fr/hips-image-services/hips2fits
  ?hips=CDS%2FP%2FDSS2%2Fcolor     # creator_did short form, URL-encoded
  &ra=83.63&dec=22.01&fov=1        # degrees (Crab nebula)
  &width=300&height=300
  &projection=TAN&coordsys=icrs
  &format=jpg                      # jpg | png | fits
```

## 12. Decisions recommended

1. **Target HiPS 1.0 exactly**; ignore drafts. Treat `webp` as an optional
   format extension keyed off `hips_tile_format`.
2. **Survey config = base URL only.** Fetch and parse `{base}/properties` at
   runtime for order range, tile width, formats, frame, attribution. Hardcode
   the §10 table as the curated starter set; later populate a picker from
   MocServer (`get=record&fmt=json`).
3. **Render strategy**: inside-out sphere built from per-tile curvilinear-quad
   meshes; never draw orders 0–2; bootstrap with `Norder3/Allsky.{jpg|png}`
   sliced into 768 64-px textures, then stream real tiles. Per-tile n×n vertex
   grid with n=4 (sub-pixel accurate at order ≥ 3); vertices via nested-index →
   (face, x, y) → inverse HEALPix face projection.
4. **Order selection** per the spec pixel-size formula, clamped to
   `[max(3, hips_order_min), hips_order]`; keep parent tiles rendered until all
   children arrive (progressive refinement, like Aladin Lite).
5. **Fetching**: `fetch` → `blob` → `createImageBitmap` (handles the missing
   webp Content-Type); LRU texture cache (e.g. 300–600 tiles); rely on browser
   HTTP cache + ETags; use `alasky` primary with `alaskybis` retry-on-failure;
   treat 404 as "no coverage" (paint transparent/black), and prefetch `Moc.fits`
   (or MocServer `get=moc&fmt=json`) for partial surveys to avoid 404 storms.
6. **Frames**: convert galactic-frame HiPS (Mellinger) with a single fixed
   rotation; keep the scene graph in ICRS/J2000 everywhere else.
7. **Defaults**: DSS2 color as default base layer (full sky, order 9,
   battle-tested); Pan-STARRS DR1 color as the "deep zoom" layer; Rubin First
   Look as a demo overlay layer to prove the Rubin pipeline early.
8. **License hygiene**: read Aladin Lite (GPL-3.0) for algorithms only; write
   our renderer clean-room from this doc + the spec. Show `obs_copyright` /
   `obs_ack` attribution in the UI (DSS2 requires the STScI acknowledgment).

## 13. Open questions

1. **Tile pixel orientation parity** (§7): the E-corner-origin UV recipe is
   derived, not tested. Must be verified by visual diff against Aladin Lite on
   first render. (Cheap, blocking for correctness, do it first.)
2. **JS HEALPix library choice**: npm health of `@hscmap/healpix` vs `healpix`
   vs compiling `cds-healpix-rust` to WASM was not verified — needs a quick
   spike (requirements: nested pix2ang/ang2pix, face decomposition, inverse
   face projection, cone search; TypeScript types a plus).
3. **alasky usage policy / rate limits**: no published request-rate limit found;
   CDS asks heavy users to mirror (`hips_status` clonable). If our traffic
   grows, mirror the low orders (0–6 of DSS2 ≈ small) to our own static host —
   HiPS is just files, so `wget -r` of `NorderK` directories works.
4. **`hips_pixel_scale` units for DSS2** read `0.229` — spec says degrees, but
   0.229° contradicts order 9 (~8e-4 deg). Likely a survey-metadata quirk;
   compute pixel scale from order+tile width instead of trusting this keyword.
5. **Rubin DP2 HiPS**: will an unauthenticated HiPS of DP2 coadds appear
   (CDS mirror or rubin endpoint) after Jul–Sep 2026? Re-check MocServer for
   `ID=*Rubin*` / `*LSST*` periodically; design assumes drop-in base URL.
6. **FITS tiles** (client-side stretch, quantitative pixels): deferred — decide
   if v2 needs them (would add a FITS decoder + custom shader colormap path).
7. The IVOA HiPS landing page also lists an **Erratum 1** process? (Not seen on
   the landing page fetch — assume none; re-check
   https://www.ivoa.net/documents/HiPS/ before freezing the blueprint.)
