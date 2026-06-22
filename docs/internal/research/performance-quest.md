# Research: WebXR Performance Engineering for Quest-class Headsets + Desktop

```yaml
topic: Performance engineering for WebXR on standalone Quest headsets (2/3/3S) and desktop browsers,
       for an app streaming HiPS sky-imagery tiles + rendering millions of Gaia points
date: 2026-06-11
status: research-complete, pre-implementation
confidence:
  high:   frame budgets, refresh-rate APIs, FFR API, framebufferScaleFactor, HiPS tile formats,
          WebXR Layers benefits, profiling tools, GC-tenuring problem
  medium: exact draw-call/triangle budgets (Meta gives ranges, not guarantees; varies by render state),
          KTX2 transcode timing (order-of-magnitude only), Quest texture-memory ceiling
  low:    dynamic viewport scaling availability on Quest Browser (must be feature-detected at runtime),
          exact gl_PointSize limits per device
note: All numbers below tagged [VERIFIED] carry an inline source URL. Anything tagged [UNVERIFIED]
      or [ESTIMATE] is engineering judgment that must be confirmed by on-device measurement.
```

---

## 1. Device + browser baseline (what we are targeting)

### 1.1 Hardware classes [VERIFIED]

| Device | SoC | GPU | RAM | Relative GPU |
|---|---|---|---|---|
| Quest 2 | Snapdragon XR2 Gen 1 | Adreno 650 (~1.2 TFLOPS) | 6 GB | 1.0x baseline |
| Quest 3 | Snapdragon XR2 Gen 2 | Adreno 740-class | 8 GB | ~2x Quest 2 |
| Quest 3S | Snapdragon XR2 Gen 2 | same GPU as Quest 3 | 8 GB | ~2x Quest 2 |

Sources: https://www.uploadvr.com/quest-3-gpu-twice-powerful/ , https://www.laptopmag.com/gaming/vr/meta-quest-3s-vs-quest-2 . Quest 3/3S share the XR2 Gen 2 GPU; Quest 3S is the floor-spec "cheap" device with Quest-2-class lenses but Quest-3-class compute. Practical consequence: **tune for Quest 2 as worst case** until Quest 2 share drops; everything else has ~2x headroom.

### 1.2 Refresh rates and frame budgets [VERIFIED]

- Meta Quest Browser runs WebXR at **90 fps by default on Quest 2** (72 fps on original Quest); **Quest 3 forces 90 Hz by default** in browser. Sources: https://developers.meta.com/horizon/documentation/web/webxr-frames/ , https://communityforums.atmeta.com/discussions/dev-openxr/fps-settings/1328177
- Frame budgets per Meta's WebXR perf workflow doc ( https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/ ):
  - 60 fps → **16.6 ms**
  - 72 fps → **13.7 ms** (the "~13.8 ms" figure)
  - 90 fps → **11.1 ms**
- Frame-rate control API (Quest Browser 16.4+) [VERIFIED, same Meta doc]:

```js
// inside an active immersive session
console.log(session.frameRate);            // current, e.g. 90
console.log(session.supportedFrameRates);  // e.g. Float32Array [72, 80, 90, 120]
await session.updateTargetFrameRate(72);   // drop to 72 to buy ~2.6ms/frame
```

Meta's guidance: if render time exceeds the target frame duration ("longer than 11ms for a 90Hz framerate"), lower the frame rate. **Decision-relevant: our sky app is a slow-camera experience — requesting 72 Hz on Quest 2 is a legitimate, supported way to convert 11.1 ms budget into 13.7 ms.**

- CPU rule of thumb [VERIFIED]: "Any app logic that takes longer than two milliseconds should be considered for optimization." ( https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/ )

### 1.3 Draw call / triangle budgets

- [VERIFIED] Meta WebXR docs: submitting **1000 individual draw calls would likely put you under 72 fps** from CPU cost alone, even though the GPU could rasterize orders of magnitude more triangles ( https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/ and the search summary of that family of docs).
- [VERIFIED] Meta general VR guidelines: **500–1,000 draw calls max, 1–2 M triangles/vertices max per frame** ( https://developers.meta.com/horizon/documentation/native/pc/dg-performance-guidelines/ — note: PC-oriented; standalone budgets are tighter).
- [VERIFIED-community] Quest 2 native apps commonly target **~750 k–1.0 M triangles/frame**; WebXR has extra browser overhead, so practical WebXR budgets are lower ( https://communityforums.atmeta.com/t5/Quest-Development/Are-the-Performance-Targets-for-Oculus-Quest-Accurate/m-p/848106 ).
- [VERIFIED] Draw-call *state changes* dominate cost: switching materials ≈ +64% draw-call time, switching shaders ≈ +175%, redrawing the same object ≈ 25% the cost of a different object ( https://developers.meta.com/horizon/documentation/unity/po-draw-call-analysis/ ).
- [ESTIMATE] For a WebXR three.js app, a safe working budget is **≤100 draw calls/frame on Quest 2** (multiview is not exposed to WebGL in Quest Browser the way it is natively, so each call may be issued twice for stereo unless `XRWebGLLayer` + single framebuffer with two viewports is used — three.js does the two-viewport approach with one scene graph traversal but still ~2x driver submissions). Keep unique shader programs under ~10.

---

## 2. Fixed Foveated Rendering (FFR) in WebXR

[VERIFIED] Two APIs, both supported on Quest Browser ( https://developers.meta.com/horizon/documentation/web/webxr-ffr/ , https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/fixedFoveation , https://developer.mozilla.org/en-US/docs/Web/API/XRProjectionLayer/fixedFoveation ):

```js
// Option A: request a static level at session start (Meta extension feature names)
const session = await navigator.xr.requestSession('immersive-vr', {
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['high-fixed-foveation-level'],
  // also: 'medium-fixed-foveation-level', 'low-fixed-foveation-level'
});

// Option B: dynamic, per-frame adjustable, standard API (preferred)
const layer = new XRWebGLLayer(session, gl);
if (layer.fixedFoveation !== null) {     // null => device doesn't support FFR
  layer.fixedFoveation = 0.5;            // 0 = none/full res, 1 = max foveation
}

// three.js wrapper (default is ALREADY 1.0 = max foveation):
renderer.xr.setFoveation(1.0);           // [VERIFIED] three.js defaults foveation to 1
// https://threejs.org/docs/api/en/renderers/webxr/WebXRManager
```

Caveats [VERIFIED, Meta FFR doc]:
- FFR **only applies when rendering to the final XR framebuffer**. Rendering to intermediate render targets (post-processing chains, EffectComposer) gets no FFR benefit, and **switching render targets mid-frame (e.g., shadow maps) prevents FFR from functioning properly**. → Our app should render directly to the XR framebuffer; no post-processing in VR mode.
- FFR artifacts are most visible on **high-contrast content** — and a star field is the textbook worst case (bright point on black). Peripheral stars will visibly dim/shimmer at high foveation. **Recommendation: foveation 0.3–0.5 for the star-field scene, up to 1.0 for the smooth nebulosity of the HiPS sky imagery; tune per-scene, it is per-frame adjustable.**
- Verify FFR is active with `ovrgpuprofiler -t` (render-stage widths shrink when FFR is on).

---

## 3. framebufferScaleFactor + dynamic resolution

[VERIFIED] ( https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/getNativeFramebufferScaleFactor_static , https://github.com/immersive-web/webxr/blob/main/explainer.md ):

```js
// 1.0 = UA-chosen "reasonable balance", NOT native panel resolution
const native = XRWebGLLayer.getNativeFramebufferScaleFactor(session); // e.g. ~1.2-1.5
const layer = new XRWebGLLayer(session, gl, { framebufferScaleFactor: 0.9 });

// three.js:
renderer.xr.setFramebufferScaleFactor(0.9); // call BEFORE session start
```

- [VERIFIED] Meta: setting framebuffer scale to **0.8–0.9 gives a substantial reduction in fragments** at modest sharpness cost ( https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/ ).
- **Dynamic viewport scaling** (`XRView.requestViewportScale(scale)` + `view.recommendedViewportScale`) lets you change render resolution *per frame* without recreating the layer ( https://developer.mozilla.org/en-US/docs/Web/API/XRView/requestViewportScale ). [UNVERIFIED availability]: ChromeStatus historically listed it behind `chrome://flags#webxr-incubations` with only GVR enabling it ( https://chromestatus.com/feature/5640976515203072 ); Quest Browser support must be **feature-detected at runtime** (`if ('requestViewportScale' in xrView)`). Do not architect around it; treat as progressive enhancement.

```js
// per-frame, inside onXRFrame, if supported:
for (const view of pose.views) {
  if (view.requestViewportScale && view.recommendedViewportScale) {
    view.requestViewportScale(view.recommendedViewportScale);
  }
  const vp = glLayer.getViewport(view); // applies the change
}
```

- Fallback dynamic-resolution strategy that ALWAYS works: monitor frame timing over a sliding window; if consistently over budget, recreate the projection layer at a lower `framebufferScaleFactor` (cheap, but causes one-frame hitch — do it during fades/scene transitions) or drop `updateTargetFrameRate` to 72.

### 3.1 WebXR Layers — directly relevant to the sky sphere [VERIFIED]

( https://developers.meta.com/horizon/blog/achieve-better-rendering-and-performance-with-webxr-layers-in-oculus-browser/ , https://www.w3.org/TR/webxrlayers-1/ )

- `XREquirectLayer` makes the **XR compositor itself map equirect imagery onto the inside of a sphere** — exactly our celestial-sphere use case. Content is re-rendered only when it changes; the compositor reprojects it every frame for free, at better quality (no double-resampling through the eye buffer).
- Meta's cube-layer sample measured **2.4 ms GPU savings and >25% total GPU load reduction** vs rendering the same skybox in WebGL.
- Constraint: our HiPS sphere is *not* a single equirect image — it's a dynamic tile mosaic in HEALPix projection. Realistic hybrid: render the tile mosaic into an equirect (or cubemap) render target *only when tiles change*, and hand that texture to an `XREquirectLayer`/`XRCubeLayer`. Star points stay in the normal projection layer. three.js does not natively manage extra WebXR layers; this requires direct WebXR Layers API code alongside three.js (supported in Quest Browser; not on desktop emulators — feature-detect `XRMediaBinding`/`XRWebGLBinding.createEquirectLayer`).

---

## 4. Texture memory, HiPS tiles, and the LRU cache

### 4.1 HiPS tile facts [VERIFIED]

- HiPS tiles are **512×512 px by default** (`hips_tile_width` default = 512; N must be a power of 2) and are served as **JPEG, PNG, or FITS only** ( https://aladin.cds.unistra.fr/hips/HipsgenManual.pdf , https://www.ivoa.net/documents/HiPS/20170406/PR-HIPS-1.0-20170406.pdf ).
- **No HiPS server serves GPU-compressed formats (KTX2/Basis/ASTC).** Confirmed by the standard's format list — JPEG/PNG/FITS for images, TSV for catalogs. Any GPU compression must happen client-side at runtime, or offline on assets we host ourselves.
- JPG/PNG tiles store rows top→down, FITS bottom→up — flip-Y handling differs per format (HipsgenManual, same source).

### 4.2 Memory math [ESTIMATE — arithmetic, not measurement]

Per 512×512 tile uploaded as RGBA8: 512 × 512 × 4 = **1.0 MiB**, ×1.33 with mipmaps ≈ **1.33 MiB**.

| Tiles resident on GPU | RGBA8+mips | ETC2/ASTC-4x4 (1 B/px)+mips |
|---|---|---|
| 64 | ~85 MiB | ~21 MiB |
| 128 | ~170 MiB | ~43 MiB |
| 256 | ~340 MiB | ~85 MiB |
| 512 | ~680 MiB | ~170 MiB |

Quest 2 has 6 GB shared RAM total, with OS + other apps resident; the browser tab gets a fraction. [UNVERIFIED] There is no documented hard WebGL texture-memory cap for Quest Browser; community guidance for mobile VR suggests keeping **total texture memory ≲256 MB on Quest 2** for stability (echoed in mobile-VR budget discussions; treat as soft target). Exceeding real limits → context loss / tab kill with no useful error ( https://docs.unity3d.com/530/Documentation/Manual/webgl-memory.html documents the general browser OOM opacity problem).

**Consequence: an LRU tile cache with a hard ceiling is mandatory.** Eviction must call `texture.dispose()` (three.js does NOT garbage-collect GPU resources — https://threejs.org/docs/pages/WebGLRenderer.html , and see `renderer.info.memory.textures` for live counts). Keep separate ceilings: GPU-resident tiles (small) vs decoded-CPU-side cache (larger) vs HTTP cache (browser-managed).

### 4.3 KTX2/Basis: runtime transcode vs raw upload

- KTX2+BasisU is the web's compressed-texture interchange: transcodes on-device to ETC2 (Adreno/mobile) or BC7/S3TC (desktop) ( https://www.donmccurdy.com/2024/02/11/web-texture-formats/ ). three.js `KTX2Loader` ships a WASM transcoder running in a **WorkerPool** (default 4 workers), supports ETC1S and UASTC ( https://threejs.org/docs/pages/KTX2Loader.html , https://github.com/mrdoob/three.js/pull/18490 ).
- BUT: HiPS gives us JPEG. Converting JPEG→Basis at runtime requires *encoding*, which is far too slow (encoding is an offline operation; only *transcoding* pre-encoded Basis is fast). **So KTX2 is NOT applicable to live HiPS tile streaming.**
- Where KTX2 IS applicable: any assets **we preprocess and host ourselves** — e.g., a baked low-order all-sky base layer (orders 0–3 fetched at startup), star billboards/sprite atlases, UI textures. For those, offline-encode to KTX2/ETC1S: ~4–8x less GPU memory, ~4x smaller upload payloads, and uploads of pre-compressed data skip driver-side conversion (faster, less stall).
- Raw-JPEG path cost per tile [ESTIMATE]: network ~30–150 KB → decode (worker, see below) ~2–10 ms off-thread → `texImage2D` upload of 1 MiB RGBA ~0.5–2 ms on Quest-class hardware + mipmap generation ~0.5–1 ms. The upload+mipgen is the part stuck on the GL thread, hence throttling (next section).

---

## 5. Texture upload stalls and mitigation

The stall anatomy: `texImage2D(/texSubImage2D)` with an `HTMLImageElement` can trigger **synchronous decode + format conversion on the main thread** ( https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D , https://bugzilla.mozilla.org/show_bug.cgi?id=1486454 ). Even with pre-decoded data, the GL upload + mip generation steals frame time. In a 11–13.8 ms VR frame, one careless tile upload = dropped frame.

Mitigations, in priority order:

1. **Decode off the main thread with `createImageBitmap` in a Worker** [VERIFIED pattern]:

```js
// tile-worker.js
self.onmessage = async ({ data: { url, tileId } }) => {
  const resp = await fetch(url);
  const blob = await resp.blob();
  const bmp  = await createImageBitmap(blob, {
    imageOrientation: 'flipY',           // HiPS JPG/PNG are top-down
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  self.postMessage({ tileId, bmp }, [bmp]);  // transfer, zero-copy
};
```
   Caveat [VERIFIED]: browsers already decode images on internal threads, so the worker win is mainly *scheduling isolation* (fetch+decode never competes with the rAF loop) — see https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html . The upload itself still happens on the GL thread. ImageBitmap→texture upload is the cheapest path Chrome offers.

2. **Throttle uploads to a per-frame budget**: maintain an upload queue; each XR frame, upload at most N tiles or until a time budget is hit (`performance.now()` delta ≥ ~1.5–2 ms → stop, resume next frame). In XR sessions `requestIdleCallback` still exists on the main thread but its idle periods are unreliable between 90 Hz rAF callbacks — use it only as a bonus drain in 2D/desktop mode, not as the primary mechanism. [ESTIMATE: 1 tile/frame in VR, 2–4 tiles/frame desktop.]

3. **Pre-upload via `renderer.initTexture(tex)`** (three.js) so the decode+upload happens at a moment you control, not at first render ( https://discourse.threejs.org/t/is-there-a-way-to-await-webglrenderer-inittexture/26503 ).

4. **Allocate once, update with `texSubImage2D`**: with a texture-array cache (below), allocate immutable storage up front (`gl.texStorage3D`), then `texSubImage3D` each arriving tile into a free layer — no per-tile allocation, no mip-chain reallocation. Generate mips once per batch, not per tile, or precompute order-(n+1) tiles as the mip level (HiPS's hierarchical structure gives you mip data for free: four child tiles downsample to the parent).

5. **`ImageBitmapLoader` in three.js** instead of `TextureLoader` (which uses HTMLImageElement) for path 1's main-thread variant.

---

## 6. Draw-call batching for the tile sphere

Options compared (key context: at HiPS order 3 the visible hemisphere is ~384 tiles worst case; typical visible set 30–80 tiles at the orders we'll use):

| Strategy | Draw calls | Pros | Cons |
|---|---|---|---|
| Per-tile `Mesh` + own texture | 1/tile (30–80+) | trivial; easy LOD swap | way over CPU budget on Quest 2 with state changes (texture bind per call) |
| Merged geometry + **texture atlas** | 1–4 | minimal calls | mip bleeding across atlas cells (needs padding/border gutters), atlas repacking on eviction, 4096² atlas = only 64 tiles of 512px |
| Merged geometry + **WebGL2 `TEXTURE_2D_ARRAY`** | 1–4 | no bleeding (each layer mips independently), uniform 512×512 tiles are the perfect fit, eviction = overwrite a layer index | needs custom ShaderMaterial (`sampler2DArray` + per-vertex `layerIndex` attribute); array size fixed at allocation; all layers same format |
| `XREquirectLayer` compositor offload (sec 3.1) | ~0 per frame for sky | biggest GPU win in VR | extra render-to-equirect pass when tiles change; Quest-only; bypasses three.js material system |

**Recommendation: texture arrays.** Allocate e.g. `gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels, gl.SRGB8_ALPHA8, 512, 512, 128)` (128 layers ≈ 170 MiB with mips) as the GPU tile pool; one merged sphere-patch geometry per HiPS order in view; fragment shader samples `sampler2DArray` with a per-corner layer attribute. Draw calls for the whole sky: **1–3**. Tile-based GPUs also strongly prefer fewer texture binds (state-change costs in sec 1.3). WebGL2 is universally available (Quest Browser is Chromium; desktop all fine). Atlas only as fallback for a hypothetical WebGL1 path — not worth supporting in 2026.

Geometry note: keep sphere-patch meshes coarse (HiPS tiles drawn as ~4–16 quads each for great-circle curvature). 80 tiles × 16 quads × 2 tris ≈ 2,560 triangles — geometry cost is negligible; this app is **fragment/texture-bound, not vertex-bound**.

---

## 7. Points rendering on mobile GPUs (the star field)

- Adreno is a **tile-based renderer**: opaque geometry gets hidden-surface benefits, but **blended primitives (additive star sprites) must shade and blend every overlapping fragment** — overdraw is paid in full ( https://hyeondg.org/gpu/tbr ). Additive blending also breaks early-Z rejection benefits.
- Cost scales with **pixels per point**: rasterizer cost grows with point size; research on point-cloud pipelines confirms near-linear scaling in pixels/point ( https://arxiv.org/pdf/1908.02681 ). A 16-px additive soft sprite costs ~256x the fill of a 1-px point; 100k such sprites in a cluster = millions of blended fragments = GPU falls over.
- Mitigations:
  1. **Clamp `gl_PointSize`** hard in VR (e.g., max 6–8 px at 0.9 framebuffer scale); encode brightness primarily via color/alpha, not size. [UNVERIFIED: exact `ALIASED_POINT_SIZE_RANGE` on Quest Browser — query at runtime; Adreno commonly reports up to 1023, but never rely on >64.]
  2. **Magnitude-based LOD**: draw faint stars (the vast majority) as 1–2 px non-blended (or alpha-tested) points in one draw call; only the brightest ~1–5 k stars get the pretty additive sprite treatment in a second draw call. This caps overdraw where it matters.
  3. **Spatial chunking + frustum culling**: Gaia chunks as separate `Points` objects (one draw call each, 16–64 chunks visible) so off-view chunks cost nothing; this conflicts mildly with "few draw calls" — 64 unbatched point draws with the SAME material/shader is fine (no state change between them; see sec 1.3 redraw cost ≈25%).
  4. Avoid `depthWrite` on additive points; sort coarsely back-to-front only if needed (additive is order-independent — don't sort at all).
  5. Desktop can take 1–2 M points at 1–3 px comfortably on any discrete GPU; Quest 2 realistic ceiling [ESTIMATE] **~250–500 k small points** per eye-frame before fill+vertex cost bites, less if many are large/blended. Measure with ovrgpuprofiler.

---

## 8. JS GC pressure and object pooling

- [VERIFIED] Known WebXR engine problem: objects allocated per frame that are still live at the end of rAF get **tenured into old-space; after enough frames a major GC fires and drops frames** ( https://github.com/immersive-web/webxr/issues/1010 — filed by engine authors specifically about WebXR frame loops).
- Rules for our frame loop:
  - Zero allocations in steady state: preallocate `Vector3`/`Matrix4`/`Quaternion` scratch objects at module scope; never call `new`, `[...spread]`, `Array.map`, string concat, or arrow-closure creation inside `onXRFrame`.
  - Pool tile request/result objects and reuse `Float32Array` staging buffers for point-chunk loads ( https://kingdavvid.hashnode.dev/introduction-to-object-pooling-in-threejs ).
  - three.js itself is mostly allocation-free per frame, but watch: `Raycaster.intersectObjects` (allocates hit arrays — for gaze picking, throttle to 10–15 Hz, not every frame, and reuse a target array), `getWorldPosition(new Vector3())` patterns, and `EventDispatcher` payloads.
  - Gaze/click TAP & SIMBAD lookups (network) must go through a debounced async path completely outside the frame loop.
  - Pre-warm pools during load screens; verify with Chrome DevTools allocation timeline that steady-state sawtooth is flat.

---

## 9. Profiling toolchain

| Tool | What it gives | How |
|---|---|---|
| **OVR Metrics Tool** | in-headset Performance HUD: FPS, stale frames, tears, CPU/GPU utilization & clock levels | Install via Meta Quest Developer Hub or SideQuest; https://developers.meta.com/horizon/documentation/native/android/ts-ovrmetricstool/ |
| **ovrgpuprofiler** | real-time GPU metrics + render-stage traces (per-pass GPU ms); verifies FFR active | ships in Quest runtime: `adb shell ovrgpuprofiler -t`; https://developers.meta.com/horizon/documentation/unity/ts-ovrgpuprofiler/ |
| **chrome://tracing (about:tracing)** | instrumented CPU profile of the browser process incl. JS, GC, texture uploads | Quest Browser is Chromium: `adb forward tcp:9222 localabstract:chrome_devtools_remote` then desktop chrome://inspect → trace; https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/ |
| **Chrome DevTools remote** | JS profiler, memory/allocation timeline, console | same adb forward; primary day-to-day tool |
| **RenderDoc for Oculus (Meta fork)** | frame capture w/ per-draw GPU timings on Quest | https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/ |
| **Spector.js** | WebGL call stream, draw call/state inspection — desktop | caveat [VERIFIED]: its per-command "duration" is CPU time, not GPU time ( https://wonderlandengine.com/news/profiling-webxr-applications/ ) |
| **IWER + Immersive Web Emulator** | desktop WebXR emulation (no headset needed) — our default dev loop | extension: https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik ; runtime: https://developers.meta.com/horizon/blog/immersive-web-emulation-runtime-iwer-webxr-meta-quest-developer/ (`@iwer/devui`, `@iwer/sem`, ActionRecorder/ActionPlayer for replaying real headset input on desktop) |
| Meta's bound-classification method | disable rendering → frame time unchanged ⇒ CPU-bound; set render scale to 0.01 → if GPU-bound it reveals vertex vs fragment | webxr-perf-workflow doc above |

`renderer.info` (three.js) in an on-screen debug HUD: `render.calls`, `render.triangles`, `memory.textures`, `memory.geometries` — cheap continuous regression guard.

---

## 10. Concrete performance budget table for THIS app

[ESTIMATE — derived from verified ceilings above; to be validated on-device in milestone 1]

| Budget item | Quest 2 (VR, 72 Hz requested) | Quest 3/3S (VR, 90 Hz) | Desktop (60–144 Hz) | Mobile 2D |
|---|---|---|---|---|
| Frame budget | 13.7 ms | 11.1 ms | 16.6 ms @60 | 16.6 ms |
| JS (script) time/frame | ≤ 4 ms | ≤ 4 ms | ≤ 6 ms | ≤ 6 ms |
| — of which app systems (tiles, LOD, picking) | ≤ 2 ms | ≤ 2 ms | ≤ 3 ms | ≤ 3 ms |
| GPU time/frame | ≤ 9 ms | ≤ 8 ms | n/a (vsync) | n/a |
| Draw calls total | ≤ 80 | ≤ 150 | ≤ 300 | ≤ 100 |
| — sky tile mosaic | ≤ 4 (texture array, merged) | ≤ 4 | ≤ 8 | ≤ 4 |
| — star point chunks | ≤ 48 | ≤ 64 | ≤ 128 | ≤ 32 |
| — UI/labels/misc | ≤ 20 | ≤ 30 | ≤ 50 | ≤ 20 |
| Triangles | ≤ 300 k | ≤ 750 k | ≤ 2 M | ≤ 300 k |
| Points rendered (post-cull) | ≤ 300 k (≤5 k large sprites) | ≤ 600 k (≤10 k sprites) | ≤ 2 M | ≤ 200 k |
| Max point sprite size | 6 px | 8 px | 16 px | 8 px |
| GPU tile pool (512² RGBA8+mips) | 128 layers ≈ 170 MiB | 192 ≈ 256 MiB | 384 ≈ 510 MiB | 96 ≈ 128 MiB |
| Decoded CPU-side tile cache | 64 tiles | 96 | 256 | 48 |
| Tile uploads per frame | 1 (≤ 2 ms) | 1–2 | 2–4 | 1 |
| Concurrent tile fetches | 6 | 8 | 12 | 4 |
| Total GPU texture memory (everything) | ≤ 350 MiB | ≤ 512 MiB | ≤ 1 GiB | ≤ 256 MiB |
| Steady-state allocations/frame | 0 | 0 | 0 | 0 |
| framebufferScaleFactor | 0.9 (drop to 0.8 under load) | 1.0 (drop to 0.9) | n/a | devicePixelRatio cap 2 |
| fixedFoveation | 0.5 sky / 0.3 starfield | 0.4 / 0.2 | n/a | n/a |

---

## Decisions recommended

1. **Target 72 Hz on Quest 2** via `session.updateTargetFrameRate(72)` when `supportedFrameRates` allows; keep 90 Hz on Quest 3/3S. Build the frame-time governor (rolling p95 of `XRFrame` deltas) from day one.
2. **WebGL2 `TEXTURE_2D_ARRAY` tile pool** (texStorage3D, 512×512×N layers, sRGB8_ALPha8) + merged per-order sphere geometry + custom `ShaderMaterial`; LRU eviction = layer-index reuse, zero reallocation. Reject per-tile meshes and texture atlases.
3. **Tile pipeline: fetch+`createImageBitmap` in a Worker pool (2–3 workers), transfer ImageBitmap, throttled `texSubImage3D` upload ≤ ~2 ms/frame on the main thread.** No KTX2 for live HiPS tiles (servers only serve JPEG/PNG/FITS — encoding at runtime is infeasible).
4. **DO pre-encode our own static assets to KTX2/ETC1S** (baked all-sky base orders 0–3, sprite textures) and load via three.js `KTX2Loader` — memory and upload win where we control the server.
5. **Two-tier star rendering**: 1–2 px plain points for the bulk (one shader), additive textured sprites only for the brightest few thousand; hard `gl_PointSize` clamp in VR; chunked `Points` objects with frustum culling; no depth-write, no sorting on additive pass.
6. **FFR via `renderer.xr.setFoveation()`, tuned per scene** (lower for star field due to high-contrast artifacts); render directly to the XR framebuffer — **no post-processing chain in VR mode** (FFR + perf).
7. **No allocations in the frame loop**: scratch-object pools, throttled raycasting (≤15 Hz) for gaze picking, all network (TAP/SIMBAD/hips2fits) strictly outside rAF.
8. Prototype an **`XREquirectLayer`/`XRCubeLayer` compositor path for the sky mosaic** as a stretch optimization (verified ~2.4 ms/25% GPU savings class) behind feature detection; ship the in-scene textured sphere first.
9. **Tooling baseline**: IWER + Immersive Web Emulator for daily dev; OVR Metrics HUD + chrome://tracing via adb + ovrgpuprofiler for weekly on-device passes; `renderer.info` HUD with budget assertions (warn when draw calls/textures exceed table above) in dev builds.
10. Treat **dynamic viewport scaling as progressive enhancement** (runtime feature-detect); rely on framebufferScaleFactor + frame-rate switching as the guaranteed levers.

## Open questions

1. **Actual Quest Browser texture-memory ceiling** — no documented cap; need an on-device stress test (allocate texture-array layers until context loss) to set the real LRU ceiling. Budget table assumes ≤350 MiB on Quest 2 is safe; unproven.
2. **Is `XRView.requestViewportScale` implemented in current (mid-2026) Quest Browser?** ChromeStatus data was stale; must feature-detect on hardware.
3. **Quest Browser `supportedFrameRates` on Quest 3 in 2026** — forum reports said 90 Hz was forced in browser (late-2023 era); does `updateTargetFrameRate(72)` work in-session on Quest 3 today?
4. **WebXR Layers + three.js integration cost** — three.js doesn't manage secondary layers; how much custom WebXRBinding code is needed, and does `@types/webxr` cover Layers in our TS setup?
5. **Real per-tile upload cost on Adreno 650** (texSubImage3D 1 MiB + mip strategy) — measure; determines whether 1 tile/frame is conservative or optimistic.
6. **FITS tiles** (needed for scientifically calibrated cutouts?) decode cost in JS/WASM vs sticking to JPEG/PNG for display + hips2fits for data — affects worker design.
7. **Point-rendering ceiling on Quest 3S** — same GPU as Quest 3 but possibly different thermal envelope; validate the 600 k figure.
8. **Does generating mips from HiPS parent orders (instead of `generateMipmap`) produce acceptable seams?** HEALPix tile borders may not match downsampled children exactly.
9. **No headset on the team**: IWER replays can't measure perf. Decide early on a loaner/cloud-device strategy (e.g., a single Quest 3S dev unit) — emulator-only perf validation is impossible.
