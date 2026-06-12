# Research: Gaia DR3 → compact static star catalog for a web 3D/VR app

```yaml
topic: Offline preprocessing pipeline turning Gaia DR3 into static binary star
       chunks for a TypeScript/Three.js/WebXR flythrough star field
date: 2026-06-11
author: research agent (Claude)
confidence: |
  HIGH on archive endpoints, table names, quotas, and star counts — all
  verified live against the ESA Gaia TAP server on 2026-06-11 (count queries
  actually executed, results quoted below).
  HIGH on Bailer-Jones table/columns (queried live).
  MEDIUM on color-conversion formulas (well-known published approximations,
  not re-derived).
  MEDIUM on file-size/compression estimates (arithmetic verified, compression
  ratios estimated).
status: research dump for implementing AI — no app code exists yet
```

---

## 1. TL;DR / pipeline shape

1. Run **one async ADQL job** against the ESA Gaia archive joining
   `gaiadr3.gaia_source` with `external.gaiaedr3_distance` (Bailer-Jones
   geometric distances), with cuts `phot_g_mean_mag < 12.5` and
   `parallax_over_error > 5` → **4.68 M stars** (count verified live, see §5).
   Requires a free registered account (anonymous async caps at 3 M rows).
2. Download the result as gzipped CSV/VOTable (~a few hundred MB), then run a
   Python script (astropy/numpy/pandas) that:
   - converts (ra, dec, r_med_geo) → Cartesian XYZ in parsecs (ICRS),
   - converts `bp_rp` → effective temperature (Ballesteros 2012) → RGB
     (blackbody table or Tanner-Helland-style fit),
   - encodes per-star records into little-endian binary,
   - partitions into octree chunks (bright stars in shallow nodes → natural
     LOD), writes `chunk_<id>.bin` + one `index.json`.
3. Serve the chunks statically with long-cache headers; the web app fetches
   `index.json`, streams chunks into `Float32Array`/`Uint8Array` views, and
   feeds them to a Three.js `Points`/custom shader.

Budget: ~**76 MB** raw for 4.7 M stars at 16 B/star, ~**16 MB** for a 1 M-star
subset (see §10 for exact arithmetic and a quantized 8 B/star variant).

---

## 2. Gaia archive TAP endpoint and ADQL basics

### VERIFIED

- TAP base: `https://gea.esac.esa.int/tap-server/tap`
  - Synchronous: `https://gea.esac.esa.int/tap-server/tap/sync`
  - Asynchronous: `https://gea.esac.esa.int/tap-server/tap/async`
  - Source: https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access
- Output formats: `votable`, `votable_plain`, `csv`, `json`, `fits`
  (same source).
- Query language is ADQL (SQL-92 subset + geometry functions). Main table:
  `gaiadr3.gaia_source` (152 columns); a slim 51-column variant
  `gaiadr3.gaia_source_lite` exists.
  Source: https://www.cosmos.esa.int/web/gaia-users/archive/writing-queries
- Raw sync query via curl (this exact pattern was executed successfully on
  2026-06-11 from this machine):

```bash
curl -s "https://gea.esac.esa.int/tap-server/tap/sync" \
  --data-urlencode "REQUEST=doQuery" \
  --data-urlencode "LANG=ADQL" \
  --data-urlencode "FORMAT=csv" \
  --data-urlencode "QUERY=SELECT TOP 5 source_id, ra, dec, parallax FROM gaiadr3.gaia_source"
```

- Async job submission via curl (documented pattern):

```bash
curl -i -X POST "https://gea.esac.esa.int/tap-server/tap/async" \
  --data "PHASE=run&LANG=ADQL&REQUEST=doQuery&FORMAT=csv&QUERY=<urlencoded ADQL>"
# → 303/Location header gives the job URL; poll  {job}/phase  until COMPLETED;
# fetch  {job}/results/result
```

- ADQL syntax notes: `SELECT TOP n` (not `LIMIT`), no `OFFSET`; cone search via
  `1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', <ra>, <dec>, <radius_deg>))`.
  Source: https://www.cosmos.esa.int/web/gaia-users/archive/writing-queries

### Limits and quotas (VERIFIED — https://www.cosmos.esa.int/web/gaia-users/archive/faq)

| Limit | Anonymous | Registered (free self-signup) |
|---|---|---|
| Sync query timeout | 60 s | 60 s |
| Async job timeout | 120 min | 120 min |
| Async max result rows | **3,000,000** | **unlimited** |
| Job (result) storage quota | n/a (kept ~3 days) | 20 GB, kept indefinitely |
| User-uploaded tables | temporary | 1 GB persistent |
| DataLink `load_data` sources | 5,000/query | 5,000/query |

Consequence: a 4–5 M-row extraction **requires a registered account** (or two
anonymous jobs split by a `random_index`/dec band — but just register).

---

## 3. Columns to select

### VERIFIED (column names confirmed in live queries and at
https://gaia.aip.de/metadata/gaiadr3/gaia_source/ and
https://irsa.ipac.caltech.edu/data/Gaia/dr3/gaia_dr3_source_colDescriptions.html)

| Column | Type/unit | Why |
|---|---|---|
| `source_id` | int64 | Stable ID within DR3; key for the BJ join; keep for click-through to SIMBAD/TAP lookups |
| `ra`, `dec` | float64, deg (ICRS, epoch 2016.0) | Position |
| `parallax` | float64, mas | Fallback distance; sanity checks |
| `parallax_over_error` | float32 | Primary quality cut |
| `phot_g_mean_mag` | float32, mag | Brightness / point sizing / LOD ordering |
| `bp_rp` | float32, mag | Color index → RGB (can be NULL!) |
| `radial_velocity` | float32, km/s | Optional, NULL for most faint stars; only needed if you animate proper motion in 3D |
| `ruwe` | float32 | Optional astrometric-quality cut (`ruwe < 1.4` is the standard) |
| `teff_gspphot` | float32, K | DR3 convenience column (GSP-Phot); direct temperature when available — better than color-derived, but NULL for ~3/4 of all sources |
| `pmra`, `pmdec` | float64, mas/yr | Optional, for 3D velocity vectors together with radial_velocity |

Note: `distance_gspphot` also exists in `gaia_source`, but it is a
photometric-model distance; prefer Bailer-Jones (§4) for geometry-driven 3D
positions.

---

## 4. Distances: why not 1/parallax, and the Bailer-Jones fix

### VERIFIED

- Naive `d = 1000/parallax` (pc, parallax in mas) is **biased**: parallax is a
  noisy measurement that can be small, zero, or negative; inverting a noisy
  quantity skews the distance distribution, and a flux-limited sample
  preferentially scatters distant stars inward/outward asymmetrically
  (classic Lutz–Kelker-type bias). Bailer-Jones et al. 2021, "Estimating
  Distances from Parallaxes V" (AJ 161, 147) solves this with a Bayesian
  prior built per sky direction from a Galaxy model:
  https://iopscience.iop.org/article/10.3847/1538-3881/abd806 /
  https://arxiv.org/abs/2012.05220
- Two estimates per star: **geometric** (parallax only) and
  **photogeometric** (parallax + G + BP−RP; tighter for poor parallaxes).
  Geometric for 1.47 B stars; photogeometric for ~92 % of them.
- **Exact table names** (verified at
  https://bailer-jones.www3.mpia.de/gedr3_distances.html and by live query):
  - ESA Gaia archive: **`external.gaiaedr3_distance`**
    (NOT `gaiadr3.gaiadr3_distance` — that table does not exist)
  - GAVO Heidelberg TAP: `gedr3dist.main` (http://dc.g-vo.org/tableinfo/gedr3dist.main)
  - VizieR: catalog `I/352`
- Columns: `source_id`, `r_med_geo`, `r_lo_geo`, `r_hi_geo`,
  `r_med_photogeo`, `r_lo_photogeo`, `r_hi_photogeo`, `flag`.
  Distances are in **parsecs** (medians + 16th/84th percentiles).
- Live verification (executed 2026-06-11):

```bash
curl -s "https://gea.esac.esa.int/tap-server/tap/sync" \
  --data-urlencode "REQUEST=doQuery" --data-urlencode "LANG=ADQL" \
  --data-urlencode "FORMAT=csv" \
  --data-urlencode "QUERY=SELECT TOP 2 source_id, r_med_geo, r_med_photogeo, flag FROM external.gaiaedr3_distance"
# → source_id,r_med_geo,r_med_photogeo,flag
#   2034747323515627392,741.4951,,10099       (note: r_med_photogeo can be NULL)
```

- The table is keyed to **EDR3** source_ids, but Gaia DR3 uses the *same
  source list and astrometry as EDR3*, so joining against
  `gaiadr3.gaia_source` on `source_id` is valid (this is the join the
  Bailer-Jones page itself recommends for the ESA archive).
  Source: https://www.cosmos.esa.int/web/gaia/dr3

### Parallax zero point (VERIFIED, optional refinement)

EDR3/DR3 parallaxes carry a magnitude/color/position-dependent zero-point bias
of order −17 to −40 µas (Lindegren et al. 2021, A&A 649, A4). Python package
`gaiadr3-zeropoint` (https://pypi.org/project/gaiadr3-zeropoint/, repo
https://gitlab.com/icc-ub/public/gaiadr3_zeropoint) computes the correction
from `phot_g_mean_mag`, `nu_eff_used_in_astrometry`, `pseudocolour`,
`ecl_lat`, `astrometric_params_solved`. **For a visualization app this is
negligible** (bright, high-S/N stars; the BJ catalog already accounts for the
zero point in its likelihood) — skip it, but document why.

---

## 5. Selection cuts — live-verified star counts

### VERIFIED — I executed these counts against `gaiadr3.gaia_source` on 2026-06-11:

| Cut (all with `parallax_over_error > 5`) | Count |
|---|---|
| `phot_g_mean_mag < 11.5` | **1,937,515** |
| `phot_g_mean_mag < 12.5` | **4,683,166** |
| `phot_g_mean_mag < 13.5` | **10,794,696** |

So the "1 M target" ≈ G < 11.5 and the "5 M target" ≈ G < 12.5 when combined
with `parallax_over_error > 5`. (Rule of thumb, consistent with these numbers:
counts grow ~2.4–2.5× per magnitude — UNVERIFIED beyond these three points.)

### Recommended production query (registered account, async):

```sql
SELECT g.source_id, g.ra, g.dec,
       g.phot_g_mean_mag, g.bp_rp, g.teff_gspphot,
       g.parallax, g.parallax_over_error, g.radial_velocity,
       d.r_med_geo, d.r_med_photogeo
FROM gaiadr3.gaia_source AS g
JOIN external.gaiaedr3_distance AS d USING (source_id)
WHERE g.phot_g_mean_mag < 12.5
  AND g.parallax_over_error > 5
  AND g.ruwe < 1.4
```

Notes:
- `ruwe < 1.4` trims astrometrically suspect solutions (binaries/blends);
  expect it to drop the 4.68 M slightly — exact post-cut count UNVERIFIED.
- Distance choice per star: `COALESCE(r_med_photogeo, r_med_geo)` —
  photogeometric preferred ("generally higher accuracy and precision for
  stars with poor parallaxes" — BJ page), geometric as fallback.
- Bright-star caveat: Gaia saturates around G ≈ 3 and the very brightest
  naked-eye stars (Sirius, etc.) are missing or have poor solutions in
  gaia_source. **Patch the bright end with Hipparcos or ATHYG** (§9) — this is
  the same thing Gaia Sky does ("they also include the brighter stars from the
  Hipparcos catalogue, using the official Gaia-Hipparcos crossmatch",
  https://gaia.ari.uni-heidelberg.de/gaiasky/docs/master/LOD-catalogs.html).
  Saturation-limit detail UNVERIFIED here; the missing-bright-stars problem
  itself is well documented.

---

## 6. astroquery.gaia usage (Python)

### VERIFIED against https://astroquery.readthedocs.io/en/stable/gaia/gaia.html

```python
# pip install astroquery  (uses TAP+ under the hood)
from astroquery.gaia import Gaia

Gaia.MAIN_GAIA_TABLE = "gaiadr3.gaia_source"
Gaia.ROW_LIMIT = -1            # default is 50 (!) — -1 means unlimited

Gaia.login(user="...", password="...")   # needed to exceed 3M-row anon cap

query = """  <the SQL from §5>  """
job = Gaia.launch_job_async(
    query,
    dump_to_file=True,
    output_format="csv",       # also: votable(_gzip), fits, json
    output_file="gaia_g125_plx5.csv.gz",
)
table = job.get_results()      # astropy Table (skip if dump_to_file is enough)
Gaia.logout()
```

- Async jobs persist server-side: anonymous ~3 days, registered until deleted
  (20 GB quota). `Gaia.load_data()` (DataLink, for spectra etc.) is capped at
  5,000 sources/call — irrelevant for this pipeline.
- Expect the 4.7 M-row job to take minutes to tens of minutes; the 120-min
  async timeout is comfortable. (Runtime estimate UNVERIFIED.)

---

## 7. Alternative bulk route: ESA CDN flat files

### VERIFIED

- Full `gaia_source` is downloadable as **gzipped ECSV** from
  `https://cdn.gea.esac.esa.int/Gaia/gdr3/gaia_source/`
  (README: https://cdn.gea.esac.esa.int/Gaia/gdr3/_readme.txt).
- **3,386 files**, partitioned by HEALPix level-8 ranges, ~500,000 sources
  each (file names like `GaiaSource_000000-003111.csv.gz`). All Gaia DR3
  tables together ≈ 10 TB; gaia_source alone is a sizable fraction (exact
  gaia_source-only size UNVERIFIED, order ~3 TB based on rows×width estimate).
- ECSV = CSV plus a YAML metadata header in `#` comments — readable by
  `astropy.table.Table.read(..., format='ascii.ecsv')` or plain pandas with
  `comment='#'`.

### Assessment (opinion)

For a ≤5 M-star, ≤15-column extract, the CDN route is the wrong tool: you would
stream ~terabytes to keep <0.3 % of the cells. Use it only if you later want
*many* columns for *hundreds of millions* of stars (e.g. a server-side octree
of the whole catalog) — then download the 3,386 files, filter each with a
streaming parser (DuckDB or polars `scan_csv` works well), and never hold the
whole thing in RAM. Otherwise: TAP async job wins.

---

## 8. Color: `bp_rp` → RGB

### VERIFIED formulas / sources

1. **Ballesteros (2012)** blackbody-based color→temperature (EPL 97, 34008;
   https://arxiv.org/abs/1201.1809):

   `T = 4600 K * ( 1/(0.92*C + 1.7) + 1/(0.92*C + 0.62) )`

   defined for Johnson `C = B−V`. Implemented in PyAstronomy
   (https://pyastronomy.readthedocs.io/). Applying it directly to `C = bp_rp`
   is a common shortcut but an **approximation** (BP−RP ≠ B−V; UNVERIFIED
   error bounds — for rendering it is fine, see decision §11).
2. **Temperature → RGB**: precompute or fit against Mitchell Charity's
   blackbody color table (CIE→sRGB, D65), 1,000–40,000 K:
   http://www.vendian.org/mncharity/dir3/blackbody/ — the de-facto standard
   lookup used by most renderers (also the basis of Blender's Blackbody node,
   https://docs.blender.org/manual/en/latest/render/shader_nodes/converter/blackbody.html).
3. Where `teff_gspphot` is non-NULL (it will be for most bright stars —
   exact fraction in our cut UNVERIFIED), use it directly and skip step 1.

### Suggested implementation (offline, Python)

```python
import numpy as np

def bprp_to_teff(bp_rp):                     # Ballesteros 2012, C≈BP-RP
    c = np.clip(bp_rp, -0.6, 4.0)
    return 4600.0 * (1.0/(0.92*c + 1.7) + 1.0/(0.92*c + 0.62))

# teff -> sRGB: either embed a 1D LUT sampled from Charity's table
# (e.g. 256 entries, 1000..40000 K, log-spaced) or use a piecewise fit
# (Tanner Helland / Neil Bartlett style). LUT is simpler and exact enough.
```

Handle `bp_rp` NULL (no BP/RP photometry): assign a neutral white
(~6500 K). Encode final color as **uint8 RGB** (or pack a 256-entry palette
index — see §10). Optionally desaturate toward white for bright stars to mimic
eye response (artistic choice).

---

## 9. ra/dec/distance → Cartesian XYZ (ICRS)

Standard spherical→Cartesian (no external verification needed — textbook):

```
x = d * cos(dec) * cos(ra)
y = d * cos(dec) * sin(ra)
z = d * sin(dec)            # d in parsecs, ra/dec in radians; frame: ICRS
```

Equivalent astropy (VERIFIED API, astropy docs):

```python
from astropy.coordinates import SkyCoord
import astropy.units as u
c = SkyCoord(ra=ra*u.deg, dec=dec*u.deg, distance=d_pc*u.pc, frame="icrs")
xyz = c.cartesian.xyz.to(u.pc).value      # shape (3, N)
```

Decisions for the app:
- Keep the **ICRS axes directly as world axes** (x→vernal equinox, z→north
  celestial pole). The HiPS celestial sphere uses the same frame, so the
  far-field sky texture and the 3D star field stay aligned by construction.
- Three.js is right-handed Y-up; ICRS is right-handed Z-up. Map
  `three.(x,y,z) = icrs.(y, z, x)` (any fixed proper rotation works — just be
  consistent between star chunks and the HiPS sphere orientation).
- Units: 1 world unit = 1 parsec is convenient; the G<12.5 ∧ plx/err>5 sample
  lies almost entirely within a few kpc, so Float32 world coordinates are
  precise to ≲0.001 pc — no precision problem. For camera flythrough use a
  floating origin / chunk-relative offsets anyway to avoid GPU jitter.
- Epoch: positions are epoch 2016.0; ignore proper motion for rendering
  (sub-arcsecond over decades) unless animating velocities.

---

## 10. Prebuilt catalogs worth stealing from

### ATHYG (Augmented Tycho + HYG) — VERIFIED

- Repo: **https://codeberg.org/astronexus/athyg** (GitHub
  https://github.com/astronexus/ATHYG-Database is archived; HYG classic:
  https://github.com/astronexus/HYG-Database). Project page:
  https://www.astronexus.com/projects/at-hyg
- Current version **v3.3** (Codeberg README; astronexus.com page still says
  3.2 — slightly stale). ~**2.55 M stars** (Tycho-2 base, augmented with Gaia
  DR3 distances/velocities + Hipparcos/HD/Bayer/Flamsteed/proper names).
- License: **CC BY-SA 4.0** (v3.0+). ShareAlike — fine for an app that credits
  and shares the derived catalog under the same license; consider implications
  before mixing into a proprietary data blob.
- Files: `athyg_v33-1.csv.gz` + `athyg_v33-2.csv.gz` (concatenate), >200 MB
  compressed. Subsets: HYGLike (118,971 stars, drop-in HYG schema),
  mag ≤ 10 or d < 100 ly (330,341), mag ≤ 11 (871,153).
- Columns include precomputed **x,y,z (and vx,vy,vz)** plus IDs
  (`tyc`,`gaia`,`hip`,`hd`,`hr`,`gl`), `proper` names, `ra`,`dec`,`mag`,
  `absmag`, `spect`, `ci` (B−V).
- **Why it matters**: it is the cleanest source for (a) the bright stars Gaia
  misses, (b) proper names/Bayer designations for the click-info UI, (c) a
  ready-made ~100 k "starter" catalog to get rendering working before the
  Gaia pipeline exists.

### Gaia Sky LOD catalogs — VERIFIED

- Dataset list: https://gaiasky.space/resources/datasets/ ; files under
  https://gaia.ari.uni-heidelberg.de/gaiasky/repository/catalog/dr3/
- DR3 variants (stars / size): small 8.2 M / 534 MiB; **default 15.13 M /
  1010 MiB**; medium 49.94 M / 3.1 GiB; large 122 M / 7.4 GiB; … up to 1.47 B
  / 86.9 GiB ("Bayesian distances" = Bailer-Jones-based). Selection is by
  parallax-error thresholds (e.g. default = 20 %/1.5 % bright/faint).
- Format: documented custom binary octree LOD — `metadata.bin` (octree nodes)
  + `particles_NNNNNN.bin` per octant:
  https://gaia.ari.uni-heidelberg.de/gaiasky/docs/master/LOD-catalogs.html
- License of the data files not stated on the page (UNVERIFIED — Gaia data
  itself is free to use with "ESA/Gaia/DPAC, CC BY-SA 3.0 IGO" attribution;
  confirm before redistributing Gaia-derived chunks).
- **Why it matters**: don't ship their format (Java-oriented, includes more
  per-star fields than we need), but **steal the architecture**: octree LOD
  keyed by brightness, magnitude-sorted particles per node, Hipparcos-patched
  bright end. Their thresholds table is also a useful star-count/size
  calibration reference.

---

## 11. Recommended binary chunk format + size math

### Recommendation (opinion, informed by §10)

Structure-of-arrays per chunk, little-endian, no padding issues, directly
uploadable as GPU buffers:

```
chunk_<id>.bin layout (SoA):
  header (16 B):  magic 'GSC1' (4B) | uint32 starCount | uint32 flags | uint32 reserved
  positions:      Float32 ×3 per star, parsecs, RELATIVE TO CHUNK CENTER  (12 B/star)
  color+size:     uint8 r,g,b + uint8 sizeHint                            (4 B/star)
  magnitude:      Float16 apparent G mag (binary16)                       (2 B/star)
  ── total: 18 B/star  → round to 16 B/star by dropping sizeHint and
     palette-encoding color (uint8 index into a 256-color blackbody LUT
     shipped in index.json):  12 + 1 + 2 + 1(spare) = 16 B/star
```

- `Float16Array` is Baseline-available in all evergreen browsers since
  April 2025 (Chrome/Edge 135, Firefox 129, Safari 18.2) —
  https://caniuse.com/mdn-javascript_builtins_float16array — and Three.js
  shaders read `half float` vertex attributes natively; a JS decode fallback
  is ~5 lines if older browsers matter.
- Chunk-relative Float32 positions double as the floating-origin fix.
- `index.json` sidecar: per chunk → id, URL, star count, center (float64),
  bounding radius, min/max magnitude, byte offsets. Plus the 256×3 color LUT.

### Chunking: octree over distance shells

Octree (Gaia Sky-style), root centered on the Sun, ~64 k stars per leaf,
**stars assigned to levels by apparent magnitude** (brightest at the root):
- Camera at the Sun: load root + level-1 ≈ the naked-eye + binocular sky.
- Flythrough: load deeper nodes around the camera; distant unloaded leaves
  are visually covered by the bright low-level stars already resident.
- Distance shells (concentric) are simpler but break down the moment the
  camera leaves the origin — fine for a "sky from Earth" app, wrong for a
  flythrough. **Choose octree.** (A two-tier compromise — one "bright all-sky"
  chunk + a flat 3D grid — is acceptable if octree feels heavy.)

### Size arithmetic (exact bytes; compression ratios estimated)

| Stars | 18 B/star | 16 B/star | 8 B/star quantized* |
|---|---|---|---|
| 1.0 M (≈ G<11.5 cut) | 18.0 MB | 16.0 MB | 8.0 MB |
| 1.94 M (verified count) | 34.9 MB | 31.0 MB | 15.5 MB |
| 4.68 M (verified count) | 84.3 MB | 74.9 MB | 37.5 MB |
| 5.0 M | 90.0 MB | 80.0 MB | 40.0 MB |

\* quantized variant: uint16 position ×3 normalized to chunk AABB (6 B,
≈0.0015 % of chunk extent — sub-milliparsec for ≤50 pc leaves), uint8 palette
color (1 B), uint8 quantized magnitude (1 B; mag = 1.5 + idx×0.05 covers
1.5–14.25). Decode to Float32 once at load, or in the vertex shader.

- Gzip/Brotli on Float32 XYZ saves little (~10–25 %, random mantissa bits);
  on the quantized variant expect ~30–50 %. (Ratios UNVERIFIED — measure.)
- Practical call: at ≤5 M stars even the unquantized format is < 90 MB total
  and only the visible subset streams in. Start with 16 B/star Float32
  (simple, lossless), keep the quantized variant as a backlog optimization.

---

## 12. Decisions recommended

1. **Acquisition**: single async TAP job on a registered (free) ESA archive
   account; query of §5 joining `gaiadr3.gaia_source` ×
   `external.gaiaedr3_distance`; CSV gzip output. Do NOT use the CDN bulk
   files for ≤5 M stars.
2. **Cuts**: ship two builds — "lite" `G < 11.5 ∧ plx/err > 5` (1.94 M,
   ~31 MB) and "full" `G < 12.5 ∧ plx/err > 5` (4.68 M, ~75 MB). Add
   `ruwe < 1.4`. Counts above are live-verified.
3. **Distance**: `COALESCE(r_med_photogeo, r_med_geo)` from Bailer-Jones;
   never 1000/parallax; skip zero-point correction (document why).
4. **Bright end**: merge ATHYG v3.3 (CC BY-SA 4.0) stars with `mag < 4` (or
   missing-from-Gaia HIP stars) and use ATHYG `proper`/Bayer names for UI
   labels; dedupe on Gaia source_id.
5. **Color**: `teff_gspphot` when present, else Ballesteros(bp_rp); Teff →
   256-entry sRGB LUT from Charity's blackbody table; store palette index.
6. **Geometry**: ICRS axes as world axes, parsec units, fixed ICRS→Y-up
   rotation shared with the HiPS sphere; epoch 2016.0, ignore proper motion.
7. **Format**: SoA binary chunks, 16 B/star (Float32 rel-pos + uint8 palette
   color + Float16 G-mag), octree chunking ~64 k stars/leaf,
   magnitude-stratified LOD, `index.json` manifest; serve static with
   `content-encoding: br` and immutable cache headers.
8. **Tooling**: Python 3.12+, astroquery + astropy + numpy (+ DuckDB only if
   the CDN route is ever needed); pipeline as a repeatable script
   (`make catalog`), inputs/outputs checksummed — it must be re-runnable for
   Gaia DR4 (release date 2 December 2026, verified:
   https://www.cosmos.esa.int/web/gaia/data-release-4).

## 13. Open questions

1. Exact row count after adding `ruwe < 1.4` to the G<12.5 cut (run the
   COUNT query; expect a few % reduction — UNVERIFIED).
2. Fraction of the selected sample with NULL `bp_rp` / NULL `teff_gspphot` /
   NULL `r_med_photogeo` (decide fallback ordering with real numbers).
3. Redistribution license for derived Gaia chunks: confirm the
   "ESA/Gaia/DPAC, CC BY-SA 3.0 IGO" attribution requirement and whether
   CC BY-SA contaminates the app's own data bundle; same question for mixing
   ATHYG (CC BY-SA 4.0) rows into the binary chunks.
4. Whether to also store per-star `source_id` (8 B/star — +50 % size) in
   chunks for click-to-identify, vs. resolving clicks via a server-side or
   TAP cone search on (ra,dec) — leaning cone-search, but VR gaze-picking
   latency needs testing.
5. Real Brotli ratios on the chosen binary layout (measure, don't assume).
6. Gaia DR4 (2026-12-02) will supersede DR3 with ~2 B sources and new
   astrometry — source_ids and BJ-equivalent distance products will change;
   keep the pipeline parameterized by release. Will a DR4 Bailer-Jones-style
   distance catalog appear, and when?
7. Async job wall-clock time for the 4.7 M-row join (verify it fits well
   inside the 120-min cap; split by hemisphere if not).
8. Saturation/missing-star behavior for G ≲ 3 in DR3 — verify the exact list
   of bright stars needing the ATHYG patch.
