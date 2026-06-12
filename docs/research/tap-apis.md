# Research: Query/Data APIs callable directly from a browser astronomy app

```yaml
topic: TAP / cone-search / name-resolver / cutout APIs — endpoints, formats, CORS, limits
date: 2026-06-11
author: research agent (Claude)
method: live curl probes with Origin header (verifies real CORS behavior, not docs),
        plus WebSearch/WebFetch of official documentation
confidence:
  CORS findings: HIGH — every "CORS yes/no" below was verified 2026-06-11 by sending
    "Origin: https://example.com" and inspecting Access-Control-Allow-Origin in the
    actual HTTP response. Headers can change; re-verify before launch.
  rate limits: MEDIUM — CDS limits come from official docs/FAQ; not all are machine-enforced
    numbers. ESA Gaia quotas partially undocumented.
  npm ecosystem: MEDIUM — registry search is point-in-time.
```

---

## 0. Executive summary (the one-table version)

| Service | Endpoint (verified) | CORS `*`? | Formats | Auth | Verdict for static web app |
|---|---|---|---|---|---|
| SIMBAD TAP | `https://simbad.cds.unistra.fr/simbad/sim-tap/sync` | **YES** (verified) | votable, json, csv, tsv, text | none | Use directly |
| SIMBAD cone (REST) | `https://simbad.cds.unistra.fr/cone` | **YES** (verified) | votable, **json** | none | Use directly — best for gaze/click lookup |
| SIMBAD legacy sim-id/sim-coo | `https://simbad.cds.unistra.fr/simbad/sim-id` | **YES** (verified) | votable, ascii (json buggy — see §2.3) | none | Avoid; prefer TAP / cone |
| VizieR TAP | `https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync` | **YES** (verified) | votable, json, csv, tsv | none | Use directly; also the CORS-safe path to Gaia DR3 (`I/355/gaiadr3`) |
| Sesame resolver | `https://cds.unistra.fr/cgi-bin/nph-sesame` | **YES** (verified) | XML, plain text | none | Use directly. **`sesame.unistra.fr` does not resolve in DNS** (verified) |
| ESA Gaia TAP | `https://gea.esac.esa.int/tap-server/tap/sync` | **NO** (verified) | votable, json, csv, fits | none for queries | **Blocked in browser.** Use VizieR's Gaia DR3 copy, or a tiny proxy (§5) |
| hips2fits | `https://alasky.cds.unistra.fr/hips-image-services/hips2fits` | **YES** (verified) | fits, jpg, png | none | Use directly. Note the path: bare `/hips2fits` returns 404 (verified) |
| MOCServer | `https://alasky.cds.unistra.fr/MocServer/query` | **YES** (verified, incl. `Access-Control-Allow-Methods: GET, OPTIONS`) | json, ascii | none | Use directly for survey discovery |

Bottom line: **everything CDS-hosted is fully CORS-open; the only blocked service is ESA's Gaia archive**, and it has a clean workaround (VizieR hosts Gaia DR3) so **no backend/proxy is strictly required** for any core feature of this app.

---

## 1. SIMBAD TAP — VERIFIED

- **Base TAP URL:** `https://simbad.cds.unistra.fr/simbad/sim-tap` (sync: `…/sim-tap/sync`, async: `…/sim-tap/async`). The legacy host `https://simbad.u-strasbg.fr/simbad/sim-tap/sync` also still answers 200 with `Access-Control-Allow-Origin: *` (verified live, no redirect) — but use the `cds.unistra.fr` name going forward; `u-strasbg.fr` names are being phased out.
- **CORS:** `Access-Control-Allow-Origin: *` present on sync responses (verified 2026-06-11 with foreign Origin).
- **Request format:** standard IVOA TAP. GET or POST `application/x-www-form-urlencoded` with `REQUEST=doQuery&LANG=ADQL&FORMAT=<fmt>&QUERY=<adql>`. POST is preferred for long ADQL (avoids URL-length issues and keeps queries out of proxy logs).
- **Response formats (verified live):** `FORMAT=json` → `application/json` with shape `{"metadata":[{name,description,datatype,unit,ucd,utype},…],"data":[[row],…]}` (column-oriented metadata + row arrays — trivially consumable, **no VOTable parser needed**). `FORMAT=csv` verified working. `votable`, `tsv`, `text` also supported.
- **Limits (verified from `…/sim-tap/capabilities`):** sync/async output limit **default 50,000 rows, hard 2,000,000**; execution duration default 1080 s, hard 3600 s; table upload limit default 200,000 rows.
- **Rate limit (from CDS/astroquery docs, MEDIUM confidence):** ~5–6 queries/second per IP; exceeding it can blacklist the IP for up to ~1 hour. Sources: [SIMBAD FAQ](https://cds.unistra.fr/help/faq/simbad/), [astroquery SIMBAD docs](https://astroquery.readthedocs.io/en/stable/simbad/simbad.html). Implication for the app: debounce gaze/click lookups, cache by (ra,dec,radius), never poll in a render loop.
- **Auth:** none.

### 1.1 ADQL example — cone search returning identifiers + object types + V magnitude (verified live, returns rows)

```sql
SELECT TOP 50
       basic.main_id, basic.ra, basic.dec, basic.otype,
       flux.flux AS V_mag
FROM basic
LEFT JOIN flux ON flux.oidref = basic.oid AND flux.filter = 'V'
WHERE CONTAINS(POINT('ICRS', ra, dec),
               CIRCLE('ICRS', 10.6847, 41.2687, 0.1)) = 1
```

POSTed as:

```js
const r = await fetch('https://simbad.cds.unistra.fr/simbad/sim-tap/sync', {
  method: 'POST',
  body: new URLSearchParams({
    REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql,
  }),
});
const { metadata, data } = await r.json();
```

Verified JSON sample (truncated): `{"metadata":[{"name":"main_id",…},{"name":"otype","ucd":"src.class",…}],"data":[["[MMD2006] 1235",10.7125,41.211,"PN?",23.65],…]}`

### 1.2 ADQL example — SIMBAD "basic data" for one object by name

```sql
SELECT b.main_id, b.ra, b.dec, b.otype, b.sp_type, b.rvz_radvel,
       b.plx_value, b.pmra, b.pmdec,
       f.filter, f.flux
FROM ident AS i
JOIN basic AS b ON b.oid = i.oidref
LEFT JOIN flux AS f ON f.oidref = b.oid
WHERE i.id = 'M  31'
```

Caveat: the `ident.id` column requires SIMBAD's canonical spacing (`'M  31'` has two spaces). Easier and more robust for free-text names: resolve via Sesame (§4) or query `WHERE id = 'M31'` against `ident` — SIMBAD normalizes most common forms; test both. Other useful tables: `otypedef` (object-type labels), `allfluxes` (one row per object, one column per filter: `V`, `B`, `G`, `J`…) — `SELECT V, G FROM allfluxes JOIN ident USING(oidref) WHERE id='M31'` is the cheapest magnitude lookup.

---

## 2. SIMBAD REST endpoints (newer + legacy) — VERIFIED

### 2.1 `https://simbad.cds.unistra.fr/cone` — the modern REST cone search (RECOMMENDED)

- **CORS:** `access-control-allow-origin: *` and `access-control-allow-credentials: false` (verified).
- **Params:** `RA`, `DEC` (deg, ICRS), `SR` (radius deg), `MAXREC`, `ORDER_BY` (default `distance`), `ORDER_DIR`, `VERB` (1–3), `RESPONSEFORMAT` (`json` or VOTable; default is VOTable 1.4 TABLEDATA).
- **Verified example:**
  `https://simbad.cds.unistra.fr/cone?RA=10.6847&DEC=41.2687&SR=0.02&MAXREC=2&RESPONSEFORMAT=json`
  returns `application/json`:
  `{"request_parameters":{…},"data_origin":{…},"columns":[{"name":"distance","unit":"deg",…},…],"data":[…]}` — includes distance-from-target sorting, which is exactly what a gaze/click "what am I looking at" feature needs (take row 0).
- This is an IVOA Simple Cone Search service (`standardID ivo://ivoa.net/std/conesearch`, server software "SIMBAD-ConeSearch/2.7"). It is the lowest-effort SIMBAD integration: one GET, JSON out, CORS open.

### 2.2 Documented URL-query endpoints (source: [sim-url guide](https://simbad.u-strasbg.fr/Pages/guide/sim-url.htx))

`sim-id` (by identifier), `sim-coo` (by coordinates), `sim-ref` (bibliography), `sim-sam` (criteria), `sim-script` (script language), all under `https://simbad.cds.unistra.fr/simbad/`. All share `output.format=` (HTML|VOTable|ASCII) and `output.max=`.

### 2.3 Gotcha — VERIFIED bug

`sim-id?Ident=M31&output.format=json` returned **HTTP 200 with a Java `NullPointerException` in a text/plain body** (verified 2026-06-11). JSON on the legacy sim-* scripts is unreliable. CORS itself was fine (`Access-Control-Allow-Origin: *`, and `output.format=VOTable` works). **Decision: do not build on sim-id/sim-coo; use `/cone` + TAP.**

---

## 3. VizieR TAP — VERIFIED

- **Endpoint:** `https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync` (and `/async`).
- **CORS:** `access-control-allow-origin: *` (verified).
- **Formats:** same TAP parameter style as SIMBAD; `FORMAT=json` verified, same `{metadata,data}` JSON shape.
- **Limits (verified from `…/tap/capabilities`):** output limit default 1e9 rows (effectively unbounded), upload limit 100,000 rows, async retention default 2 days.
- **Auth:** none. Rate limiting: same CDS-wide ~6 req/s etiquette applies (shared infrastructure).
- **ADQL quirk:** VizieR table names contain `/`, so they must be double-quoted: `FROM "I/355/gaiadr3"`.

### 3.1 VizieR as the CORS-safe Gaia DR3 endpoint (verified live, returns real rows)

```sql
SELECT TOP 1000 Source, RA_ICRS, DE_ICRS, Gmag, BPmag, RPmag, Plx, pmRA, pmDE, RV
FROM "I/355/gaiadr3"
WHERE 1 = CONTAINS(POINT('ICRS', RA_ICRS, DE_ICRS),
                   CIRCLE('ICRS', 10.6847, 41.2687, 0.05))
```

Verified response columns map 1:1 to ESA names (`Source`→`source_id`, `RA_ICRS`→`ra` at Ep=2016.0, `Plx`→`parallax`, `Gmag`→`phot_g_mean_mag`). Also available: `"I/355/paramp"` (astrophysical parameters). This is the recommended browser path to live Gaia data.

---

## 4. Sesame name resolver — VERIFIED (with a DNS surprise)

- **`sesame.unistra.fr` does NOT resolve** (`curl: (6) Could not resolve host`, verified 2026-06-11). Neither do `sesame.u-strasbg.fr` nor `sesame.cds.unistra.fr`. The hostname in older docs is dead — do not put it in the blueprint.
- **Working endpoint:** `https://cds.unistra.fr/cgi-bin/nph-sesame` — HTTP 200 with `Access-Control-Allow-Origin: *` (verified). (`https://vizier.cds.unistra.fr/cgi-bin/nph-sesame` 302-redirects; avoid, since redirects + CORS are fragile.)
- **Request format:** `https://cds.unistra.fr/cgi-bin/nph-sesame/-o<flags>/<DB>?<name>` where `<DB>` ⊆ `S` (SIMBAD), `N` (NED), `V` (VizieR), `A` (all), and flags include `x` = XML output, `p` = plain text, `I` = list all identifiers.
- **Verified example:** `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?M31` returns XML with `<jradeg>10.68470833</jradeg><jdedeg>41.26875</jdedeg>`, `<otype>AGN</otype>`, `<MType>SA(s)b</MType>`, velocity, etc.
- **Response parsing in JS:** no JSON mode exists; parse the XML with the built-in `DOMParser` (~10 lines: grab first `<Resolver>`, read `jradeg`/`jdedeg`/`oname`/`otype`). Plain-text mode (`-op`) is even simpler to regex if only coordinates are needed.
- **Caching note:** Sesame responses include `<INFO>from cache</INFO>`; it is designed for name→coordinate lookup bursts, but apply the same ≤6 req/s etiquette.

---

## 5. ESA Gaia archive TAP — VERIFIED: **NOT browser-callable**

- **Endpoint:** `https://gea.esac.esa.int/tap-server/tap/sync` (TAP+; sync + async; anonymous queries allowed; login only needed for persistent jobs/uploads). Source: [Gaia programmatic access](https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access).
- **Formats:** `FORMAT=votable|votable_plain|json|csv|fits` (docs + verified json works via curl).
- **CORS — verified 2026-06-11, three probes:**
  1. GET sync query with `Origin: https://example.com` → 200 OK, **no `Access-Control-Allow-Origin` header at all** → browser would receive the bytes but JS is forbidden from reading them.
  2. OPTIONS preflight (`Origin: https://example.com`, `Access-Control-Request-Method: POST`) → **HTTP 403** with `Vary: Origin,Access-Control-Request-Method,Access-Control-Request-Headers` → a CORS filter exists server-side but operates on a whitelist that excludes arbitrary origins.
  3. Same preflight with `Origin: http://localhost:5173` → **403** as well. Localhost is not whitelisted.
- **Mirrors checked (verified):** ARI Heidelberg `https://gaia.ari.uni-heidelberg.de/tap/sync` → 200, **no CORS header**. NOIRLab Data Lab `https://datalab.noirlab.edu/tap/sync` → 200 (hosts `gaia_dr3.gaia_source`), **no CORS header**. AIP `https://gaia.aip.de/tap/sync` → 400 on the probe (different schema/validation; CORS undetermined). None of these rescue the browser path.
- **Workarounds, in recommended order:**
  1. **Use VizieR TAP** (`"I/355/gaiadr3"`, §3.1) — full Gaia DR3 source table, CDS-hosted, CORS `*`. Covers every "live Gaia lookup" need of this app.
  2. **Offline preprocessing is unaffected** — the Gaia→binary-chunk pipeline runs server-side/at-build-time (Python `astroquery.gaia`, or direct bulk downloads from `https://cdn.gea.esac.esa.int/Gaia/gdr3/`), where CORS is irrelevant.
  3. If live ESA-archive access ever becomes mandatory (e.g., DR4-only columns before VizieR ingests them): **a tiny serverless proxy is required — say so explicitly in the blueprint.** ~15 lines on a Cloudflare Worker: forward method/body/query to `gea.esac.esa.int`, return response with `Access-Control-Allow-Origin: *`. There is **no official JSONP and no CDS-hosted proxy for ESA's archive**.

---

## 6. hips2fits (image cutouts of any HiPS) — VERIFIED

- **Endpoints (both verified `access-control-allow-origin: *`, plus `access-control-allow-methods: GET, OPTIONS`):**
  - `https://alasky.cds.unistra.fr/hips-image-services/hips2fits`
  - mirror: `https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits`
  - **Gotcha (verified):** `https://alasky.cds.unistra.fr/hips2fits` (without `/hips-image-services/`) is a **404**.
- **Parameters** (source: service doc page, fetched 2026-06-11):
  - `hips` (required): HiPS ID, e.g. `CDS/P/DSS2/color`, `CDS/P/PanSTARRS/DR1/color-z-zg-g`, `CDS/P/SDSS9/color`.
  - `width`, `height` (required, px): product capped at **50 megapixels**.
  - Geometry either as `ra`+`dec`+`fov`(deg)+`projection` (TAN, SIN, AIT, MOL, MER, … all common FITS WCS codes) — or a full `wcs` JSON dict (mutually exclusive with the simple params).
  - `object`: free-text name resolved via Sesame server-side (alternative to ra/dec).
  - `coordsys` (`icrs`|`galactic`, default icrs), `rotation_angle` (deg, default 0).
  - `format`: `fits` (default) | `jpg` | `png`.
  - jpg/png rendering controls: `min_cut`/`max_cut` (percentiles, defaults 0.5%/99.5%), `stretch` (`linear`|`sqrt`|`log`|`asinh`|`power`), `cmap` (any matplotlib colormap).
- **Verified example (returns image/jpeg, 200, CORS `*`):**
  `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&width=512&height=512&fov=1.0&projection=TAN&coordsys=icrs&ra=10.68&dec=41.27&format=jpg`
- **Usage in app:** because CORS is open, the cutout can be loaded with `fetch` → `createImageBitmap` → Three.js `CanvasTexture`, or directly via `new THREE.TextureLoader().load(url)` with `crossOrigin='anonymous'` (CORS-clean textures stay WebGL-readable). Ideal for the object-info panel ("postage stamp" of the clicked object).
- **Rate limits:** none documented. Cutout generation is CPU-bound server-side — keep requests user-triggered, not per-frame; use the `alaskybis` mirror as failover.
- **Auth:** none. There is also a POST mode for `wcs` dicts.

---

## 7. CDS MOCServer (survey discovery) — VERIFIED

- **Endpoint:** `https://alasky.cds.unistra.fr/MocServer/query` (the `alasky.unistra.fr` alias also exists). v5.10, June 2024; indexes ~41,000 datasets (from the service's own landing page, fetched 2026-06-11).
- **CORS:** `access-control-allow-origin: *`, `access-control-allow-methods: GET, OPTIONS`, `access-control-allow-headers: *` (verified — the most complete CORS config of all services tested).
- **Request format (GET):**
  - Spatial: `RA=&DEC=&SR=` (deg, ICRS) or `stc=Polygon …` or an inline/remote MOC.
  - Property filters: `expr=` with `key=value` wildcards, e.g. `expr=dataproduct_type=image&&hips_service_url=*` (all HiPS image surveys), `expr=ID=*Rubin*` (watch for Rubin/LSST HiPS appearing!).
  - Output: `get=id` (default) | `get=record`; `fmt=json|ascii`; `fields=ID,obs_title,hips_service_url,hips_order,hips_tile_format,hips_frame,obs_regime,em_min,em_max,moc_sky_fraction`.
- **Verified example:** `…/MocServer/query?expr=ID%3DCDS%2FP%2FDSS2%2Fcolor&get=record&fmt=json` returns a JSON array of records with `ID`, `obs_title`, `obs_description`, `obs_copyright`, `hips_service_url`, `hips_order`, `hips_tile_format`, `client_category`, etc. — everything needed to populate a runtime "choose your sky survey" menu instead of hardcoding HiPS URLs.
- **Killer query for this app** — "which image surveys cover the point the user is looking at":
  `…/MocServer/query?RA=10.68&DEC=41.27&SR=0.1&expr=dataproduct_type%3Dimage%26%26hips_service_url%3D*&get=record&fmt=json&fields=ID,obs_title,hips_service_url,hips_order,hips_tile_format`
- **Manual:** https://alasky.cds.unistra.fr/MocServerDoc/MocServerManual.pdf

---

## 8. VOTable parsing in JS

- **npm ecosystem is effectively empty (verified via registry search 2026-06-11):** the only relevant hit is [`jsvotable`](https://www.npmjs.com/package/jsvotable) 2.0.2 — last published 2019, **GPL-3.0** (license likely unacceptable for an MIT/Apache app), repo `github.com/malapert/JsVotable`. No maintained TypeScript VOTable parser exists on npm. Aladin Lite v3 has internal parsing but doesn't export it as a library.
- **Recommended strategy: avoid VOTable entirely.** Every service in this document can return JSON or CSV:
  - SIMBAD TAP / VizieR TAP: `FORMAT=json` (verified) — `{metadata,data}` arrays.
  - SIMBAD cone: `RESPONSEFORMAT=json` (verified).
  - MOCServer: `fmt=json` (verified).
  - Sesame: XML, but trivially handled by built-in `DOMParser`.
  - hips2fits: binary image, no table parsing at all.
- **If VOTable becomes unavoidable** (e.g., a third-party SCS service that only emits VOTable): the **TABLEDATA serialization is easy to hand-roll** (~80–120 lines): `DOMParser` → read `FIELD` elements (name/datatype/arraysize/unit/ucd) → iterate `TABLEDATA/TR/TD`, coerce by datatype. The **BINARY/BINARY2 serializations are substantially harder** (base64 stream + per-FIELD fixed/variable-length decode + BINARY2 null-mask) — do not attempt; request TABLEDATA via `RESPONSEFORMAT=votable/td` or fall back to CSV.

---

## 9. CORS workaround summary

- CDS (SIMBAD, VizieR, Sesame, hips2fits, MOCServer, and also alasky HiPS tiles themselves): **no workaround needed**, all `Access-Control-Allow-Origin: *` (verified).
- ESA Gaia archive: **no official JSONP, no official CORS allowlist process documented, no CDS-hosted proxy**. Workarounds: (a) VizieR's Gaia DR3 mirror — covers this app; (b) **a tiny serverless proxy is explicitly required** if direct ESA access is ever needed (Cloudflare Worker/Netlify Function, ~15 lines, must forward `Content-Type: application/x-www-form-urlencoded` POSTs and stream responses).
- Future alert brokers (Fink/ALeRCE/ANTARES) were out of scope here — **CORS status unverified**; budget for the same serverless-proxy fallback.

---

## 10. Decisions recommended

1. **Object lookup (gaze/click):** SIMBAD `/cone?RA&DEC&SR&RESPONSEFORMAT=json&MAXREC=5` as primary (distance-sorted JSON, CORS `*`); SIMBAD TAP `FORMAT=json` POST for richer joined data (fluxes via `allfluxes`, object-type labels via `otypedef`). Debounce to ≤2 req/s; LRU-cache results.
2. **Name search box:** Sesame at `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?<name>`, parsed with `DOMParser`. Hardcode this URL, not `sesame.unistra.fr` (dead DNS).
3. **Live Gaia queries from the browser:** VizieR TAP `"I/355/gaiadr3"` only. Treat ESA `gea.esac.esa.int` as server-side/build-time-only infrastructure (for the offline star-chunk pipeline).
4. **Cutout thumbnails:** hips2fits at the `/hips-image-services/hips2fits` path, `format=jpg`, ≤512×512 for UI panels; `alaskybis` mirror as failover.
5. **Survey catalog:** query MOCServer at runtime (or at build time, cached to a static JSON) instead of hardcoding HiPS base URLs; filter `dataproduct_type=image&&hips_service_url=*`.
6. **Data formats:** JSON everywhere; skip VOTable parsing entirely; do not adopt `jsvotable` (GPL-3.0, stale).
7. **No backend required for v1.** Reserve a serverless-proxy slot in the architecture for: ESA Gaia direct access (if ever needed) and alert brokers (CORS unverified).
8. **Etiquette layer:** one shared rate-limiter/queue module in front of all CDS calls (≤5 req/s aggregate), with response caching keyed on full URL.

## 11. Open questions

1. **ESA Gaia CORS whitelist:** the 403-with-`Vary: Origin` preflight implies a server-side origin whitelist exists. Is there a process to get an origin added (e.g., for a deployed app domain)? No public documentation found; would need to ask ESDC helpdesk. Until answered, assume "no".
2. **CDS rate limits are etiquette, not contract:** the ~5–6 req/s figure is from SIMBAD docs; per-service enforcement (hips2fits, MOCServer) is undocumented. A burst test before launch would establish real headroom — or just engineer to the documented number.
3. **SIMBAD `/cone` stability:** server software reports `SIMBAD-ConeSearch/2.7-SNAPSHOT` — a "-SNAPSHOT" version string suggests it is still evolving; field names in the JSON should be read defensively from `columns`, not hardcoded by index.
4. **Gaia DR4** (expected ~Dec 2026): VizieR ingestion lag after ESA release is unknown; if the app wants DR4 quickly, the serverless proxy to ESA may become relevant.
5. **Fink/ALeRCE/ANTARES CORS** for the later alert-stream layer: unverified in this pass; needs the same live-probe treatment.
6. **`hips2fits` `object=` parameter** chains a server-side Sesame resolution — error behavior for unresolvable names (HTTP code? JSON error?) was not probed.
7. **Legacy `sim-id` JSON NPE**: reported behavior as of 2026-06-11; worth a bug report to cds-question@unistra.fr, but the blueprint should simply not depend on it.
