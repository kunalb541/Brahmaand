# PHASE 4 — Gaia DR3 offline catalog pipeline — execution runbook

```yaml
phase: 4
milestone: M4
deliverable: A reproducible Python pipeline (tools/pipeline/) that turns Gaia DR3 into the same
             GSC1 binary chunks + manifest.json that PHASE-3 already consumes — replacing the
             day-1 ATHYG data with 1.9M (lite) / 4.7M (full) real stars at Bailer-Jones distances,
             patched at the bright end with ATHYG, validated, and uploaded to static hosting.
depends_on: PHASE-3 (defines/uses the GSC1 format + manifest schema this pipeline must emit; the
                     runtime is already built and tested against that contract — this phase only
                     changes the DATA the runtime points at)
note: This is OFFLINE work. It depends on PHASE-3 only for the format contract, NOT for code, and
      could be developed in parallel with PHASE-1/2/3 by a second person. It is sequenced after
      PHASE-3 so the runtime exists to consume and validate its output immediately.
feeds: PHASE-8 (catalog hosting on R2 + cache headers), the whole app's "real distances" pillar
design_docs: docs/04-star-catalog-pipeline.md  ← PART A (Offline pipeline) IS THIS PHASE. Read it
             fully. Every step cites the §A-N it realizes. §A8/§A9 (format) must match PHASE-3 and
             the day-1 ATHYG script byte-for-byte.
research: docs/research/gaia-pipeline.md (live-verified TAP endpoints, ADQL, counts, table names,
          quotas — queried 2026-06-11), docs/research/deploy-assets.md §4 (compression),
          docs/research/star-rendering.md (octree rationale)
est_effort: 3–5 sessions
risk: LOW–MEDIUM — the 4.7M-row async job wall-clock vs the 120-min cap (VERIFY, hemisphere-split
      fallback scripted) and NULL-fraction fallback ordering (VERIFY) are the open items.
```

> **One-command reproducibility is the bar (doc 04 §C.1):** `make catalog PRESET=full` (with
> credentials) must regenerate everything from a clean machine to byte-stable chunks. Every script
> takes `--release gaiadr3` so the same pipeline rebuilds for **Gaia DR4 (2026-12-02)** later
> (table names live in `config.py`).

> **The format is already frozen by PHASE-3.** Do not redesign the chunk/manifest format here. The
> runtime (`src/stars/chunkParser.ts`, `manifest.ts`) and `tools/athyg-daydata` already implement
> doc 04 §A8/§A9. This pipeline's job is to emit *the same bytes* from a better data source. Run
> PHASE-3's parser against this phase's output as the cross-check (step 6).

---

## Step group 0 — Environment + skeleton

Realizes doc 04 §A1.

```bash
cd /Users/kunalbhatia/Downloads/vr-astronomy-app
mkdir -p tools/pipeline/{tests/fixtures,data/{raw,stage,out}}
cd tools/pipeline
python3.12 -m venv .venv && . .venv/bin/activate      # Python 3.12+ required (doc 04 §A1)
```

`tools/pipeline/requirements.txt` (pin exact at install; minima from doc 04 §A1):

```text
astroquery>=0.4.7
astropy>=6.0
numpy>=1.26
pandas>=2.2
pyarrow>=15
```

```bash
pip install -r requirements.txt && pip freeze > requirements.lock.txt
```

Create the file skeleton exactly as doc 04 §A1 (`config.py`, `01_fetch_gaia.py` …
`05_compress_upload.py`, `palette.py`, `tests/`). `config.py` holds: the two ADQL query strings
(`QUERIES['lite'|'full']` from doc 04 §A2), preset cuts, paths, `RELEASE='gaiadr3'`, and the table
names (`gaiadr3.gaia_source`, `external.gaiaedr3_distance`) so DR4 is a config change.

---

## Step group 1 — Register + count-check (do this FIRST, it's free)

Realizes doc 04 §A2.

### 1.1 ESA account

`full` (4.68M rows) **requires** a free registered account (anonymous async cap = 3M rows);
`lite` (1.94M) runs anonymously (doc 04 §A2 quota table). Register at
https://www.cosmos.esa.int/web/gaia-users/register. Put credentials in env (`GAIA_USER`/`GAIA_PASS`),
never in the repo.

### 1.2 Run the COUNT (sync endpoint, seconds)

Run the count query from doc 04 §A2 against `https://gea.esac.esa.int/tap-server/tap/sync`. Record
the number — it goes in the manifest's `build.sourceRowCount` and resolves VERIFY D#1 (expected
slightly under 4,683,166 after `ruwe < 1.4`).

> **Browser note (doc 04 §A2):** the ESA Gaia archive has **no CORS** — it is build-time only. The
> runtime never calls it (live object lookups go through VizieR/SIMBAD in PHASE-5).

---

## Step group 2 — Fetch (`01_fetch_gaia.py`)

Realizes doc 04 §A2. Copy the `fetch()` astroquery function **verbatim from doc 04 §A2** (note
`Gaia.ROW_LIMIT = -1` — the default is 50!). Production ADQL = the joined query in doc 04 §A2
(`gaiadr3.gaia_source` × `external.gaiaedr3_distance USING (source_id)`, cuts
`phot_g_mean_mag < {11.5|12.5}`, `parallax_over_error > 5`, `ruwe < 1.4`).

> **Verified gotcha (doc 04 §A2):** the Bailer-Jones table is **`external.gaiaedr3_distance`**, NOT
> `gaiadr3.gaiadr3_distance` (which does not exist). EDR3 source_ids == DR3 source_ids, so the
> `USING (source_id)` join is correct.

Failure handling (doc 04 §A2): phase `ERROR` → fetch `<job>/error`, log, abort (no silent retry);
wall-clock > 110 min → abort and re-submit as **two hemisphere jobs** (`dec >= 0` / `dec < 0`) then
concatenate (resolves VERIFY D#6); network drop on download → re-download from the persisted job URL
(results live ~3 days anon / indefinitely registered), do not re-run the query. Output:
`data/raw/gaia_{preset}.csv.gz`.

---

## Step group 3 — Build catalog: clean + patch + color + XYZ (`03_build_catalog.py`)

Realizes doc 04 §A3 (cleaning), §A4 (ATHYG patch), §A5 (color), §A6 (XYZ).

### 3.1 Cleaning (doc 04 §A3) — apply in exact order, log rows-dropped per rule

1. Assert the CSV respects the ADQL cuts (don't re-apply).
2. **Distance:** `d_pc = r_med_photogeo if not NULL else r_med_geo` (parsecs). **Never** `1000/parallax`.
3. Drop NULL/non-finite/`≤0` distances (assert < 0.01%).
4. Parallax zero-point correction **deliberately skipped** (doc 04 §A3.4) — document in the README.
5. NULL color handling per §A5 ordering; **log NULL fractions** of `bp_rp`, `teff_gspphot`,
   `r_med_photogeo` (resolves VERIFY D#2).
6. Dedup: assert `source_id` unique; dedup ATHYG against Gaia by `gaia` id, then positional
   (1″ + |Δmag|<1) for ATHYG rows lacking a Gaia id (doc 04 §A3.6).
7. Magnitude sanity: clamp `phot_g_mean_mag` to [−2, 22]; drop non-finite.

### 3.2 ATHYG bright-star patch (doc 04 §A4)

Reuse the **same ATHYG acquisition** as PHASE-3's `tools/athyg-daydata` (don't re-download — point
at the same `data/`). Take ATHYG stars with `mag < 4.0` OR (`hip` present AND `gaia` empty), dedup
per §A3.6, convert `ci`→Teff (unmodified Ballesteros), set flag bit 0 (ATHYG-patched). Harvest
`proper` names → `names.json` sidecar. Confirm ATHYG `x,y,z` convention against its README or
recompute from `ra/dec/dist` via §A6 (recommended for uniformity — resolves VERIFY in §A4).

### 3.3 Color → palette index (doc 04 §A5)

Implement `palette.py` exactly per doc 04 §A5: 256 entries, log-spaced Teff 1500–40000 K, Teff→sRGB
via Mitchell Charity table **or** the inlined Tanner Helland fit (ship the fit so the pipeline has
zero fragile downloads — copy `kelvin_to_srgb255` verbatim from §A5), then sRGB→linear, desaturate
40% toward white, normalize max channel, quantize uint8. The palette ships **linear-light** in the
manifest; the shader does **no** sRGB decode (doc 04 §A5.5). **This palette must match
`tools/athyg-daydata`'s** — factor it into one source of truth if practical (e.g. a generated
`palette.json` both consume).

### 3.4 XYZ (doc 04 §A6)

`x=d·cosδ·cosα, y=d·cosδ·sinα, z=d·sinδ` in float64 (or astropy `SkyCoord(...).cartesian`), **ICRS
axes, pre-swizzle** (the runtime swizzles). Compute and store **absolute** mag `M = m − 5(log10 d −
1)`. Output: `data/stage/catalog.parquet` with `source_id, ra, dec, d_pc, g_mag, teff_k, M, name`.

---

## Step group 4 — Chunking: magnitude-stratified octree (`04_build_chunks.py`)

Realizes doc 04 §A7 (algorithm), §A8 (byte format), §A9 (manifest).

### 4.1 Octree build

Copy the build algorithm **verbatim from doc 04 §A7**: `CAPACITY=65536`, `MAX_DEPTH=12`, root cube =
smallest power-of-two ≥ max|coord|, sort all stars ascending by apparent G (brightest first), insert
top-down (magnitude order → automatic stratification), optional small-leaf merge. Set bright-impostor
flag bit 1 for `M < −1.0` (doc 04 §A7; VERIFY D#10 threshold on first visual test). Record per-node
`boundingRadius`, app/abs mag ranges, count.

### 4.2 Binary writer (doc 04 §A8)

Emit each node as `GSC1`: 16-byte header (magic `GSC1`, version 1, chunkFlags bit0=1, `starCount`,
reserved) + SoA blocks (f32 chunk-relative xyz, f16 absMag, u8 colorIdx, u8 starFlags) =
**16 B/star**. Positions are **chunk-relative** (subtract the f64 node center, computed in f64
offline). Little-endian. This is the exact format PHASE-3's parser reads.

### 4.3 Manifest (doc 04 §A9)

Write `manifest.json` per the §A9 schema: `release:"gaiadr3"`, `axisMapping:"three.xyz = icrs.yzx"`,
the linear `palette`, `attribution` (the three required strings — ESA/Gaia/DPAC CC BY-SA 3.0 IGO;
Bailer-Jones 2021; ATHYG CC BY-SA 4.0), `build` block (date, pipelineVersion via `git describe`,
exact ADQL, `sourceRowCount` from step 1.2), and the `chunks[]` array (id, level, parent, children,
content-hashed url, byteLength, sha256, starCount, center f64, halfSize, boundingRadius, mag ranges).

---

## Step group 5 — Compress + upload (`05_compress_upload.py`)

Realizes doc 04 §A10. gzip -9 each chunk → `c{id:04}_{sha256[:8]}.bin.gz`, `Content-Type:
application/octet-stream`, `Cache-Control: public, max-age=31536000, immutable`. **Measure and
record actual gzip ratios** in the pipeline README (resolves VERIFY D#5 — expect only ~10–25% on
f32 mantissas). Upload to Cloudflare R2 via `wrangler r2 object put` (PHASE-8 owns the bucket/custom
domain; for local dev just serve `data/out/<version>/` statically). Manifest served `no-cache`
(chunks are immutable + content-hashed).

---

## Step group 6 — Validation + runtime swap

Realizes doc 04 §A11 (pipeline gates) + the cross-check against PHASE-3's runtime.

### 6.1 `tests/test_roundtrip.py` (doc 04 §A11) — must pass before any upload

1. Round-trip: decode 3 random chunks with an independent Python reader; positions match staging to
   f32 ULP, absMag to f16 ULP, palette indices exact.
2. Census: `sum(chunk.starCount) == manifest.starCount == staging rows`.
3. Stratification: root `appMag[1] ≤ 8.0` (full preset).
4. Landmarks: Sirius, Vega, Pleiades centroid within 0.05° of J2016 positions; **Sirius carries flag
   bit 0** (ATHYG-patched — it's saturated in Gaia).
5. Determinism: re-running `04_build_chunks.py` on the same staging file → byte-identical chunks
   (stable sort, `source_id` tiebreaker).

### 6.2 Cross-check against PHASE-3's parser

Point the runtime at the new `manifest.json` (swap `public/catalogs/gaiadr3/` for the ATHYG path).
Run PHASE-3's `chunkParser` test against a Gaia chunk. **The runtime must render with zero code
change** — same magic, version, layout, axis mapping. This is the proof that PHASE-4 is a pure data
swap.

### 6.3 Sanity plots (commit them — doc 04 ROADMAP M2 deliverable)

`tools/pipeline/plots.py`: HR diagram (absMag vs bp_rp), sky-density map (Aitoff of ra/dec),
distance histogram. These catch unit/axis bugs before any rendering. Commit to
`tools/pipeline/plots/`.

### 6.4 Makefile

`make catalog PRESET=lite|full` and `make catalog SOURCE=athyg-mag10` (the day-1 path, doc 04 §C.2)
chain steps 2→5 with one command.

---

## Acceptance tests (phase exit — mirror doc 04 §C pipeline gates)

| # | Action | Expected |
|---|---|---|
| 1 | `make catalog PRESET=lite` (anonymous) | Produces `data/out/<v>/manifest.json` + chunks passing all §A11 gates; lite ≤ 35 MB raw. |
| 2 | `make catalog PRESET=full` (with `GAIA_USER`/`GAIA_PASS`) | Same, ~4.6M stars, ≤ 80 MB raw; manifest validates against the §A9 schema. |
| 3 | `make catalog SOURCE=athyg-mag10` | Works with **no** ESA account / no Gaia download (day-1 path still builds). |
| 4 | `pytest tests/` | Round-trip, census, stratification, landmark (Sirius flag), determinism all green. |
| 5 | Swap runtime to Gaia chunks | PHASE-3 flythrough renders **1M+ stars at 60 fps**, no code change; bright stars still coincide with HiPS imagery < 0.1° (frame consistency holds). |
| 6 | README records | Post-`ruwe` row count, NULL fractions (bp_rp/teff_gspphot/r_med_photogeo), measured gzip ratios (resolves VERIFY D#1, D#2, D#5). |
| 7 | Re-run `04_build_chunks.py` | Byte-identical output (determinism). |
| 8 | Sanity plots committed | HR diagram looks like a main sequence + giant branch; sky map shows the galactic plane overdensity; distance histogram sane. |

## Exit state

The "real distances" pillar is real: a one-command, reproducible, DR4-ready pipeline emitting the
exact GSC1 format the runtime already consumes, validated end-to-end and cross-checked against
PHASE-3. The app now flies through millions of actual Gaia stars at Bailer-Jones distances.

## VERIFY ledger carried out of this phase (track in docs/DECISIONS.md)

1. D#1 post-`ruwe` `full` row count — recorded in manifest (step 1.2).
2. D#2 NULL fractions — logged in `03_build_catalog.py` (step 3.1.5); revisit color fallback order if `teff_gspphot` coverage poor.
3. D#3 Gaia (CC BY-SA 3.0 IGO) + ATHYG (CC BY-SA 4.0) ShareAlike on the mixed bundle — display both; publish chunks under CC BY-SA; legal read before any commercial use (also a PHASE-8/M8 gate).
4. D#5 measured gzip/brotli ratios — recorded in step 5.
5. D#6 4.7M async job wall-time vs 120-min cap — timed; hemisphere split scripted (step 2).
6. D#7 exact bright stars (G≲3) needing ATHYG patch — diff on first `full` run (step 3.2).
7. D#8 Gaia DR4 (2026-12-02): new source_ids, BJ-distance successor unknown — pipeline `--release` parameterized; re-research when DR4 lands.
