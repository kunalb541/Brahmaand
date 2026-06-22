# Survey: Open-Source Astronomy Visualization Projects — Reuse & Licensing

```yaml
topic: Existing open-source astronomy visualization projects — reusable code, formats, algorithms, and license gates
date: 2026-06-11
author: research agent (web-verified)
project-context: TypeScript + Vite + Three.js + WebXR astronomy app; desktop-first, VR-ready; permissive licensing strongly preferred
confidence: |
  License IDs and repo activity were verified on 2026-06-11 via the GitHub API
  (license.spdx_id, pushed_at, recent commits), the npm registry, and project docs.
  Items marked UNVERIFIED were not directly confirmed and should be re-checked
  before any code is copied. License analysis below is engineering-grade reasoning,
  not legal advice.
```

## TL;DR

- **Aladin Lite v3 is now LGPL-3.0-or-later (relicensed from GPL-3 in v3.8.0)** — this is the single most important finding. It can be embedded as an unmodified npm dependency *without* contaminating our app, but its Rust/WASM core renders to its own canvas and has **no WebXR support**, so it cannot be our VR sky engine.
- **WWT WebGL engine (MIT)** is the only permissively-licensed engine with real HiPS rendering code — it is the one codebase we may **copy from freely**.
- **Stellarium Web Engine is AGPL-3 + commercial dual-license and dormant** (no substantive human commits since ~2022). Learn from it; never copy from it.
- **Gaia Sky (MPL-2.0)** has the best-documented star octree/LOD binary format — adopt the *format and algorithm* (formats are not copyrightable), reimplement the code.
- **No surveyed engine supports WebXR.** Building our own Three.js renderer is justified; embed Aladin Lite at most as an optional 2D "finder" companion panel.

---

## 1. Aladin Lite v3 (CDS Strasbourg)

### VERIFIED
- Repo: https://github.com/cds-astro/aladin-lite — active (pushed 2026-06-09), 148 stars. API docs: https://cds-astro.github.io/aladin-lite/
- **License: `LGPL-3.0-or-later`** — confirmed three ways: GitHub API `license.spdx_id = LGPL-3.0`, README ("Aladin Lite is currently licensed under LGPL-3.0-or-later"), and npm registry metadata for package `aladin-lite@3.9.0-beta`.
- **The relicense from GPLv3 to LGPLv3-or-later happened in v3.8.0** per the CHANGELOG: https://github.com/cds-astro/aladin-lite/blob/master/CHANGELOG.md ("[license] License change from GPLv3 to LGPLv3-or-later"). Many older pages (e.g., the 2023 Strasbourg announcement https://astro.unistra.fr/en/2023/01/31/aladin-lite-v3/) still say GPL-3 — they are out of date.
- Latest npm release: `aladin-lite@3.9.0-beta`, published 2026-06-01, license field `LGPL-3.0-or-later`.
- Architecture: core written in **Rust, compiled to WASM via wasm-bindgen**, rendering with **WebGL2**; JS/TS API layer on top. Core Rust deps: `cdshealpix` (HEALPix projection) and `mapproj` (WCS projections) — per README.
- Embedding: `npm i aladin-lite` or CDN `https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js`.
- **No WebXR/VR support** — no mention anywhere in README, CHANGELOG, or API docs. It owns its own WebGL2 context/canvas; it is not a Three.js layer.
- Recent features (CHANGELOG): HiPS cubes (3.6.1), **HiPS3D implementation (3.7.0-beta)**, HiPS browser window + dark mode (3.8.0), AVM tag reading/export (3.9.0-beta).
- It powers ESASky, ESO Science Archive, ALMA portal (README).

### Typical embed (v3 API)
```html
<div id="aladin-lite-div" style="width:600px;height:400px"></div>
<script type="module">
  import A from 'aladin-lite';
  A.init.then(() => {
    const aladin = A.aladin('#aladin-lite-div', {
      survey: 'P/DSS2/color', fov: 1.5, target: 'M31', projection: 'AIT'
    });
    aladin.on('objectClicked', (obj) => console.log(obj));
  });
</script>
```

### License analysis for OUR app
- LGPL-3 as an **unmodified npm dependency** does not make our TS/Three.js app LGPL. Obligations: ship the LGPL notice, don't misrepresent authorship, and allow the user to replace the library (LGPLv3 §4). With JS bundlers the conservative pattern is to **keep aladin-lite in its own dynamically-imported chunk (un-minified or source-mapped) rather than inlining it into a monolithic minified bundle**, so "relinking/replacement" is plausibly satisfied.
- If we ever **modify** Aladin Lite source (JS or Rust), those modifications must be released under LGPL-3.
- **What to reuse:** the library itself as an optional embedded 2D sky panel; its API design (survey IDs like `P/DSS2/color`, `setFov`, overlay/MOC/catalogue concepts); the HiPS list aggregator it consumes (https://aladin.cds.unistra.fr/hips/list). The Rust crates it uses — `cdshealpix` is **Apache-2.0/MIT-friendly? UNVERIFIED, check crate license before porting** — are separate works with their own licenses.
- **What to avoid:** copying shader/Rust/JS code into our permissively-licensed codebase (LGPL would attach to the copied portions); relying on it for VR (impossible today).

---

## 2. AAS WorldWide Telescope — wwt-webgl-engine

### VERIFIED
- Repo: https://github.com/WorldWideTelescope/wwt-webgl-engine — **License: MIT** (GitHub API). Docs: https://docs.worldwidetelescope.org/webgl-reference/latest/
- **Actively maintained in June 2026**: human commits on 2026-06-03/04/05 (Jon Carifio, John Arban Lewis — e.g., "use more robust nan detection", Moon fade fixes) plus dependabot merges on 2026-06-09/10. Not abandoned.
- npm: `@wwtelescope/engine` latest **7.36.0**, published **2026-06-08**, license MIT. Companion packages: `@wwtelescope/engine-helpers`, `@wwtelescope/engine-types`, `@wwtelescope/engine-pinia`, `@wwtelescope/webclient`.
- **HiPS support: yes.** The engine renders HiPS imagesets and HiPS *catalogs*: `WWTInstance.addCatalogHipsByName(...)` (promise resolves when catalog metadata downloaded); HiPS catalogs are "managed like imagesets but rendered like spreadsheet layers"; `imgset.get_hipsProperties().get_catalogSpreadSheetLayer()` — per https://docs.worldwidetelescope.org/webgl-reference/latest/apiref/engine-helpers/classes/wwtinstance.html
- Governance: open governance, fiscally sponsored by **NumFOCUS** (graduated 2023); historically supported by AAS, .NET Foundation, Microsoft (https://worldwidetelescope.org/about/, Wikipedia).
- Engine is the renderer behind the WWT research app (https://web.wwtassets.org/research/latest/) and pywwt.

### UNVERIFIED / nuance
- The engine is a 2014-era C#-to-JS transpilation heritage codebase progressively converted to TypeScript; code style is dated (global state, non-tree-shakeable). Practical reuse is *reading and porting*, not importing modules piecemeal. (Strong prior; verify by reading `engine/esm/` sources.)
- AAS reduced direct funding around 2023 (the NumFOCUS move is the verified part; the exact funding narrative is not).
- WebXR: no mention in engine docs; assume **no WebXR**.

### What to reuse (this is our "copy-from" codebase — MIT)
- HiPS tile URL construction, `properties` file parsing, HEALPix-face → mesh tessellation, TOAST projection code, FITS tile decompression, catalog-HiPS-to-table logic.
- Their imageset/layer abstraction as an architecture reference.
- **What to avoid:** embedding the whole engine as our renderer — it owns its canvas, is not Three.js-based, and has no XR path; also Vue/Pinia coupling in the higher-level packages.

---

## 3. Stellarium Web Engine

### VERIFIED
- Repo: https://github.com/Stellarium/stellarium-web-engine — "JavaScript planetarium engine", 612 stars.
- **License: dual AGPL-3.0 / commercial.** `LICENSE-AGPL-3.0.txt` at repo root (https://github.com/Stellarium/stellarium-web-engine/blob/master/LICENSE-AGPL-3.0.txt); GitHub API reports `license: None` because of the custom dual arrangement; contributors must sign a **CLA** (which enables Stellarium Labs to sell commercial licenses).
- Tech: core written in **C, compiled with Emscripten to WASM** (`stellarium-web-engine.js` + `.wasm`), WebGL rendering, Vue web-frontend in `apps/web-frontend`.
- **HiPS: yes** — README lists HiPS surveys rendering as a core feature; it streams DSS and planet textures as HiPS, plus Gaia star data ("more than 1.5 billion stars" via its own server-side data).
- **Maintenance: dormant.** Commit history (GitHub API, 100 most recent commits, checked 2026-06-11): only dependabot bumps since Jan 2025; last human commits were trivial (Jan 2025: CLA signature, doc link fix; Oct 2024: German translation). Last substantive engine work: **Dec 2021** (Guillaume/Fabien Chereau); copyright updated to "Stellarium Labs SRL" Sep 2022. The Chereau brothers' effort moved to the commercial Stellarium Mobile/Web products.

### License analysis
- **AGPL-3 is the most viral license here**: even SaaS/network use triggers full source-disclosure of the combined work. Embedding the engine or copying any code would force our entire app to AGPL-3 (unless we bought a commercial license from Stellarium Labs).
- **What to reuse (ideas only):** its data pipeline concept (server-side preprocessed star tiles fetched on demand, HiPS for everything including landscapes/planet textures); atmosphere model (it implements a skylight model in C — reimplement from the cited papers, e.g., Preetham/Hosek-Wilkie, not from their code); its UX (time controls, ephemerides).
- **What to avoid:** any code, shaders, or data files from the repo; also note its bundled star data server (`noctuasky` / Stellarium Labs servers) is not a public commitment — do not depend on it.

---

## 4. Gaia Sky (Toni Sagristà / ARI Heidelberg)

### VERIFIED
- Canonical repo: https://codeberg.org/gaiasky/gaiasky; GitHub mirror: https://github.com/langurmonkey/gaiasky (pushed 2026-06-11 — very active). **License: MPL-2.0** (GitHub API + LICENSE.md).
- Java + libGDX (OpenGL), desktop application — **not web**.
- **VR: Gaia Sky VR runs on OpenXR** (`-vr` flag; older versions used OpenVR) — docs: https://gaia.ari.uni-heidelberg.de/gaiasky/docs/master/Gaia-sky-vr.html
- **Star octree/LOD catalog format is fully documented** at https://gaia.ari.uni-heidelberg.de/gaiasky/docs/master/LOD-catalogs.html — details (verified from the docs page):
  - `metadata.bin` (octree): version-0: `int32 nOctants`, then per octant: `int32 pageId`, `3×f32 position`, `3×f32 halfSize`, `8×int32 childIds (-1 if none)`, `int32 depth`, `int32 cumulativeStarCount`, `int32 localStarCount`, `int32 childCount`. Version-1 (since Gaia Sky 3.0.4, starts with `-1` token + version int): same but pageId/childIds are **int64**. **Big-endian** throughout.
  - `particles_NNNNNN.bin` (one per octant): per star — `3×f64 position`, `3×f64 velocity vector`, `3×f64 proper motion`, `4×f32 (appMag, absMag, color, size)`, `int32 HIP`, `int64 Gaia sourceId`, `int32 nameLen` + UTF-16 name. **Version-2 ("compact")** drops velocity/pm to f32.
  - LOD culling by minimum visual solid angle θ of an octant as seen from camera.

### What to reuse
- **The octree LOD scheme and binary-format design** — adopt the *concepts* (octree metadata file + per-octant particle chunks + solid-angle culling) for our Gaia DR3 preprocessing pipeline. File formats/algorithms are not copyright-protected; we write our own packer in Python/TS. Recommended deltas for web: little-endian (JS `DataView` default-friendly), f32 positions in parsec-scaled local frames, drop UTF-16 names from chunks (names via separate index), align to 4 bytes for zero-copy `Float32Array` views.
- Its magnitude→size/color mapping and camera "focus + free + cinematic" modes as UX reference.
- **What to avoid:** copying Java source files verbatim into our app (MPL-2.0 is file-level copyleft — any file containing MPL code stays MPL; porting/reimplementing ideas is fine and clean).

---

## 5. OpenSpace (Linköping U. / AMNH / NASA-funded)

### VERIFIED
- Repo: https://github.com/OpenSpace/OpenSpace — 1176 stars, active (pushed 2026-06-11). **License: MIT** (LICENSE.md text verified: standard MIT permission grant; GitHub API shows NOASSERTION only because of extra included-libs notes in the file).
- C++/OpenGL desktop/cluster application; targets planetarium domes and tiled displays via SGCT; features Digital Universe catalogs, globebrowsing (WMS planetary imagery), mission 3D models (https://www.openspaceproject.com/).
- **VR: weak.** Per Brown U. VR-software wiki (https://www.vrwiki.cs.brown.edu/vr-visualization-software/openspace): OpenVR integration poorly documented and reported **broken as of March 2022**; historically headset-tracking only, no controllers. VR is not a supported first-class mode.

### What to reuse
- MIT license means **shader and algorithm code can be copied with attribution**: their star-billboard rendering, exponential depth-buffer handling for astronomical scale ranges (relevant: our scene spans AU→kpc), and globebrowsing tile math are legitimate copy/port sources.
- Their "scene graph with dynamic origin re-anchoring" approach to floating-point precision (camera-relative rendering) is the standard fix we will need in Three.js for the Gaia flythrough.
- **What to avoid:** embedding (C++ desktop, no web build), their VR code (broken).

---

## 6. Celestia and web ports

### VERIFIED
- Repo: https://github.com/CelestiaProject/Celestia — **GPL-2.0** (GitHub API; README: "GPL version 2 or later"), 2297 stars, active (pushed 2026-06-11). C++/OpenGL.
- **An official web build exists: "Celestia for Web" at https://celestia.mobi/web** (runs the real engine in the browser; celestia.mobi is the Celestia team's distribution hub). Browser requirements: Chrome/Firefox/Safari.

### UNVERIFIED
- The web build is presumably the C++ engine compiled with **Emscripten to WASM** (consistent with the engine being C++ and the page requiring WebGL2); the exact source location of the web wrapper (likely inside CelestiaProject repos or Levin Li's trees) was not pinned down. There is **no project called "celestia.js"** — searches surface only the unrelated Celestia blockchain (celestiaorg) and the unrelated Celeste game port. Treat "celestia.js" as nonexistent.

### What to reuse
- Nothing code-wise (GPL-2 would contaminate). Its `.ssc/.stc/.dsc` catalog text formats and add-on ecosystem are a design reference for extensibility. Its star rendering (point sprites + glare textures) is well-trodden prior art to learn from via papers/blogs instead.

---

## 7. ESASky (ESA/ESDC) — embeddable service, not a library

### VERIFIED
- App: https://sky.esa.int (built on Aladin Lite per CDS README). JS API docs: https://www.cosmos.esa.int/web/esdc/esasky-javascript-api; integration guide: https://www.cosmos.esa.int/web/esdc/how-to-use-esasky-in-your-application; URL params: https://www.cosmos.esa.int/web/esdc/esasky-url-parameters
- Embedding = **iframe + postMessage**:
```javascript
// command in, results back via window message events
const frame = document.getElementById('esasky').contentWindow;
frame.postMessage({ event: 'goToRaDec', content: { ra: '83.6287', dec: '22.0147' } },
                  'https://sky.esa.int');
window.addEventListener('message', (e) => { /* e.data = ESASky response */ });
```
- Verified commands include: `goToRaDec`, `goToTargetName` (SIMBAD resolve), `setFov`, `getFov`, `setCooFrame`, `changeHips`, `setHipsColorPalette`, `overlayCatalogue`, `overlayFootprints`, `plotObservations`.
- Jupyter widget: https://github.com/esdc-esac-esa-int/pyesasky

### Assessment
- Zero-effort rich sky browser, but: iframe = no WebXR, no Three.js integration, no rendering control, and a hard runtime dependency on an ESA service. **Use at most as an external "open in ESASky" deep-link** (`https://sky.esa.int/?target=M31&fov=1&sci=true` style URL params), not as a component. No explicit license/ToS found on the API page (UNVERIFIED — check ESA terms before commercial use).

---

## 8. Existing WebXR / web planetarium apps

### VERIFIED (repo facts)
| Project | URL | License | Status | Notes |
|---|---|---|---|---|
| up-there-webvr | https://github.com/flimshaw/up-there-webvr | MIT | abandoned (last push 2018-01) | Three.js **WebVR** (pre-WebXR) planetarium; ~100k stars w/ true 3D positions from HYG; closest existing analog to our flythrough feature |
| Charlie Hoey planetarium demo | https://charliehoey.com/threejs-demos/planetarium.html | n/a (demo) | static | Three.js particle system from 150k-star HYG catalog, magnitude/color mapped — good minimal reference |
| hooverdn/planetarium | https://github.com/hooverdn/planetarium | (unverified) | small | WebGL; USNO bright-star table; Keplerian planet positions |
| VirtualSky | https://github.com/slowe/VirtualSky | no license file detected (GitHub API: None) | last push 2023-10 | 2D canvas embeddable planetarium — UX reference only |
| d3-celestial | https://github.com/ofrohn/d3-celestial | BSD-3-Clause | last push 2024-08 | 2D D3 star map; its **GeoJSON constellation lines/boundaries/star data files** are reusable under BSD-3 |

### Conclusion (verified by absence across all docs searched)
**No production-grade open-source WebXR planetarium exists in 2026.** The WebXR astronomy niche is demos and abandoned WebVR-era projects. Our app would be filling a real gap; there is no engine to embed that gets us VR for free.

### UNVERIFIED leads
- Google's "100,000 Stars" Chrome Experiment (2012, Three.js Gaia-precursor flythrough) — inspirational UX; source availability/license not confirmed.
- Newer Quest-store planetariums (e.g., "Open Space VR" on Meta store) are closed-source.

---

## Build-vs-embed recommendation matrix (for TypeScript + Three.js + WebXR, permissive-license-preferred)

| Capability | Embed candidate | Verdict | Rationale |
|---|---|---|---|
| HiPS sky sphere (2D survey imagery) | Aladin Lite (LGPL-3) / WWT engine (MIT) / SWE (AGPL) | **BUILD in Three.js; port logic from WWT (MIT); read Aladin Lite for algorithms only** | None of the three renders into a Three.js scene or supports WebXR; all own their canvas. WWT is the only permissive HiPS implementation to copy from. HiPS tile math (HEALPix order/npix → `Norder{N}/Dir{npix//10000}/Npix{npix}.{ext}`) is simple and IVOA-documented. |
| 2D "finder chart" side panel (non-VR desktop UI) | Aladin Lite v3 | **EMBED (optional, post-MVP)** | LGPL-3 npm dep, unmodified, own chunk — no contamination. Gives MOCs, catalog overlays, HiPS browser for free on desktop. |
| Gaia DR3 3D star flythrough | Gaia Sky (MPL, Java), up-there-webvr (MIT, dead) | **BUILD; adopt Gaia Sky's octree LOD format design (re-spec'd little-endian/f32); offline Python preprocessing** | No web engine exists for this. Gaia Sky's documented metadata.bin/particles.bin scheme is the proven blueprint; solid-angle octant culling maps directly to a Three.js frustum+distance test with one Points/InstancedMesh per octant. |
| Object info (click/gaze) | ESASky iframe | **BUILD: direct HTTP to SIMBAD/VizieR TAP + CDS Sesame; hips2fits for cutouts** | Plain `fetch()` to public services; no library needed. Verified cutout endpoint: `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&width=512&height=512&fov=0.5&ra=83.6287&dec=22.0147&format=png` (formats: fits/jpg/png; mirror: alaskybis.cds.unistra.fr). |
| Planetarium ephemerides (sun/moon/planets) | Stellarium Web Engine | **BUILD with a permissive lib (e.g., astronomy-engine, MIT — verify) — never copy SWE (AGPL)** | SWE is AGPL + dormant. Ephemeris math is available permissively. |
| WebXR/VR mode | (nothing) | **BUILD on Three.js WebXRManager** | Zero existing engines support WebXR. `renderer.xr.enabled = true` + Three.js sky-sphere/star-points works in both flat and XR rendering paths by construction. |
| Rubin/LSST alert layer | Fink/ALeRCE/ANTARES broker APIs | **BUILD (thin client)** | Broker REST APIs; no visualization engine involved. |
| Whole-app embed (ship fastest, abandon our stack) | ESASky iframe or WWT research app | **REJECT** | No VR, no rendering control, service dependency; contradicts project goals. |

### License gate summary
| Source | License | Copy code? | Embed as dep? | Learn/port algorithms? |
|---|---|---|---|---|
| WWT webgl engine | MIT | **YES** (keep notice) | yes | yes |
| OpenSpace | MIT | **YES** (keep notice; C++→TS port) | n/a (desktop) | yes |
| d3-celestial data files | BSD-3-Clause | **YES** (keep notice) | yes | yes |
| up-there-webvr | MIT | yes (dated code) | no (dead) | yes |
| Aladin Lite v3 | LGPL-3.0-or-later | **NO** (would LGPL those parts) | **yes, unmodified + replaceable chunk** | yes (clean-room reimplement) |
| Gaia Sky | MPL-2.0 | per-file copyleft — avoid | n/a (Java desktop) | **yes — formats/algorithms free** |
| Stellarium Web Engine | AGPL-3.0 (dual) | **NEVER** | **NO** (viral incl. SaaS) | ideas only, from papers not code |
| Celestia | GPL-2.0 | **NO** | no | yes (data format concepts) |
| ESASky | service (no code) | n/a | iframe only — not for VR | API design |

---

## Decisions recommended

1. **Build our own renderer on Three.js; do not embed any existing engine as the core.** Verified blocker: none of Aladin Lite, WWT, or Stellarium Web Engine supports WebXR or renders into an external Three.js scene.
2. **Designate `WorldWideTelescope/wwt-webgl-engine` (MIT) as the sole "copy-permitted" reference codebase** for HiPS tile handling. Keep an `ATTRIBUTION.md` listing every ported file/function.
3. **Treat Aladin Lite as (a) an algorithm reference (read-only) and (b) an optional LGPL npm dependency for a desktop 2D finder panel**, loaded as an unmodified, dynamically-imported chunk. Never copy its source into our tree. Record in docs that its LGPL relicense landed in v3.8.0 (older "GPL-3" references are stale).
4. **Adopt a Gaia-Sky-inspired octree chunk format for the DR3 flythrough**, re-specified for the web: little-endian, f32, 4-byte aligned, names externalized; document our format from scratch so it is unambiguously ours.
5. **Hard ban on AGPL/GPL ingestion**: add `Stellarium/stellarium-web-engine`, `Stellarium/stellarium`, and `CelestiaProject/Celestia` to a "do-not-copy" list in the contributor guide; any AI-assisted coding must not be prompted with their source.
6. **Use service APIs directly** (SIMBAD/VizieR TAP, CDS Sesame, hips2fits at `alasky.cds.unistra.fr`) instead of wrapping libraries; add the `alaskybis` mirror as fallback.
7. **License our own app MIT (or Apache-2.0)** — nothing in the chosen reuse plan prevents it.
8. For ephemerides, evaluate `astronomy-engine` (npm) first; do not derive planet math from SWE/Stellarium.

## Open questions

1. **Aladin Lite LGPL scope of the WASM core**: does CDS consider the Rust crates (`cdshealpix`, `mapproj`) separately licensed (possibly more permissive)? If `cdshealpix` is Apache/MIT, porting HEALPix math from it (rather than from Aladin Lite proper) would be cleaner. Verify crate licenses on crates.io before any port.
2. **LGPL + bundlers**: our "separate dynamic chunk" pattern for aladin-lite is the conservative community interpretation, not settled law. If the finder panel becomes a core feature, get a real legal read or ask CDS (they relicensed specifically to enable embedding — an email would likely clarify intent).
3. **WWT long-term funding**: maintenance is verified-active (June 2026 human commits, npm release 7.36.0 on 2026-06-08) but the bus factor looks small (2 main committers). Re-check before betting on upstream fixes; since we only *copy* MIT code, the risk is low.
4. **Celestia web build source**: locate the actual Emscripten wrapper repo for celestia.mobi/web if we ever want to study a full C++→WASM 3D-universe port (GPL — study only).
5. **ESASky embedding terms**: no explicit ToS found on the JS-API page; confirm ESA usage terms if we ship an ESASky iframe/deep-link in a commercial build.
6. **astronomy-engine license/maintenance** (assumed MIT, not verified here) — verify before adoption.
7. **VirtualSky license**: GitHub API reports no license file; if any of its sky-culture data is wanted, ask the author (Stuart Lowe) or skip.
8. **Rubin/LSST HiPS availability**: out of scope of this survey; track separately (Rubin first-look HiPS may be served via RSP with auth — affects feature 4 timeline).
