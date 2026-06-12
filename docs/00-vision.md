# 00 — Product Vision

```yaml
doc: 00-vision
status: stable (planning phase)
date: 2026-06-11
audience: implementing AI / contributors — read after plan/AGENT_INSTRUCTIONS.md
```

## 1. One-paragraph pitch

A free, browser-based window onto the **real** universe. Not an artist's impression, not a game
skybox: every pixel of sky is actual survey photography (DSS2, Pan-STARRS, SDSS, 2MASS, Rubin),
every star in the 3D flythrough sits at its measured Gaia DR3 distance, and the "what changed
tonight" layer shows genuine Rubin Observatory alerts from the world-public LSST alert stream. It
opens instantly as a normal web page on any laptop or phone, and the same page becomes a
planetarium-grade immersive experience when a WebXR headset says "Enter VR".

## 2. Target users

In priority order (v1 optimizes for the first two):

1. **Curious space enthusiasts on desktop/laptop** — people who watch astronomy YouTube, saw the
   Rubin "First Look" press images, and want to *explore* rather than read. They have a mouse, a
   mid-range GPU, and zero tolerance for installs or sign-ups.
2. **Educators and science communicators** — need a sharable URL that drops a class directly into a
   view ("here is the Crab Nebula in three surveys; now fly to the Pleiades and watch the parallax").
   Deep linking to a target/survey/mode is a first-class requirement.
3. **VR owners (Quest-class headsets)** — get the same app as an immersive planetarium and star
   flythrough. VR is an *additive* mode: no feature may exist only in VR.
4. **Amateur astronomers** — use the object-info layer (SIMBAD types, magnitudes, hips2fits
   cutouts) and the transient layer as a lightweight "what's new in the sky" dashboard. They are a
   secondary audience: we do not build observation-planning features for them in v1.
5. **The implementing AI/developer** — an unusual but real "user" of this repo: the documentation
   itself is a product and must stay self-sufficient.

Explicitly **not** target users in v1: professional researchers (they have the RSP, TOPCAT, Aladin
Desktop), and telescope operators (no equipment control — see non-goals).

## 3. The three pillars

### Pillar 1 — The real-imagery sky (HiPS celestial sphere)

The sky you see is photographic. HiPS tiles (IVOA standard, hierarchical HEALPix tiling) stream
from CDS servers onto an inside-out celestial sphere centered on the camera. Starter surveys (all
live-verified, CORS-open, base URLs in [02-data-sources.md](02-data-sources.md)):

- **DSS2 color** — default full-sky base layer (order 9).
- **Pan-STARRS DR1 color** — the "deep zoom" layer (order 11, 78% of sky).
- **SDSS9 color**, **2MASS color (JHK)** — alternative wavelength views.
- **Mellinger color** — wide-field "pretty Milky Way" at low zoom (galactic frame).
- **Rubin First Look** (`CDS/P/Rubin/FirstLook`) — ~29 deg² of real LSSTCam imagery at order 12
  (~100 mas/px), the app's Rubin showcase until public Rubin data releases exist (~2029, see
  [ROADMAP](../ROADMAP.md)).

User experience: instant low-res sky (one `Allsky` file), progressive sharpening as tiles stream,
seamless survey switching, partial-coverage surveys rendered with an explicit coverage boundary
(MOC) — *uncovered sky is shown as honestly empty, never invented*.

### Pillar 2 — The real-distance 3D flythrough (Gaia star field)

Toggle from "sky view" to "space view" and the stars detach from the sphere: each is a 3D point at
its Bailer-Jones distance derived from Gaia DR3 parallax. Two catalog tiers, preprocessed offline
into static binary chunks (live-verified counts):

- **Lite:** G < 11.5, parallax/error > 5 → **1,937,515 stars**, ~31 MB raw (~16 B/star).
- **Full:** G < 12.5, parallax/error > 5 → **4,683,166 stars**, ~75 MB raw.

Stars render with physically-honest photometry (absolute magnitude stored; apparent magnitude
recomputed per frame from camera distance — fly toward a star and it brightens by inverse-square),
blackbody colors from Gaia photometry, and an exposure control. Bright naked-eye stars missing
from Gaia (saturation, G ≲ 3) are patched from ATHYG, which also supplies proper names. The HiPS
imagery sphere fades out beyond ~100 pc from the Sun so its baked-in stars never show false
parallax against the 3D field.

### Pillar 3 — The live transient layer ("what changed tonight")

Rubin Observatory's alert stream is **world-public with no proprietary period** (streaming since
2026-02-24; ~7M alerts/night at full survey). Pixel and catalog data releases are locked behind
data rights until ~2029, but alerts are the genuinely live Rubin product everyone can use today.
The app surfaces them through community broker REST APIs (live-verified anonymous access):
**ALeRCE** (`api-lsst.alerce.online`, primary) and **Fink** (`api.lsst.fink-portal.org`,
secondary). Features: nightly transient markers on the sky, ML classification badges (labeled as
probabilities, not facts), flux→AB-magnitude light curves, and difference-image cutout stamps.

> VERIFY: broker CORS headers were not captured in research; if closed, this pillar runs through a
> thin stateless caching proxy (~15 lines, Cloudflare Worker). That proxy is the only server
> component the entire app may ever need in v1.

## 4. Non-goals for v1 (explicit)

These are out of scope. Do not build them, do not architect speculative hooks for them beyond what
[01-architecture.md](01-architecture.md) specifies.

1. **No exoplanet surfaces or planetary terrain.** No procedural landscapes, no Mars globes, no
   "land on the star" gimmicks. Solar-system ephemerides and planet rendering are entirely post-v1.
2. **No telescope control.** No ASCOM/INDI/Alpaca integration, no GoTo, no observation planning.
3. **No accounts and no stateful backend.** No login, no user profiles, no saved state server-side,
   no database. The app is static files + public third-party APIs. The single permitted exception
   is the optional *stateless* broker caching proxy (Pillar 3), which holds no user data.
4. No simulated/procedural sky content presented alongside real data without labeling (see §6).
5. No multiplayer/social features, no AR mode, no native/store builds (PWA install is fine).
6. No FITS-tile scientific analysis (client-side stretch/colormap of raw pixels) — JPEG/PNG display
   tiles + hips2fits server-side rendering cover v1.
7. No constellation art/sky-culture layers (clean candidate for post-v1; d3-celestial's
   BSD-3-Clause data files are the noted source).
8. No ingestion of GPL/AGPL/LGPL code (Aladin Lite, Stellarium Web Engine, Celestia) — reading for
   algorithms is allowed, copying is banned. See
   [research/existing-projects.md](research/existing-projects.md).

## 5. UX walkthrough

### 5.1 A desktop session

1. **Load (< 2 s to first sky).** The page boots straight into sky view: the DSS2 order-3 Allsky
   preview renders the whole sphere in one request while real tiles stream in. No splash screen, no
   tutorial wall; a small hint overlay ("drag to look, scroll to zoom") fades after first input.
2. **Look around.** Mouse-drag pans (look-around controls — camera at the sphere center), scroll
   zooms. As FOV shrinks past DSS2's resolution, the UI suggests (or auto-switches, user setting)
   Pan-STARRS for deep zoom. Survey picker shows each layer's coverage and attribution.
3. **Ask "what is that?".** Hovering shows coordinates; clicking fires a SIMBAD cone search and
   opens an info card: primary identifier, object type, magnitudes, distance if known, plus a
   hips2fits postage stamp. A search box resolves free-text names ("M 31", "Betelgeuse") via Sesame
   and flies the view there.
4. **Go 3D.** A mode toggle ("Flythrough") pulls the camera off the Earth point: nearby stars gain
   parallax, the imagery sphere gently fades with distance, and WASD/drag (or click-a-star →
   "travel") fly the user to the Pleiades. An exposure slider plays the role of dark adaptation.
   A breadcrumb ("Sun ← 136 pc") and a one-click "return to Earth" keep users from getting lost.
5. **What changed tonight.** A "Tonight" panel lists fresh Rubin transients (filterable by
   class/probability); selecting one centers the sky on it, shows its light curve and cutouts, and
   labels the classifier and its probability explicitly.
6. **Share.** The URL always encodes mode/target/survey/FOV — copy-paste reproduces the view.

### 5.2 A VR session (Quest-class headset)

1. User opens the same URL in the headset browser. The page runs as the normal 2D app first —
   an **Enter VR** button (Three.js `XRButton`) appears only when `navigator.xr` reports support.
2. On entry the scene becomes a seated/standing planetarium (`local-floor` reference space): the
   sky sphere surrounds the user at comfortable scale, head-look replaces mouse-look. Target
   90 Hz on Quest 3, 72 Hz fallback on Quest 2 (frame-rate governor per
   [06-performance.md](06-performance.md)).
3. **Controller ray = mouse.** Pointing at the sky and pulling the trigger does exactly what a
   click does on desktop (same `PointerLike` ray abstraction); the info card renders as an
   in-world `@pmndrs/uikit` panel anchored in comfortable view. Gaze+pinch (transient-pointer
   devices) map onto the same select events.
4. **Flythrough in VR** uses thumbstick locomotion with comfort defaults (slow acceleration,
   optional vignette). Since stars are effectively at infinity until approached, vection is mild;
   any close flyby keeps angular velocities low.
5. Exiting VR returns to the identical 2D view — state never resets between modes.
6. Development reality: with no headset on the team, this whole flow is exercised through the
   Immersive Web Emulator (DevTools "WebXR" tab) and scripted IWER sessions in CI; real-device
   tuning is a tracked task, not an assumption ([ROADMAP](../ROADMAP.md) M6).

### 5.3 Mobile (phone) session

Touch-drag pans, pinch zooms, all info/search/transient features work. An opt-in "look around with
your phone" button enables gyroscope magic-window (gesture-gated
`DeviceOrientationEvent.requestPermission()` on iOS — iOS Safari has **no WebXR** in 2026).
Data-saver users get a reduced star tier and capped tile budget.

## 6. Design principles

1. **Scientific honesty (the prime directive).**
   - *Real data only.* Sky pixels come from named surveys; star positions/brightnesses come from
     Gaia/ATHYG; transients come from named brokers. The app never procedurally invents sky.
   - *Label everything derived, uncertain, or modeled.* Distances are posterior medians — the info
     card says "distance: 412 pc (Bailer-Jones geometric estimate)". Broker classifications display
     classifier name + probability ("SN 0.97 — stamp_classifier_rubin_beta"). If a post-v1 feature
     ever shows a model (e.g., a 3D nebula reconstruction), it must be visibly badged "model".
   - *Honest gaps.* Partial-survey coverage boundaries are drawn; missing data ("no SIMBAD match")
     is stated, not papered over.
   - *Attribution as UI.* Survey/catalog credits (`obs_copyright`, DSS2's STScI acknowledgment,
     ESA/Gaia/DPAC CC BY-SA 3.0 IGO, ODbL for Rubin First Look) are always visible or one tap away.
2. **Desktop-first, VR-additive.** Every feature ships and is testable flat; VR adds presence, not
   capability. No headset is required to develop, review, or use the app.
3. **Abstract by protocol, not by provider.** HiPS layers, TAP/cone lookups, cutout services, and
   transient providers are interfaces with swappable registry entries — a future public Rubin DR
   HiPS must be a one-line registry addition, not an engine change
   ([01-architecture.md](01-architecture.md)).
4. **Static-first, zero-cost, polite.** No backend in v1; static hosting + direct browser calls to
   CDS within etiquette limits (≤5 req/s aggregate, debounced, cached, alaskybis failover). Never
   proxy or mirror CDS tiles; never hammer brokers.
5. **Performance is a feature.** Budgets (frame time, draw calls, texture memory, zero-allocation
   frame loop) are written down in [06-performance.md](06-performance.md) and enforced by dev-build
   assertions; the worst-case target device is Quest 2 at 72 Hz.
6. **Progressive enhancement.** WebXR, Float16Array, `DecompressionStream('brotli')`, WebXR Layers,
   dynamic viewport scaling, webp tiles — all feature-detected with working fallbacks; the baseline
   app works in any evergreen browser over HTTPS.
7. **License hygiene.** The codebase stays permissive: copy only from MIT sources (WWT, OpenSpace),
   clean-room everything else from specs and our research docs; track data-attribution obligations
   (CC BY-SA for Gaia/ATHYG-derived chunks) explicitly.

## 7. What success looks like (v1)

- A first-time desktop visitor sees a real sky in under 2 seconds and finds out what an object is
  in under 10 seconds, with zero sign-up.
- The 1.9M-star lite flythrough holds 60 fps on a mid-range laptop; the sky mode holds 60 fps even
  on modest hardware.
- "Enter VR" works on a Quest without any code path the desktop build doesn't share.
- The Rubin transient panel shows real objects from last night, with broker/classifier provenance.
- A teacher can paste one URL into a lesson plan and every student lands in the same view.
- Running cost: $0/month + domain.
