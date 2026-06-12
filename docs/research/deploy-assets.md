# Research: Hosting & Asset-Serving Strategy for the WebXR Astronomy App

```yaml
topic: Static hosting, large binary catalog serving, compression, caching, CDN strategy, CI
date: 2026-06-11
author: research agent (web-verified June 2026)
confidence:
  hosting_limits: HIGH — taken from official docs fetched 2026-06-11
  compression_ratios: MEDIUM — mechanism verified, exact ratios on Gaia data must be benchmarked
  cds_hotlinking: MEDIUM-HIGH — intended-usage inferred from official Aladin Lite embedding docs;
    no explicit written "hotlinking OK" policy found, email cds-question@unistra.fr to confirm
  browser_storage_quotas: HIGH for Chrome/Firefox, MEDIUM for Safari (numbers move between releases)
scope: documentation-only blueprint; no app code exists yet
```

---

## 1. TL;DR recommendation

**Cloudflare Pages (app shell + small assets) + Cloudflare R2 behind a custom domain (catalog
chunks) + hotlinked CDS HiPS tiles + GitHub Actions CI.** Total cost at hobby scale: **$0/month**
(R2 free tier covers 10 GB storage and all egress). Growth path: same architecture scales to paid
R2 ($0.015/GB-month, egress always free) with zero re-architecture. Details in §10.

---

## 2. Static hosting options — VERIFIED limits (June 2026)

### 2.1 GitHub Pages
Source: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
and https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github

- **VERIFIED:** Published sites "may be no larger than 1 GB"; source repos have a *recommended*
  1 GB limit.
- **VERIFIED:** Soft bandwidth limit of **100 GB/month**; soft limit of 10 builds/hour (does not
  apply when deploying via custom GitHub Actions workflow); deployments time out at 10 minutes.
- **VERIFIED:** Git blocks files **> 100 MiB** (warning at 50 MiB); browser uploads capped at
  25 MiB. So catalog chunks committed to the repo must each be < 100 MiB (keep them ≤ 50 MiB
  to avoid warnings) — fine for our 4–16 MB chunk design, but the 1 GB total site cap is the
  real ceiling for a 100 MB–1 GB catalog.
- **VERIFIED:** No custom HTTP headers possible (no COOP/COEP, no Cache-Control control). See §6.
- **VERIFIED:** HTTP Range requests mostly work but GitHub's CDN gzip-encodes some responses,
  which breaks Range/Content-Length semantics for non-standard binary files
  (https://github.com/phiresky/sql.js-httpvfs and
  https://github.com/orgs/community/discussions/162857). Another reason to pre-chunk (§3).
- **VERIFIED:** GitHub **Releases** have no total-size or bandwidth limit and individual release
  assets can be large (per the large-files doc) — a legitimate free escape hatch for hosting
  catalog chunks, but no Cache-Control control and unfriendly URLs. Treat as backup only.

### 2.2 Cloudflare Pages (+ R2)
Sources: https://developers.cloudflare.com/pages/platform/limits/ ,
https://developers.cloudflare.com/r2/pricing/ ,
https://developers.cloudflare.com/r2/buckets/public-buckets/

- **VERIFIED (Pages):** Max **25 MiB per file**; **20,000 files/site** on free (100,000 on paid,
  raised Jan 2026); 500 builds/month free; 1 concurrent build; 20-minute build timeout.
  **No documented bandwidth limit** on Pages static assets.
- **VERIFIED (Pages):** Custom headers via a `_headers` file in the build output (max 100 rules,
  2,000 chars/line, splat/placeholder patterns) —
  https://developers.cloudflare.com/pages/configuration/headers/
- **VERIFIED (R2 free tier):** 10 GB-month storage, 1M Class A (write) ops/month, 10M Class B
  (read) ops/month, **$0 egress for all storage classes and access paths**.
  Paid: $0.015/GB-month storage, $4.50/M Class A, $0.36/M Class B, egress still free.
- **VERIFIED (R2 public access):** the `r2.dev` subdomain "is rate-limited and should only be
  used for development purposes"; production requires a **custom domain** on the bucket, which
  also enables Cloudflare Cache/Cache Rules in front of R2.
- Implication: 25 MiB Pages file limit means catalog chunks > 25 MiB cannot live in the Pages
  bundle — put all chunks in R2 regardless of size to keep deploys fast and the bundle small.

### 2.3 Netlify
Sources: https://www.netlify.com/pricing/ , https://netli.fyi/blog/netlify-pricing-and-limits

- **VERIFIED (changed 2026):** Netlify moved to **credit-based pricing**. Free plan = 300
  credits/month shared across all usage; bandwidth bills at 20 credits/GB since 2026-04-14,
  i.e. roughly **15 GB/month** of bandwidth if credits go to nothing else. This is a major
  regression vs. the old 100 GB free tier — **Netlify is no longer competitive for this
  project** (a single user pulling a 300 MB catalog ≈ 6 GB across 20 sessions).
- Supports `_headers` file and per-path Cache-Control (same syntax family as Cloudflare Pages).

### 2.4 Vercel
Sources: https://vercel.com/docs/limits , https://vercel.com/docs/plans/hobby

- **VERIFIED:** Hobby plan: **100 GB/month bandwidth** (capped, not overage-billed), 1 concurrent
  build, non-commercial use only.
- Headers configurable via `vercel.json` (`headers` key). Works, but the bandwidth cap and
  non-commercial restriction make it equivalent-or-worse vs. Cloudflare for this use case.

### 2.5 Object storage + CDN (S3 / Backblaze B2)
Sources: https://www.backblaze.com/cloud-storage/pricing ,
https://www.backblaze.com/blog/backblaze-and-cloudflare-partner-to-provide-free-data-transfer/

- **VERIFIED (B2):** **$6/TB/month** ($0.006/GB) storage; free egress up to **3× average monthly
  storage**, then $0.01/GB; **unlimited free egress through Bandwidth Alliance partners**
  including Cloudflare, Fastly, bunny.net. So B2 origin + free Cloudflare proxy = ~$0.006/GB-month
  total at hobby scale (a 1 GB catalog ≈ $0.006/month).
- AWS S3 (for comparison, standard us-east-1, stable for years): ~$0.023/GB-month storage +
  **$0.09/GB egress** after 100 GB/month free (free tier raised in 2024). Egress pricing makes
  S3+CloudFront strictly worse than R2 or B2+Cloudflare for public static data. UNVERIFIED
  exact 2026 S3 numbers — but the order-of-magnitude egress disadvantage is structural.
- Verdict: R2 (simpler, same vendor as Pages) or B2+Cloudflare (cheapest per GB at scale).

---

## 3. HTTP Range requests vs. pre-chunked files → **pre-chunk**

- Range requests work on R2/S3/B2 and (mostly) GitHub Pages, but:
  - **VERIFIED:** transparent gzip on some hosts (GitHub Pages) breaks Range + Content-Length
    (see sql.js-httpvfs issues above). `Content-Encoding` and `Range` are fundamentally awkward
    together — you can't range into a compressed stream.
  - CDN edge caches handle ranges inconsistently (some fetch the whole object, some don't cache
    partial responses); pre-chunked whole-file GETs are always cacheable.
  - Cache API in the service worker stores whole responses; partial responses (206) are not
    storable in the Cache API per spec.
- Pre-chunked files give you: per-chunk compression, per-chunk integrity hashes, trivial SW
  caching, dumb-host compatibility, and natural progressive-loading units.
- **Recommended chunking scheme (design, UNVERIFIED/benchmark):** magnitude-sorted +
  spatially-bucketed chunks, target **2–8 MB compressed** each (good HTTP/2 multiplexing
  granularity; ~50–300 chunks for 100 MB–1 GB total). Name chunks by content hash for
  immutable caching: `catalog/v3/mag00-65_l0_a1b2c3.bin`.

---

## 4. Compressing Float32 star data

### 4.1 What hosts will compress for you — and why that's irrelevant here
- **VERIFIED:** Cloudflare's automatic brotli/gzip applies only to a whitelist of content types
  (text/html, application/json, etc.); **`application/octet-stream` is NOT compressed**.
  Zstd is opt-in via Compression Rules.
  https://developers.cloudflare.com/speed/optimization/content/compression/
- Conclusion: binary catalog chunks will be served as-is. Either (a) pre-compress and decompress
  client-side, or (b) make the binary format small enough that wire compression barely matters.

### 4.2 Raw float32 compresses badly — quantize first
- Raw float32 coordinates have high-entropy mantissa bits; gzip/brotli typically save only
  **~5–15%** on float32 XYZ streams (UNVERIFIED exact ratio for Gaia — benchmark, but this is
  well-established for point clouds; brotli "usually does not beat bz2 or xz" on binary data per
  https://github.com/google/brotli docs ecosystem).
- **Quantization (recommended):**
  - Position: store as **int16 (or int21-packed) offsets within a spatial cell** — for a
    flythrough star field, 16-bit quantization within an octree/HEALPix cell gives sub-arcsecond
    angular and <0.01 pc positional error at typical cell sizes. 50% size cut before any codec.
  - Magnitude/color: uint8 (mag × 10 over a clamped range) — astronomically lossless for
    rendering purposes.
  - Then **delta-encode within a chunk after sorting by Morton/HEALPix index** — deltas of
    sorted quantized values are small integers, which brotli/gzip model extremely well.
  - Expected pipeline result (UNVERIFIED, benchmark in preprocessing repo): float32 baseline
    16 B/star (xyz+mag) → quantized 7–8 B/star → after delta+brotli **~4–6 B/star**, i.e.
    ~3× smaller than raw float32. meshoptimizer's vertex codec
    (https://github.com/zeux/meshoptimizer, also available as the `meshoptimizer` npm/wasm
    package used by glTF `EXT_meshopt_compression`) implements exactly this
    quantize→delta→entropy pattern and is a ready-made option.
- **Client-side decompression — VERIFIED:** `DecompressionStream` supports `gzip`, `deflate`,
  `deflate-raw` universally; **brotli was added to the Compression Streams spec and MDN lists
  it as of 2026** (https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream),
  but it's recent — Firefox tracked it in bugzilla #1921583. **Ship `.bin.gz` decoded via
  `new DecompressionStream('gzip')` as the baseline** (works everywhere, zero JS), feature-detect
  brotli at runtime:
  ```ts
  let canBrotli = false;
  try { new DecompressionStream('brotli' as any); canBrotli = true; } catch {}
  const url = `${base}/${chunk}.bin.${canBrotli ? 'br' : 'gz'}`;
  const buf = await new Response(
    (await fetch(url)).body!.pipeThrough(new DecompressionStream(canBrotli ? 'brotli' : 'gzip'))
  ).arrayBuffer();
  ```
  (Avoid relying on `Content-Encoding: br` for octet-stream from R2/Pages — explicit
  extension + client decode is host-agnostic and SW-cache-friendly.)

---

## 5. HTTPS requirements

- **VERIFIED:** WebXR is **secure-context only** — `navigator.xr` does not exist on insecure
  origins (https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Permissions_and_security,
  https://www.w3.org/TR/webxr/). `http://localhost` counts as secure for dev.
- All hosts considered (GitHub Pages, Cloudflare Pages, Netlify, Vercel, R2 custom domain) serve
  HTTPS by default — no action needed beyond "don't disable it".
- Vite dev server on localhost is fine; for LAN testing on a phone/headset use
  `vite --host` + `@vitejs/plugin-basic-ssl` or a tunnel (Cloudflare Tunnel / `cloudflared`).

---

## 6. SharedArrayBuffer / cross-origin isolation (COOP/COEP)

Needed only if we later use **threads in WASM, wasm-SIMD multi-threaded builds, or SAB-backed
worker pipelines**. Plain workers + `postMessage(ArrayBuffer, [transfer])` do **not** need this.

- **VERIFIED:** SAB requires cross-origin isolation: `Cross-Origin-Opener-Policy: same-origin`
  + `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)
  (https://web.dev/articles/coop-coep).
- **CRITICAL TRADE-OFF:** with COEP `require-corp`, every cross-origin subresource (i.e. **CDS
  HiPS tiles, hips2fits cutouts**) must send `Cross-Origin-Resource-Policy: cross-origin` or be
  CORS-loaded with `crossorigin` attribute / `mode: 'cors'`. CDS serves tiles with permissive
  CORS (Aladin Lite works from any origin), so `fetch(url, {mode:'cors'})` +
  `COEP: credentialless` is the safer combo — but **test before enabling**. Do NOT enable
  COOP/COEP speculatively; it's an additive change later.
- Per-host header support — VERIFIED:
  - GitHub Pages: **impossible natively**; only workaround is the `coi-serviceworker` hack
    (https://github.com/orgs/community/discussions/13309,
    https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/) —
    a SW that injects the headers, requiring a first-visit reload. Works but ugly.
  - Cloudflare Pages / Netlify: `_headers` file:
    ```
    /*
      Cross-Origin-Opener-Policy: same-origin
      Cross-Origin-Embedder-Policy: credentialless
    ```
  - Vercel: `vercel.json` → `{"headers":[{"source":"/(.*)","headers":[...]}]}`.
- This is a strong argument for Cloudflare Pages over GitHub Pages even though we don't need
  SAB on day one.

---

## 7. Service worker caching strategy

### 7.1 Quotas — VERIFIED (https://web.dev/articles/storage-for-the-web)
- **Chrome:** an origin may use up to **60% of total disk**; eviction is LRU-by-origin under
  pressure.
- **Firefox:** up to **50% of free disk**, max **10 GiB per eTLD+1 group** (web.dev text fetched
  says "2GB per group" for older versions — treat 2 GiB as the safe floor).
- **Safari:** ~**1 GB**, prompting in 200 MB increments; **7-day cap on all script-writable
  storage for non-installed web apps** — Safari may wipe the entire cache if the user doesn't
  visit for a week. Installed PWAs are exempt.
- Use `navigator.storage.estimate()` to read quota/usage and `navigator.storage.persist()` to
  request persistence (auto-granted in Chrome under engagement heuristics; prompts in Firefox).

### 7.2 Recommended strategy (design)
Use Workbox (v7.x as of 2026) or a small hand-rolled SW with three named caches:

```ts
// sw.ts — conceptual
// 1. App shell: precache (build-hashed JS/CSS/HTML) — cache-first, cleaned on activate.
// 2. Catalog chunks (same-origin or R2 custom domain, content-hashed filenames):
//    CacheFirst, no expiry needed (immutable), but enforce a size budget:
const CATALOG_CACHE = 'catalog-v3';        // bump on format change
// 3. HiPS tiles (cross-origin CDS):
//    CacheFirst with maxEntries ~2000 + maxAgeSeconds ~30 days (tiles are immutable in
//    practice but surveys can be regenerated). MUST cache only CORS responses, not opaque
//    ones — opaque responses are quota-padded (Chrome charges ~7 MB each). Fetch tiles with
//    { mode: 'cors' }; CDS sends Access-Control-Allow-Origin: *.
```
- **Pitfall (VERIFIED behavior, widely documented):** caching `no-cors`/opaque responses
  explodes quota usage in Chrome. Always CORS-fetch HiPS tiles before caching.
- Don't precache catalog chunks — runtime-cache them as the user actually streams them.
- Set on the host: `Cache-Control: public, max-age=31536000, immutable` for hashed chunks and
  app assets; `Cache-Control: no-cache` for `index.html` and the chunk manifest JSON.
  On Cloudflare Pages via `_headers`; on R2 via Cache Rules or object metadata
  (`Cache-Control` can be set per-object at upload: `wrangler r2 object put ... --cache-control`).

---

## 8. Third-party HiPS tiles — do NOT proxy CDS

- **VERIFIED (intended usage):** Aladin Lite is explicitly designed to be "easily embeddable on
  any web page", loading HiPS tiles directly from CDS servers from third-party origins; the only
  stated condition is keeping the Aladin logo/link when embedding Aladin Lite itself
  (https://aladin.cds.unistra.fr/AladinLite/doc/). No API keys, no documented rate limits.
  Direct tile fetching by independent clients is the *purpose* of the IVOA HiPS standard
  (https://www.ivoa.net/documents/HiPS/) — clients compute tile URLs
  (`{base}/Norder{N}/Dir{D}/Npix{P}.{ext}`) and fetch them directly.
- **VERIFIED (mirroring policy):** the CDS `hipslist` states you should **not mirror a HiPS
  without the copyright owner's agreement**, and never mirror `unclonable` HiPS
  (http://alasky.u-strasbg.fr/hipslist). Hotlinking ≠ mirroring: hotlinking is fine, wholesale
  re-hosting requires permission.
- **VERIFIED endpoints:** primary `https://alasky.cds.unistra.fr/`, mirror
  `https://alaskybis.cds.unistra.fr/` — implement client-side failover between the two.
  Example DSS2 color tile:
  `https://alasky.cds.unistra.fr/DSS/DSSColor/Norder3/Dir0/Npix271.jpg`
- **VERIFIED (hips2fits):** cutout service at
  `https://alasky.cds.unistra.fr/hips-image-services/hips2fits` (mirror on alaskybis); params
  `hips`, `width`, `height`, `projection`, `fov`, `ra`, `dec` (or `object`), `format`
  (fits|jpg|png), `stretch`, `cmap`; hard cap **width×height ≤ 50 Mpixels**; no documented rate
  limit — be polite, cache results in the SW.
- Do not put our caching CDN in front of CDS (that *is* proxying/mirroring); let the browser SW
  cache per-user instead. Credit CDS/survey providers in the UI (standard practice; HiPS
  `properties` files carry `obs_copyright` strings to display).
- UNVERIFIED: explicit written CDS terms for tile hotlinking volume. For a hobby app, accepted
  practice; if the app grows large, email cds-question@unistra.fr (per
  https://aladin.cds.unistra.fr/hips/) and ask — they historically encourage usage.

---

## 9. Progressive loading UX (design guidance, UNVERIFIED — standard practice)

1. **Manifest first:** `catalog/v3/manifest.json` (~10 KB) lists chunks with {id, magRange,
   cell, byteLength, url, sha256}. `no-cache` so updates propagate.
2. **Bright-stars-first:** chunk 0 = all stars with G < 6.5 (~9k stars, naked-eye sky, <200 KB)
   — fetch in parallel with the Three.js scene init so *something* renders in <1 s.
3. **Magnitude tiers as LOD:** G<6.5 → G<9 → G<12 → … Each tier is split spatially (HEALPix
   order 2–3 cells or octree nodes). Camera position/frustum decides which spatial cells of
   which tier to fetch next; a priority queue with 4–6 concurrent fetches (HTTP/2 makes more
   connections pointless).
4. **Flythrough depth streaming:** for 3D mode, octree on parallax-derived distance; load
   children of nodes the camera approaches; drop far nodes' GPU buffers but keep them in the SW
   cache.
5. **UI affordances:** progress ring with "12,041 / 1.8M stars", star-count quality toggle for
   mobile/data-saver (`navigator.connection.saveData` → stop at G<9), and a "download full
   catalog for offline" button that bulk-fills the SW cache after `storage.persist()`.

---

## 10. CI/CD

### 10.1 GitHub Actions → Cloudflare Pages (recommended)
Either connect the repo in the Cloudflare dashboard (zero-config git integration, 500
builds/month free), or keep CI in GitHub Actions for control:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on: { push: { branches: [main] }, workflow_dispatch: {} }
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read, deployments: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts/*, cache: npm }
      - run: npm ci
      - run: npm run build        # vite build → dist/ (includes _headers)
      - run: npm test --if-present
      - name: Deploy to Cloudflare Pages
        run: npx wrangler pages deploy dist --project-name=star-atlas
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
Catalog chunks are NOT in this repo/build — upload once (or on catalog regeneration) via
`npx wrangler r2 object put star-catalog/v3/<chunk> --file=... --cache-control="public, max-age=31536000, immutable"`
or `rclone sync` to the R2 S3 endpoint.

### 10.2 GitHub Actions → GitHub Pages (fallback, VERIFIED from https://vite.dev/guide/static-deploy)
Official Vite workflow: `actions/checkout` → `actions/setup-node` → `npm ci && npm run build` →
`actions/configure-pages` → `actions/upload-pages-artifact (path: ./dist)` →
`actions/deploy-pages`, with `permissions: { pages: write, id-token: write }` and
`base: '/<REPO>/'` in `vite.config.ts` for project pages.

---

## 11. Concrete recommended setup (hobby → growth)

| Layer | Choice | Why |
|---|---|---|
| App shell | **Cloudflare Pages** (free) | No bandwidth cap, `_headers` for COOP/COEP + Cache-Control, 25 MiB/file is fine for JS/CSS/textures |
| Catalog chunks | **Cloudflare R2, custom domain** e.g. `data.starapp.example` | $0 egress forever, 10 GB free storage, Cloudflare cache in front, CORS configurable on bucket |
| HiPS imagery | **Hotlink CDS alasky/alaskybis** with SW caching + client failover | Intended usage; zero cost; never proxy/mirror |
| Cutouts/object info | hips2fits + SIMBAD/VizieR TAP, direct from browser, SW-cached | Same reasoning |
| CI | GitHub repo + Actions + `wrangler pages deploy` | Free, reviewable, secrets-scoped |
| Domain | One cheap apex domain on Cloudflare DNS (~$10/yr) | Required for R2 production access; gives stable origins for CORS/CSP |
| Dev XR testing | localhost (secure context) + Immersive Web Emulator; LAN via `cloudflared` tunnel | No headset needed |

Cost: **$0/month + ~$10/yr domain** up to 10 GB catalog and unlimited traffic.
Growth path: flip R2 to paid (1 GB catalog = $0.015/mo; 100 GB = $1.50/mo; egress stays $0);
Pages free tier has no traffic cliff; nothing re-architected.

---

## 12. Decisions recommended

1. **Host on Cloudflare Pages + R2 custom domain** (not GitHub Pages: 1 GB cap, no headers,
   gzip-vs-Range weirdness; not Netlify: 2026 credit pricing ≈ 15 GB bandwidth; not Vercel:
   100 GB cap + non-commercial clause).
2. **Pre-chunk the catalog (2–8 MB compressed/chunk, content-hashed names, manifest.json);
   do not use HTTP Range requests.**
3. **Quantize before compressing:** int16/uint8 quantization + spatial sort + delta encoding,
   then pre-compressed `.gz` (baseline) decoded via `DecompressionStream('gzip')`; feature-detect
   `'brotli'` streams; evaluate meshoptimizer codec in the preprocessing pipeline. Do not ship
   raw float32 and hope the CDN compresses it — it won't (octet-stream excluded).
4. **Hotlink CDS HiPS directly with `mode:'cors'` fetches; never proxy or mirror; implement
   alasky↔alaskybis failover; display survey copyright strings.**
5. **Service worker from day one:** precache app shell; runtime CacheFirst for chunks
   (immutable) and HiPS tiles (maxEntries+TTL); CORS-only caching (no opaque responses); call
   `navigator.storage.persist()`; document the Safari 7-day eviction so offline mode is sold as
   "Chrome/installed-PWA feature".
6. **Defer COOP/COEP** until SAB/threads are actually needed; when needed, use
   `COEP: credentialless` + CORS-fetching of CDS resources via Pages `_headers` (one more reason
   not to be on GitHub Pages).
7. **CI = GitHub Actions → `wrangler pages deploy`;** catalog uploads to R2 are a separate
   manual/CI job, not part of the app build.
8. Set `Cache-Control: public, max-age=31536000, immutable` on hashed assets/chunks;
   `no-cache` on `index.html` + manifest.

## 13. Open questions

1. **Actual compression ratios on Gaia DR3 data** — benchmark required: raw float32 vs
   int16-quantized vs quantized+delta vs meshoptimizer codec, each × {none, gzip, brotli, zstd}.
   The 3× estimate in §4.2 is informed but unmeasured.
2. **CDS load expectations** — no written hotlinking volume policy found; email
   cds-question@unistra.fr if the app exceeds hobby traffic, and ask whether they prefer the
   alaskybis mirror for programmatic clients.
3. **Brotli `DecompressionStream` shipping matrix** — MDN lists it (April 2026) but
   per-browser/per-version support (esp. Safari, Firefox release channel) must be re-checked at
   implementation time; the gzip fallback removes the risk.
4. **CORS headers on CDS tile servers under `COEP: credentialless`** — confirmed permissive CORS
   in practice (Aladin Lite works cross-origin) but not formally tested against a
   cross-origin-isolated page; runtime test needed before any SAB adoption.
5. **R2 free-tier Class B ops budget** — 10M reads/month is ~330k/day; with SW caching this is
   ample for hobby scale, but heavy chunk counts × users could hit it before bandwidth ever
   matters; Cloudflare cache in front of the custom domain absorbs most reads (cache hits don't
   count as R2 operations) — verify hit ratios after launch.
6. **Quest browser quota behavior** — Meta Quest Browser is Chromium-based; assumed Chrome-like
   storage quotas, unverified on-device (user has no headset; test via emulator won't answer
   this).
7. **Whether Rubin/LSST public HiPS (when released) will be hotlink-friendly or require
   data.lsst.cloud auth** — unknowable now; the layer abstraction should treat HiPS base URLs as
   configurable per-survey with optional auth headers.
