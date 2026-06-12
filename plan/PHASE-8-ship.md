# PHASE 8 — Performance hardening, mobile & v1.0 ship — execution runbook

```yaml
phase: 8
milestone: M8
deliverable: Hit the written performance budgets on every tier, make the phone experience
             first-class, add the service worker + offline shell, deploy to Cloudflare Pages + R2
             with correct cache/security headers and CI, ship the attribution/About page, and run
             the v1.0 release gate (cross-browser + emulated-XR re-verification, licensing audit,
             tag v1.0.0).
depends_on: PHASE-0..7 — this phase ships what they built. Perf work touches the HiPS engine
            (PHASE-2) and star field (PHASE-3); mobile touches input (PHASE-3/6); deploy needs the
            catalog from PHASE-4 and the transient layer from PHASE-7.
feeds: production; the post-v1 backlog (see ROADMAP "Later / post-v1").
design_docs: docs/06-performance.md (budgets — the gate), docs/08-testing.md (CI, regression),
             docs/02-data-sources.md §10 (attribution text), docs/01-architecture.md (offline matrix)
research: docs/research/deploy-assets.md (PRIMARY — hosting, compression, SW, CDS hotlinking, CI;
          all limits live-verified 2026-06-11), docs/research/performance-quest.md
est_effort: 4–7 sessions (folds the perf-hardening milestone and the release gate into one phase)
risk: MEDIUM — no headset on the team (Quest budgets remain assertions-by-construction until a
      device exists; see step group 6), and CDS/broker hotlinking-at-scale etiquette (steps 4, 7).
```

> **Performance budgets are a release gate, not a suggestion (docs/06).** The dev-HUD assertions
> added in PHASE-2/3 must hold; this phase is where you actually drive them green on every tier and
> wire the frame-time governor that keeps them green on weaker hardware.

> **$0/month is the target architecture (deploy research §11):** Cloudflare Pages (app shell) +
> Cloudflare R2 custom domain (catalog chunks) + **hotlinked** CDS HiPS tiles (never proxied/
> mirrored) + GitHub Actions CI. One ~$10/yr domain. Do not put a CDN in front of CDS — that *is*
> mirroring (deploy research §8).

---

## Step group 1 — Performance hardening (drive the budgets green)

Realizes docs/06-performance.md + the budget tables already asserted in PHASE-2 §17 / PHASE-3 §B7.

### 1.1 Enforce, don't hope

Turn the dev-HUD `console.warn`-on-breach (PHASE-2/3) into a **dev-build assertion** that fails a
test scene if any budget is exceeded for >1% of frames. Budgets (desktop / Quest 2 columns):
- Sky: ≤ 4 draw calls; tile pool 128 layers (Quest 2) / 384 (desktop); 1 upload/frame (VR).
- Stars: ≤ 48 draw calls (Quest 2) / ≤ 128 (desktop); ≤ 300 k points (Quest 2) / ≤ 2 M (desktop);
  ≤ 5 k impostors.
- JS frame time: ≤ 4 ms (Quest 2) / governed to hold 60 fps p95 desktop.

### 1.2 Zero-allocation audit (both engines)

Combined 30 s idle + flight + pan allocation capture (Chrome allocation timeline) → flat line. Fix
any per-frame `new`/spread/closure (the usual offenders: `Euler`/`Vector3` in the loop, array
literals, `.map` in `update`). PHASE-1 §4 already flagged the `LookControls` Euler — confirm it's
hoisted.

### 1.3 Frame-time governor

`src/core/frameGovernor.ts`: rolling p95 frame time → escalation ladder (docs/06):
1. drop `renderer.xr.setFramebufferScaleFactor` / desktop `setPixelRatio` toward 1.0;
2. raise star `THETA_LOD` (fewer chunks) and sky `biasOrders` (coarser tiles);
3. in XR, request 72 Hz via `updateTargetFrameRate(72)` (feature-detected).
Hysteresis so it doesn't oscillate. Expose the current tier in the HUD.

### 1.4 Texture/compression confirm

- HiPS tile pool already uses `TEXTURE_2D_ARRAY` (PHASE-2 §9.1) → ≤ 4 sky draw calls: verify.
- KTX2 pre-encode **only** for self-hosted static textures (sprite sheets, any baked low-order base
  sky) — **never** for live CDS HiPS tiles (deploy research §11). Add the KTX2 loader only if a
  self-hosted texture actually needs it.

---

## Step group 2 — Mobile first-class

Realizes the ROADMAP mobile deliverables + deploy research §9.5.

### 2.1 Touch + pinch

Extend PHASE-1 `LookControls` / PHASE-3 locomotion to handle touch: one-finger drag = look,
two-finger pinch = FOV zoom (planetarium) / dolly (space mode). `touch-action: none` already set.

### 2.2 Gyro "magic window" (opt-in)

`src/core/deviceOrientation.ts`: vendored DeviceOrientation→camera controller. **iOS requires a user
gesture** to call `DeviceOrientationEvent.requestPermission()` (a button: "Use phone motion"). Under
HTTPS only. Falls back silently to touch if denied/unsupported. (This is the no-WebXR path for iOS
Safari — doc 05 covers the permission flow.)

### 2.3 Data-saver tier

`navigator.connection.saveData === true` → cap the star catalog at the bright tier (e.g. stop
streaming past G<9) and clamp HiPS max order; show a "data saver on" chip with an override. Progress
ring "12,041 / 1.8M stars" (deploy research §9.5).

---

## Step group 3 — Service worker + offline shell

Realizes deploy research §7. Use Workbox 7.x or a small hand-rolled SW with three named caches.

```ts
// sw.ts — three caches (deploy research §7.2)
// 1. App shell: precache build-hashed JS/CSS/HTML, cache-first, cleaned on activate.
// 2. Catalog chunks (R2 custom domain, content-hashed): CacheFirst, immutable, size-budgeted.
// 3. HiPS tiles (cross-origin CDS): CacheFirst, maxEntries ~2000, maxAge ~30d.
//    CORS-ONLY: fetch tiles {mode:'cors'} and cache only non-opaque responses
//    (opaque responses pad Chrome quota ~7MB each — deploy research §7.2 pitfall).
```

- Do **not** precache catalog chunks — runtime-cache as streamed.
- `navigator.storage.persist()` on first interaction; read `storage.estimate()` for a usage meter.
- **Document the Safari 7-day eviction** (deploy research §7.1): sell offline as a
  "Chrome / installed-PWA" feature, not a universal guarantee.
- Cache headers (set on the host, step 4): `public, max-age=31536000, immutable` for hashed
  assets/chunks; `no-cache` for `index.html` + `manifest.json`.

---

## Step group 4 — Hosting + deploy (Cloudflare Pages + R2)

Realizes deploy research §2.2, §10, §11.

### 4.1 `_headers` (Pages build output)

```
/*
  X-Content-Type-Options: nosniff
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: no-cache
```

(Defer COOP/COEP — only needed for SAB/threads, which v1 doesn't use; deploy research §6.)

### 4.2 R2 catalog bucket

- Create bucket `star-catalog`; **custom domain** `data.<yourdomain>` (never `r2.dev` in prod —
  rate-limited; deploy research §2.2). Configure CORS on the bucket to allow the app origin.
- Upload chunks (from PHASE-4 output) with cache headers:
  `wrangler r2 object put star-catalog/gaiadr3/<chunk> --file=... --cache-control="public, max-age=31536000, immutable"`.
  This is a **separate job from the app build** (deploy research §10.1). Point the runtime
  manifest base URL at `https://data.<yourdomain>/gaiadr3/`.

### 4.3 CI

`.github/workflows/deploy.yml` — copy the Cloudflare Pages workflow **verbatim from deploy research
§10.1** (checkout → setup-node → `npm ci` → `npm run build` → `npm test` → `wrangler pages deploy
dist`). Add a `ci.yml` that runs `typecheck + lint + vitest + build` on PRs (docs/08). Secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

> Fallback host (deploy research §10.2): GitHub Pages via the official Vite workflow — but it has a
> 1 GB site cap, no custom headers, and gzip-vs-Range weirdness; only if Cloudflare is unavailable.

---

## Step group 5 — Attribution / About page (MANDATORY)

Realizes README "Attribution is mandatory" + doc 02 §10 + each provider's terms. A reachable About
panel must credit (exact strings from the manifests/properties):

- **DSS2:** STScI acknowledgment.
- **ESA/Gaia/DPAC:** "CC BY-SA 3.0 IGO" (the star chunks).
- **Distances:** "Bailer-Jones et al. 2021 (AJ 161, 147)".
- **Bright stars/names:** "ATHYG v3.3, astronexus.com, CC BY-SA 4.0".
- **Rubin First Look:** ODbL-1.0, "RubinObs/NOIRLab/SLAC/NSF/DOE/AURA".
- **CDS services** (HiPS, hips2fits, SIMBAD, VizieR, Sesame, MocServer); **brokers** (ALeRCE, Fink).
- Each HiPS survey's live `obs_copyright` string (already shown in the survey footer from PHASE-2 §10.2).

The UI must display `obs_copyright` from `properties` (not hard-coded) so it stays correct per
survey.

---

## Step group 6 — Quest on-device validation (hardware-gated — VERIFY)

Realizes ROADMAP M6 "on-device" + the standing "no headset" constraint.

The team has **no headset**, so every Quest number is an assertion-by-construction until a device
exists. When a Quest 2/3S becomes available (loaner / device cloud), measure and record:
`ALIASED_POINT_SIZE_RANGE`, real texture-memory ceiling (allocate pool layers until context loss →
finalize the 128/192 numbers), `texSubImage3D` cost (finalize uploads/frame), `updateTargetFrameRate`
behavior, foveation effect on star sharpness, 30-min soak at order ≤ 9 holding 72 Hz. Until then, v1
ships labeled **"VR (emulator-verified)"** and these stay open in docs/DECISIONS.md. **Do not block
the v1.0 tag on hardware** — ship desktop/mobile/emulated-XR; flip the Quest criteria to "met" when
measured.

---

## Step group 7 — v1.0 release gate (cross-cutting re-verification)

Realizes the ROADMAP M8 release checklist. Re-run **on the production URL** (not localhost):

### 7.1 Acceptance re-run

Every PHASE-1…7 acceptance table, on the deployed build, across **Chrome, Firefox, Safari, Android
Chrome, iOS Safari, + Immersive Web Emulator**. Zero console errors on all. Cold-cache Lighthouse
performance pass meets the load targets (sky interactive < 3 s on fast-3G throttle).

### 7.2 Licensing audit

- Visible credits page satisfies every provider's terms (step 5).
- **Resolve the Gaia (CC BY-SA 3.0 IGO) + ATHYG (CC BY-SA 4.0) ShareAlike question on the mixed
  binary bundle** (doc 04 D#3): publish the catalog chunks under CC BY-SA with a `LICENSE` file
  shipped alongside the data on R2; document the decision in docs/DECISIONS.md; a legal read before
  any *commercial* use.
- Repo license check: **no GPL/AGPL/LGPL code** copied (Aladin Lite, Stellarium Web Engine are
  reference-only; only WWT/OpenSpace MIT are copy-from sources — README "How to start" rule #5).

### 7.3 Failure-state matrix (doc 01 offline matrix)

Verify graceful states for: CDS down (sky degrades to last cache / clear message), broker down
(PHASE-7 "stream unavailable"), R2 unreachable (stars absent, sky still works), WebGL context-loss
recovery (re-upload from CPU LRU). User-facing help/about page present. Freeze the deep-link URL
schema.

### 7.4 Production config + tag

- Custom domain on Pages; R2 custom domain; `curl -I` confirms immutable cache headers on a chunk
  and `no-cache` on `index.html`/manifest.
- SW version-bump discipline documented (bump `CATALOG_CACHE` name on format change).
- Tag `v1.0.0`; archive a reproducibility bundle (pipeline input hashes, `pnpm-lock.yaml` +
  `requirements.lock.txt`, survey registry snapshot, the exact ADQL + `sourceRowCount`).

---

## Acceptance tests (phase / v1.0 exit)

| # | Action | Expected |
|---|---|---|
| 1 | Desktop, 4-year-old mid-range laptop | 60 fps p95 in both sky and flythrough modes; cold load to interactive sky < 3 s on fast-3G throttle. |
| 2 | Mid-range Android phone | 30+ fps; gyro mode aligns with touch mode; iOS permission flow works under HTTPS. |
| 3 | Immersive Web Emulator | Frame loop holds 90 Hz-equivalent timing headroom on the dev machine; draw calls / texture memory within Quest 2 budget columns. |
| 4 | Second visit, airplane mode (Chrome) | Sky + bright stars render from SW cache; clear messaging for anything not cached. |
| 5 | Production URL, all 5 browsers + emulator | Every PHASE-1…7 acceptance criterion passes; **zero console errors** anywhere. |
| 6 | Credits page | Satisfies DSS2 / Gaia / Bailer-Jones / ATHYG / Rubin / CDS / broker terms; per-survey `obs_copyright` shown live. |
| 7 | `curl -I` a chunk and index.html | `immutable` on the chunk; `no-cache` on index.html + manifest. |
| 8 | License check CI step | No GPL/AGPL/LGPL code in the repo; passes. |
| 9 | Lighthouse (cold cache) | Performance pass meets the M-load targets. |
| 10 | Tag + reproducibility bundle | `v1.0.0` tagged; bundle restorable to a byte-stable catalog. |
| 11 | *(hardware-gated)* Real Quest 2/3 | Sky 72/90 Hz, flythrough within point budget — **explicitly tracked as open until a device exists** (step 6); not a v1.0 blocker. |

## Exit state

A deployed, $0/month, attributed, offline-capable v1.0 of the app: real-imagery sky, real-distance
3D flythrough, object info/search, and the live Rubin transient layer — running on desktop, mobile,
and emulated VR, with Quest on-device sign-off the one explicitly-deferred item pending hardware.

## VERIFY ledger carried out of this phase

1. Gaia+ATHYG ShareAlike on the mixed bundle (doc 04 D#3) — **resolved here** (step 7.2) with a shipped LICENSE + documented decision.
2. All Quest on-device numbers (step 6) — open until hardware; v1 ships "emulator-verified".
3. Brotli `DecompressionStream` support matrix (deploy research §13 #3) — gzip baseline removes risk; enable `.br` only when re-verified.
4. R2 free-tier Class-B ops vs Cloudflare cache hit ratio (deploy research §13 #5) — verify after launch.
5. CDS hotlinking volume etiquette (deploy research §13 #2) — email cds-question@unistra.fr if traffic exceeds hobby scale.
