# Rubin Observatory / LSST data access for unaffiliated app builders

```yaml
topic: Vera C. Rubin Observatory / LSST data access status for app builders WITHOUT institutional data rights
date: 2026-06-11
researcher: web-research agent (Claude)
confidence: |
  HIGH   - anything marked VERIFIED below was confirmed today via live HTTP probes (curl) or
           fetches of official pages (dp1.lsst.io, rsp.lsst.io, rubinobservatory.org, broker docs/APIs).
  MEDIUM - timeline statements (DP2, DR1) come from official pages but Rubin has revised these
           plans repeatedly; treat all future dates as soft.
  LOW    - anything in the UNVERIFIED/ASSUMED sections.
method: WebSearch + WebFetch of official docs, plus live curl probes of every API endpoint cited
        (HTTP status codes recorded inline). Live broker API calls returned real Rubin data.
```

---

## 1. TL;DR for the implementing model

- **Rubin catalogs and pixel data (DP1, upcoming DP2, future DR1) are NOT public.** They require
  Rubin **data rights** + an approved **Rubin Science Platform (RSP)** account. An unaffiliated
  developer cannot get one. All RSP APIs (TAP, SIAv2, SODA, HiPS) return **401 without a token**
  (verified by live probe today).
- **The alert stream IS world-public** (started 2026-02-24, ~800k alerts first night). Anyone can
  pull nightly transient lists — with ra/dec, fluxes, classifications, and cutouts — **anonymously
  over plain HTTPS REST** from community brokers. Verified live today against **Fink**
  (`api.lsst.fink-portal.org`) and **ALeRCE** (`api-lsst.alerce.online`); both returned real
  LSSTCam objects with no auth.
- **Two small pieces of real Rubin imagery ARE publicly reachable as HiPS without any login**
  (verified live today, CORS `*`):
  1. `https://images.rubinobservatory.org/hips/asteroids/color_ugri` (Rubin-hosted, Virgo field)
  2. `https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook` (CDS-hosted, ID `CDS/P/Rubin/FirstLook`,
     Virgo + Trifid/Lagoon, 29 deg²) — and **hips2fits cutouts from it work** (verified, returned a JPEG).
- So: build the survey layer on DSS2/Pan-STARRS/SDSS HiPS now, add the public Rubin First Look
  HiPS as a small demo layer, and add a **transient/alert layer from Fink/ALeRCE today** — that is
  the genuinely "live Rubin" feature available to everyone. Full-sky Rubin HiPS arrives only when
  a data release goes public (2 years after each DR).

---

## 2. Data releases and timeline

### VERIFIED

| Release | Content | Date | Access |
|---|---|---|---|
| **DP0** (0.1/0.2/0.3) | Simulated images + catalogs (DC2), simulated solar-system objects | available since 2021–2023 | RSP account (data-rights) |
| **DP1** | LSSTComCam commissioning: 7 fields × ~1 deg², 7 weeks of obs (2024-10-24 → 2024-12-11), Science Pipelines v29 | released **2025-06-30**, updated **2026-01-08** (WCS FITS fix) | **data-rights holders only** |
| **DP2** | LSSTCam commissioning + Science Validation: ~**30,000 single-visit exposures**, ugrizy, images acquired Apr 2025 – Jan 2026; same product suite as DP1 (cell-based coadds a stretch goal); per v7.0 plan: PVIs + per-epoch Source catalogs | **Jul–Sep 2026** ("mid-2026") | via RSP at data.lsst.cloud → **data-rights holders only** |
| **DR1** | Originally first 6 months of LSST; **the 6-month DR1 was cancelled/replaced — DR1 is now the full LSST Year-1 release** | see caveat below | data-rights for 2 years, then public |
| **Alerts** | Real-time transient alerts from difference imaging | streaming since **2026-02-24** (800,000 alerts night 1) | **world public, no proprietary period** |

Sources:
- https://dp1.lsst.io/ (DP1 contents, dates, access restriction: "Only Rubin data rights holders may have an account in the Rubin Science Platform (RSP) and access to Data Preview 1")
- https://rubinobservatory.org/for-scientists/resources/early-science (timeline incl. "Alerts: began streaming in February 2026")
- https://community.lsst.org/t/rubin-observatory-plans-for-early-science-v7-0-released/11252 (v7.0 plan: DP2 mid-2026 via RSP; 6-month DR1 replaced by year-1 DR1; v7.1 update expected Dec 2026)
- https://rubinobservatory.org/news/first-alerts (alert launch, volumes, "Rubin's alerts are public to the world")
- https://rubinobservatory.org/for-scientists/data-products/recent-data-releases

DP1 data products (verified at https://dp1.lsst.io/products/index.html): catalogs `Object, Source,
ForcedSource, DiaObject, DiaSource, DiaForcedSource, SSObject, SSSource, MPCORB, Visit, CcdVisit`;
images `deep_coadd, template_coadd, visit_image, difference_image, raw`; plus **survey property maps
and HiPS maps** (HiPS served only inside the authenticated RSP).

### Timeline caveats (MEDIUM confidence)

- The official LSST 10-year survey had **not formally started** as of the Feb 2026 alert launch —
  the launch article says full LSST "begins later in 2026" (https://rubinobservatory.org/news/first-alerts).
  Other pages say "early 2026". Exact survey start date not announced as of 2026-06-11.
- Therefore **DR1 (year-1 data + ~1 year processing) realistically lands late 2027 – 2028**, not
  the "end of 2026 – early 2027" figure that still appears in older early-science text. Treat DR1
  date as **unknown, ≥ late 2027**.
- **Public (no-rights) access to a data release comes 2 years after that release** (proprietary
  period per the Rubin data policy, RDO-013). So the first fully public Rubin DR is plausibly
  **~2029-2030**. Do not architect anything that waits for this; the alert stream is the public product.

---

## 3. Rubin Science Platform (RSP) — accounts, auth, APIs

### VERIFIED

- RSP = https://data.lsst.cloud (US Data Facility, Google Cloud). Documentation: https://rsp.lsst.io/
- **Account eligibility** (https://rsp.lsst.io/guides/getting-started/get-an-account.html):
  must hold Rubin data rights = scientists/students at US or Chilean institutions, or named
  international in-kind data-rights holders. Login via CILogon with InCommon / **GitHub** / ORCID
  identity, then **manual data-rights verification by Rubin staff** ("can take a few days").
  **People without data rights cannot obtain accounts.**
- **API services** (https://rsp.lsst.io/guides/api/index.html):
  - **TAP** (ADQL catalog queries) — primary service
  - **ObsTAP** (observation metadata)
  - **SIAv2** (image search)
  - **SODA** (image cutouts/mosaics)
  - **HiPS** (tile service for the RSP Portal's Aladin view)
  - planned by first DR: **Simple Cone Search (SCS)**, **VOSpace** (WebDAV user files)
  - All API access requires an **RSP access token** (created in the RSP UI; sent as
    `Authorization: Bearer <token>`). Docs: https://rsp.lsst.io/guides/auth/index.html
- **Live probe results (2026-06-11), no token:**
  ```
  GET https://data.lsst.cloud/api/tap/tables                          -> 401
  GET https://data.lsst.cloud/api/hips/images/color_gri/properties    -> 401
  ```
- **HiPS strategy** (https://dmtn-230.lsst.io/): RSP HiPS for DP0.2 lives under
  `data.lsst.cloud/api/hips/images/<dataset>` (e.g. `band_u`, color composites), **auth required**;
  the plan states that once releases become public they will be "served directly from Google Cloud
  Storage as a public static web site", with separate domains per release. This is the future
  public-Rubin-HiPS mechanism to watch.

### UNVERIFIED / ASSUMED

- Exact TAP endpoint path is assumed `https://data.lsst.cloud/api/tap` (the `/tables` child
  returned 401 rather than 404, consistent with this being correct).
- DP2 access policy is assumed identical to DP1 (data-rights only); stated release channel is the
  RSP, and no source suggests any public component.

---

## 4. Public Rubin imagery WITHOUT login (all VERIFIED live today)

### 4.1 Rubin-hosted HiPS (Google Cloud Storage behind `images.rubinobservatory.org`)

```
https://images.rubinobservatory.org/hips/asteroids/color_ugri/properties   -> HTTP 200
  access-control-allow-origin: *        <-- CORS open: usable directly from a browser app
  obs_title        = LSSTCam: Virgo
  hips_order       = 11, hips_tile_width = 512, hips_tile_format = webp
  hips_frame       = equatorial
  hips_initial_ra/dec = 188.17 / +7.09 (Virgo), moc_sky_fraction ≈ 0.00058 (~24 deg²)
  hips_builder     = lsst.pipe.tasks.hips.GenerateHipsTask
  hips_status      = private master clonableOnce   <-- metadata says "private" but it IS reachable
```
Tile URL pattern (standard HiPS): `…/hips/asteroids/color_ugri/Norder{N}/Dir{D}/Npix{P}.webp`
where `D = floor(P/10000)*10000`. Discovered via Rubin's public **Skyviewer** (https://skyviewer.app —
public, no login, built on Aladin Lite; offers "explorer" and "guided experiences" modes).
**Caveat:** `hips_status = private` + an undocumented bucket means this URL is not a contractual
API; it could move. Probes for sibling datasets (`hips/images/color_gri`, etc.) returned 404, and
there is no `/hips/list` (404). Treat as a demo asset, not infrastructure.

### 4.2 CDS-hosted First Look HiPS (registered, stable, public)

Registered in the CDS MocServer (queried live):
```
ID:               CDS/P/Rubin/FirstLook
hips_service_url: https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook
hips_status:      public master clonableOnce
```
Properties (fetched live): built by CDS from the two **First Look** PNG/TIFF releases of
2025-06-23 — "Cosmic Treasure Chest" (Virgo cluster, noirlab2521a) and Trifid+Lagoon (noirlab2521b),
**29 deg² total**, `hips_order = 12`, license ODbL-1.0, copyright RubinObs/NOIRLab/SLAC/NSF/DOE/AURA.
Source TIFFs (full-res, public): `https://storage.noirlab.edu/media/archives/images/original/noirlab2521a.tif` (and …b.tif).

Use in Aladin Lite v3 (works in any web app):
```js
aladin.setImageSurvey(aladin.createImageSurvey(
  "Rubin FirstLook", "Rubin First Look (CDS)",
  "https://alasky.cds.unistra.fr/Rubin/CDS_P_Rubin_FirstLook",
  "equatorial", 12, { imgFormat: "jpg" }));
```

### 4.3 hips2fits cutouts from Rubin imagery — works anonymously

Verified live (returned a valid 300×300 JPEG, HTTP 200):
```
https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FRubin%2FFirstLook
  &width=300&height=300&fov=0.2&projection=TAN&coordsys=icrs&ra=271.602&dec=-23.878&format=jpg
```
So the app's existing hips2fits cutout path works for Rubin First Look fields with zero changes —
just another `hips=` ID.

### 4.4 Other public image sources

- Rubin gallery / press images: https://rubinobservatory.org/gallery (media hosted on a Canto DAM;
  usage policy at https://rubinobservatory.org/media/design-resources/use-policy — generally CC BY 4.0).
- NOIRLab archive holds the originals (see 4.2).

---

## 5. The public alert stream and community brokers

### VERIFIED — stream basics

- Alerts began **2026-02-24**; **800,000 alerts the first night**; up to **~7 million/night** at
  full LSST; issued **within ~2 minutes** of image capture from difference imaging.
  (https://rubinobservatory.org/news/first-alerts, https://noirlab.edu/public/news/noirlab2605/)
- Official policy page: alerts "are **world public and have no proprietary period**"
  (https://rubinobservatory.org/for-scientists/data-products/alerts-and-brokers).
- Individuals do NOT connect to Rubin's Kafka directly; access is through **community brokers**.
  Full-stream brokers: **ALeRCE, AMPEL, ANTARES, Babamul, Fink, Lasair, Pitt-Google**;
  downstream: SNAPS, POI Broker. Key numbers doc: https://dmtn-102.lsst.io
- Prompt-products docs: https://prompt-products.lsst.io/ ("some Prompt Products are public and
  some proprietary" — alerts are the public part).

### 5.1 Fink — VERIFIED live, anonymous

- LSST portal: https://lsst.fink-portal.org/ — REST API: **`https://api.lsst.fink-portal.org`**
  (pattern `api.{survey}.fink-portal.org`, survey ∈ {ztf, lsst}). API docs UI: https://api.fink-portal.org
  and https://doc.lsst.fink-broker.org/ (services: conesearch, search by `diaObjectId`/name,
  tag-based filtering, forced photometry, images, statistics).
- Started processing Rubin alerts **2026-02-25 01:30 CET**; ~800k alerts night 1; ~50 SN candidates
  (https://fink-broker.org/news/2026-02-26-first-alerts/). Fink broker version observed live: 4.1.
- **No authentication** for REST (verified — anonymous POSTs succeeded). Kafka livestream
  (`fink-client`) requires free credential registration.
- Migration notes ZTF→LSST (https://doc.lsst.fink-broker.org/data/ztf_to_lsst/):
  object IDs are now numeric **`diaObjectId`** (e.g. `170226393632735260`); lightcurves moved to
  `/api/v1/sources`; `/api/v1/objects` now returns object-level summaries; resolver param is
  `name_or_id`; photometry is in **nJy fluxes** (`psfFlux`), not magnitudes.
- **Live calls verified today:**
  ```bash
  # object summary (HTTP 200, returns r:* = Rubin fields, f:* = Fink value-added fields)
  curl -X POST https://api.lsst.fink-portal.org/api/v1/objects \
    -H 'Content-Type: application/json' -d '{"diaObjectId":"170226393632735260"}'
  # -> r:diaObjectId, r:ra, r:dec, r:decErr, per-band stats (r:g_psfFluxMean, Max, Min, Sigma,
  #    r:g_scienceFluxMean, r:g_psfFluxNdata...), f:is_sso, f:is_first, f:main_label_crossmatch

  # cone search (HTTP 200; radius in arcsec)
  curl -X POST https://api.lsst.fink-portal.org/api/v1/conesearch \
    -H 'Content-Type: application/json' -d '{"ra":150.0,"dec":0.5,"radius":60}'
  # -> alerts with Fink ML scores (f:clf_snnSnVsOthers_score, f:clf_earlySNIa_score, ...)

  # schema discovery endpoint exists: GET /api/v1/schema (HTTP 200)
  ```
- Endpoints that exist but were flaky during testing: `/api/v1/sources` (lightcurve) and
  `/api/v1/cutouts` returned **502** intermittently mid-session (whole API briefly 502'd — young
  service under load; client MUST retry with backoff). `/api/v1/latests` from the ZTF API returned
  **404** on the LSST host — class-based "latest" queries appear to have been reorganized
  (tag/class endpoints; check `GET /api/v1/schema` and https://api.lsst.fink-portal.org for the
  current list).
- Rate limits: none documented (UNVERIFIED; assume informal fair-use; observed ~500 req/min handled
  at launch).

### 5.2 ALeRCE — VERIFIED live, anonymous

- LSST explorer: https://lsst.alerce.online/ ; "ALeRCE is now live processing Rubin alerts"
  (https://community.lsst.org/t/alerce-is-now-live-processing-rubin-alerts/11632).
- Multisurvey REST base: **`https://api-lsst.alerce.online/`** (extracted from the official Python
  client's `default_config.json`, github.com/alercebroker/alerce_client). Python client ≥2.0:
  `pip install alerce`, methods take `survey="lsst"`.
- OpenAPI specs fetched live: `…/object_api/openapi.json`, `…/lightcurve_api/openapi.json`;
  Swagger UI at `…/object_api/docs`. Endpoints (verified):
  ```
  GET /object_api/list_objects   params: survey, class_name, classifier, probability, n_det,
                                         firstmjd, lastmjd, ra, dec, radius, oid, ranking, page...
  GET /object_api/object         params: oid, survey_id
  GET /lightcurve_api/lightcurve | /detections | /non_detections | /forced-photometry  (oid, survey_id)
  GET /lightcurve_api/conesearch/objects_by_coordinates   params: ra, dec, radius, neighbors
  GET /lightcurve_api/conesearch/objects_by_oid           params: oid, survey, radius, neighbors
  GET /probability_api/probability
  POST /stamps_api/stamp , /stamps_api/get_avro           (cutout stamps + full Avro packet)
  ```
- **Live calls verified today (HTTP 200, no auth):**
  ```bash
  curl "https://api-lsst.alerce.online/object_api/list_objects?survey=lsst"
  # -> real Rubin objects: {"oid":170226393632735260, "meanra":149.98, "meandec":0.54,
  #     "firstmjd":61135.00, "lastmjd":61178.98, "n_det":60, "n_forced":79,
  #     "class_name":"SN", "classifier_name":"stamp_classifier_rubin_beta",
  #     "classifier_version":"2.0.1", "probability":0.997, ...}

  curl "https://api-lsst.alerce.online/lightcurve_api/conesearch/objects_by_coordinates?ra=150.0&dec=0.5&radius=120&neighbors=3"
  # -> mixed-survey matches: ZTF objectIds AND LSST numeric oids with ra/dec
  ```
- Same `diaObjectId` resolves in both Fink and ALeRCE (verified with 170226393632735260) —
  **Rubin IDs are broker-portable**, which simplifies multi-broker UIs.
- Rate limits: none documented; docs say APIs "are for public use and most of them do not require
  authentication" (https://alerceapi.readthedocs.io/).

### 5.3 ANTARES — VERIFIED docs; API reachable, auth needed only for streaming

- Portal: https://antares.noirlab.edu/ (NOIRLab). Started ingesting LSST alerts **night of
  2026-02-24/25** (https://pypi.org/project/antares-client/).
- Python client: `pip install antares-client` (v1.14 docs:
  https://nsf-noirlab.gitlab.io/csdc/antares/client/). REST base: **`https://api.antares.noirlab.edu/v1/`**
  (overridable via `ANTARES_API_BASE_URL`).
- Search is anonymous; **real-time Kafka streaming requires requesting API credentials** from the
  ANTARES team. Query language: Elasticsearch DSL. Examples from official docs:
  ```python
  from antares_client.search import get_by_id, search, cone_search
  from astropy.coordinates import Angle, SkyCoord
  locus = get_by_id("ANT2020j7wo4")
  for locus in cone_search(SkyCoord("20h48m25s 29d45m05s"), Angle("1s")): ...
  query = {"query":{"bool":{"filter":[
      {"range":{"properties.num_mag_values":{"gte":50}}},
      {"term":{"tags":"nuclear_transient"}}]}}}
  results = search(query)
  ```
- Rate limits: not documented (UNVERIFIED). ANTARES is the least convenient for a pure-browser app
  (Elasticsearch JSON over a Python-oriented API), but fine via a thin proxy.

### 5.4 Lasair (bonus, UK broker) — VERIFIED docs

- LSST instance: https://lasair.lsst.ac.uk / API host https://api.lasair.lsst.ac.uk/
  (docs: https://lasair.readthedocs.io/).
- Requires a free account + API token (`/api/auth-token/`). **Documented rate limits** (rare —
  useful planning anchor): anonymous 10 calls/hr (≤1k rows), registered 100 calls/hr (≤10k rows),
  power users 10k calls/hr; HTTP 429 on exceed.

### Alert packet contents (for the app's data model)

VERIFIED via live broker responses: per **DiaObject** you get `diaObjectId`, `ra`, `dec` (+errors),
per-band flux statistics in **nJy** (`{band}_psfFluxMean/Max/Min/Sigma`, `scienceFluxMean`,
`psfFluxNdata`), MJD first/last, detection counts, and broker classifications (+probabilities).
Per **DiaSource** (lightcurve points): MJD, band, `psfFlux`/err. Conversion the app will need:
`mag_AB = -2.5 * log10(flux_nJy * 1e-9 / 3631)`.
UNVERIFIED detail: raw alert packets also carry 3 cutout stamps (science/template/difference;
~30×30 px); brokers re-expose them (ALeRCE `stamps_api/stamp`, Fink `/api/v1/cutouts`) — endpoint
shapes verified, payload format (PNG/FITS) not exercised end-to-end.

---

## 6. What an unaffiliated developer can use TODAY (2026-06-11)

1. **Alert/transient layer (the headline Rubin feature):** nightly transient lists with ra/dec,
   fluxes→mags, ML classifications, lightcurves, cutout stamps — anonymous REST from
   **ALeRCE** (`api-lsst.alerce.online`, clean GET+query-param API, OpenAPI documented — best fit
   for a browser app) and **Fink** (`api.lsst.fink-portal.org`, POST+JSON). No keys, no quotas
   documented. CORS for these APIs was NOT tested — plan a tiny serverless proxy as a fallback.
2. **Real Rubin imagery, small fields:** `CDS/P/Rubin/FirstLook` HiPS via alasky (+hips2fits
   cutouts), and the Rubin-hosted Virgo HiPS (`images.rubinobservatory.org/hips/asteroids/color_ugri`,
   CORS `*`). ~29 deg² total — a "Rubin showcase" tour layer, not a base map.
3. **Everything else in the app** (DSS2/Pan-STARRS/SDSS HiPS, SIMBAD/VizieR TAP, hips2fits,
   Gaia DR3) is unaffected by Rubin's access rules.

**NOT available today without data rights:** DP1/DP2 catalogs and images, RSP TAP/SIAv2/SODA/HiPS
(all 401), full-sky Rubin HiPS of any kind.

## 7. What unlocks later

- **DP2 (Jul–Sep 2026):** nothing for unaffiliated devs (RSP-only). Watch for new public
  press-release HiPS at CDS, though.
- **DR1 (≥ late 2027, date unannounced):** still rights-only at release; the win for this app is
  that brokers' archives keep growing and Rubin/CDS keep publishing showcase HiPS.
- **DR1 + 2 years (~2029+):** first fully public Rubin data release. Per DMTN-230, public releases
  will be served as **static HiPS on Google Cloud Storage under release-specific public domains** —
  i.e., exactly the interface this app already consumes. Also expect `CDS/P/...` mirrors on alasky
  and hips2fits support, plus public TAP (possibly via mirrors/IDACs).

## 8. How the app should abstract its survey layer

Design rule: **everything Rubin will eventually offer is already shaped like things the app
consumes today** (HiPS for pixels, TAP/cone REST for catalogs, hips2fits/SODA for cutouts,
REST lists for transients). So abstract by protocol, not by survey:

```ts
// survey-layers.ts — declarative registry, hot-swappable at runtime
interface HipsLayerDescriptor {
  id: string;                 // "dss2-color" | "panstarrs-dr1" | "rubin-firstlook" | future "rubin-dr1"
  name: string;
  rootUrl: string;            // HiPS base; tile = `${rootUrl}/Norder${n}/Dir${d}/Npix${p}.${fmt}`
  maxOrder: number;           // from /properties: hips_order
  tileFormat: "jpg"|"png"|"webp";
  frame: "equatorial";
  coverageMocUrl?: string;    // load Moc.fits to grey-out uncovered sky (vital for partial Rubin HiPS)
  attribution: string;        // obs_copyright from /properties
  requiresAuth?: false;       // keep the field; never implement auth paths until a public need exists
}

interface TransientProvider {              // alert layer abstraction
  id: "alerce" | "fink" | "antares";
  listRecent(opts: {sinceMjd?: number; className?: string; minProb?: number; limit: number}):
    Promise<TransientSummary[]>;           // {id, ra, dec, magLatest, band, mjdLast, class, prob}
  coneSearch(ra: number, dec: number, radiusArcsec: number): Promise<TransientSummary[]>;
  lightcurve(id: string): Promise<PhotPoint[]>;       // {mjd, band, fluxNJy, fluxErr}
  cutoutUrl(id: string, kind: "science"|"template"|"difference"): string;
}

interface CutoutService {     // hips2fits today; SODA later — same call shape
  cutout(opts: {hipsId: string; ra: number; dec: number; fovDeg: number;
                width: number; height: number; format: "jpg"|"png"|"fits"}): Promise<Blob>;
}
```

Concrete guidance:
- **Parse `/properties` at layer load** (plain key=value text) to fill `maxOrder`, `tileFormat`,
  initial ra/dec/fov — never hardcode; Rubin's HiPS will differ per release.
- **Load the MOC** for partial-coverage layers and render a coverage boundary; Rubin First Look is
  0.06% of the sky and looks broken without it.
- **Adapter-per-broker behind `TransientProvider`**, with ALeRCE as default (GET API, OpenAPI
  spec) and Fink as fallback; treat 5xx as expected (observed live) → retry/circuit-break, and
  cache nightly lists server-side (one cron pull/night is plenty for "what changed tonight").
- **Keys are numeric strings**: `diaObjectId` is int64 — JS `Number` will corrupt it
  (`170226393632735260` > 2^53). Parse as string/BigInt everywhere.
- Fluxes are **nJy**, not mags — convert at the adapter boundary so the UI only sees AB mags.
- When LSST DR-N goes public: add one `HipsLayerDescriptor` (GCS public domain), point
  `CutoutService` at the same hips2fits/SODA shape, add a TAP `ConeSearchProvider` entry. No
  engine changes if the above holds.

---

## 9. Decisions recommended

1. **Do not plan around RSP access.** No data rights → no account → no TAP/SODA/HiPS. Don't build
   token plumbing now; keep an optional `auth` hook in the layer descriptor for the far future.
2. **Ship the alert layer now, with ALeRCE LSST as primary provider** (`api-lsst.alerce.online`,
   anonymous, OpenAPI-documented, GET-friendly) **and Fink as secondary** — both verified serving
   real Rubin data anonymously today.
3. **Add `CDS/P/Rubin/FirstLook` as a featured "Rubin First Look" layer** (alasky-hosted, stable,
   ODbL, hips2fits-compatible) and use the Rubin-hosted Virgo HiPS only as an optional extra
   (undocumented bucket, `hips_status=private`, may vanish).
4. **Put a thin caching proxy (serverless) between the app and brokers**: solves unknown CORS,
   absorbs broker 5xx flakiness, caps your request volume to be a polite client, and lets you
   nightly-materialize "what changed tonight" as one static JSON the 3D client streams.
5. **Abstract by protocol (HiPS/TAP/cutout/transient interfaces), not by survey** — section 8.
   Base sky = DSS2/Pan-STARRS/SDSS HiPS from alasky now; Rubin DR HiPS becomes a one-line registry
   addition in ~2029.
6. **Treat all forward-looking Rubin dates as provisional** in user-facing copy ("coming when
   public") — DP2 Jul–Sep 2026, DR1 unannounced (≥ late 2027), public DR ~2 years later.

## 10. Open questions (need a decision or runtime test)

1. **CORS on broker APIs**: `images.rubinobservatory.org` verified `access-control-allow-origin: *`;
   alasky is known-CORS-open (Aladin Lite depends on it); but `api-lsst.alerce.online` and
   `api.lsst.fink-portal.org` CORS headers were not captured — test from a browser; proxy if absent.
2. **Fink LSST "latest by class" endpoint**: ZTF's `/api/v1/latests` 404s on the LSST host; the
   tag/class-based replacement's exact name needs checking against `GET /api/v1/schema` or
   https://api.lsst.fink-portal.org docs UI at implementation time.
3. **Cutout payloads**: ALeRCE `stamps_api/stamp` and Fink `/api/v1/cutouts` exist but a successful
   end-to-end stamp fetch (format, size, projection metadata) wasn't completed (Fink 502 during test
   window). Verify at implementation time.
4. **Broker rate limits**: undocumented for Fink/ALeRCE/ANTARES (Lasair's are documented:
   10/100/10k calls·hr⁻¹ tiers). Assume fair-use; the caching proxy makes this moot.
5. **ALeRCE LSST coverage/depth**: `list_objects?survey=lsst` returned few classified objects for
   the default classifier (`stamp_classifier_rubin_beta`) — the classified subset is young. How
   complete the nightly classified stream is vs raw alerts needs monitoring as LSST ramps up.
6. **Official LSST survey start date** (drives DR1): unannounced as of 2026-06-11; v7.1 early
   science plan update (expected ~Dec 2026) should pin DP2 final contents and DR1 dates.
7. **Will Rubin publish more public showcase HiPS** (e.g., at DP2/first-year press events) on
   `images.rubinobservatory.org`? No list endpoint exists; re-probe around DP2 (Jul–Sep 2026).
8. **Rubin alert Kafka direct access** for heavy use: brokers suffice for this app, but if a
   future feature needs full-stream latency, evaluate Pitt-Google (Pub/Sub, GCP-native) or Fink
   livestream credentials.
