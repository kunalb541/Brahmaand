# Research: Rendering 1–10M Stars as a Flyable 3D Point Cloud (WebGL2 / Three.js / WebXR)

```yaml
topic: Star point-cloud rendering at 72fps+ on Quest-class GPUs (Three.js + WebXR)
date: 2026-06-11
author: research agent (web-verified where marked)
confidence_notes: |
  - Items under "VERIFIED" were checked against live URLs on 2026-06-11.
  - Items under "UNVERIFIED / FROM MEMORY" are high-likelihood engineering knowledge
    (well-known GL/astro facts) that could not be re-verified today or are
    inherently device-dependent; re-test on target hardware.
  - All shader code below is pseudocode/reference code, not battle-tested; it
    encodes the verified design patterns and must be profiled on Quest hardware
    (or the Immersive Web Emulator + a mid-range Android phone as proxy).
target: 1–10M stars, desktop-first, 72–90fps in WebXR on Quest 2/3-class GPUs
```

---

## 1. VERIFIED facts (checked 2026-06-11, source URLs inline)

### Three.js / WebGL platform
- Three.js is at approximately **r184** as of June 2026 (per https://threejs.org/ search snippet; pin the exact release at implementation time via https://github.com/mrdoob/three.js/releases).
- `gl_PointSize` maximum is queried via `gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)`. The WebGL spec **only guarantees a max of 1.0**; real GPUs support more, but the limit varies wildly: **Apple M1/M2 report a max of 64 px**, while most other GPUs report 512, 1024, or 2048 (sources: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-working-around-gl_pointsize-limitations-webgl.html ; Apple dev forum thread https://forums.developer.apple.com/forums/thread/714831 ; limits demo https://math.hws.edu/graphicsbook/demos/c6/webgl-limits.html). Consequence: **never rely on point sizes > 64 px**; bright stars need a billboard/quad fallback.
- Three.js `logarithmicDepthBuffer`: modifies `gl_Position.z` in the vertex shader and, where fragment-depth writes are available (always in WebGL2), also writes `gl_FragDepth` in the fragment shader. Writing `gl_FragDepth` **disables early-Z**, a real performance cost (https://github.com/mrdoob/three.js/issues/17384). Vertex-only log depth (no frag-depth write) causes large surfaces to "bend"/disappear (https://github.com/mrdoob/three.js/issues/13047). Log depth also breaks MSAA along intersections (https://github.com/mrdoob/three.js/issues/22017) and required a special fix for orthographic cameras (https://github.com/mrdoob/three.js/pull/17442). Original implementation: https://github.com/mrdoob/three.js/pull/3880.
- Large-coordinate jitter in Three.js is a known, documented problem; community guidance is "keep the camera at/near origin, translate the world" (https://discourse.threejs.org/t/camera-and-floating-point-origin/51486 , https://discourse.threejs.org/t/large-coordinates/50621 , https://discourse.threejs.org/t/moving-the-camera-model-will-shake-if-the-coordinates-are-large/7214). Cesium-style fixes: camera-relative rendering (subtract camera position on CPU in float64, upload small numbers) and float64 emulation via high/low float32 pairs; Three.js does **neither** natively — vertices are Float32Array and transforms apply after precision is already lost (good writeup: https://medium.com/@mlightcad/precision-safe-rendering-of-large-coordinate-cad-drawings-in-three-js-c49c299b3afc ; Babylon.js ships a built-in "floating origin" pattern: https://doc.babylonjs.com/features/featuresDeepDive/scene/floating_origin/).

### Gaia Sky (Toni Sagristà) — the closest prior art
- Paper: **A. Sagristà, S. Jordan, T. Müller, F. Sadlo, "Gaia Sky: Navigating the Gaia Catalog", IEEE TVCG 25(1):1070–1079, 2019** (https://ieeexplore.ieee.org/document/8440086/ ; https://www.semanticscholar.org/paper/4ef268bb6fbb83b70a4260b951d191c794da5525). Core idea: LOD structure based on spatial distribution of stars into an **octree**; each octree node ("octant") owns a distinct star group (https://gaia.ari.uni-heidelberg.de/gaiasky/docs/master/LOD-catalogs.html).
- Star rendering docs (https://gaia.ari.uni-heidelberg.de/gaiasky/docs/3.4.0/Star-rendering.html , master version same path): Gaia Sky supports **two star renderers — native `GL_POINTS` (faster, screen-space, ignores perspective distortion) and billboard quads (two triangles, preferred for visual correctness)**. Magnitude→size pipeline: (1) correct apparent magnitude for extinction; (2) absolute magnitude `M = m − 5(log10(d_pc) − 1)`; (3) pseudo-luminosity `L = L0 · 10^(−0.4·M)`; (4) pseudo-size = constant factor × square root of that. At render time the shader computes the subtended solid angle `α = atan(p/d)` (small-angle approx for distant stars) and applies a user-tunable **"brightness power"** exponent to exaggerate bright/faint differences. Docs explicitly say this is "not physically rigorous but works well in practice."
- Sagristà's blog on point-cloud rendering experiments (https://tonisagrista.com/blog/2021/gaiasky-point-cloud-rendering/): he moved away from `GL_POINTS` partly because **point primitives break under cubemap/planetarium reprojection**; he benchmarked three paths: (a) expanded quad VAOs (~4× memory: 4 verts + 6 indices per star), (b) **instanced quads — "does not waste any memory and so far it is the most promising mode"**, (c) `GL_POINTS`. Plain quad VAOs were slightly faster on big GPUs but degraded badly on weak hardware. Same post: GLSL's 16×vec4 vertex-attribute limit forced resampling variable-star light curves >20 points.

### Stellarium
- Star drawing is centralized in `StelSkyDrawer`, which "draws sky objects taking into account eye adaptation, zoom level, instrument model and artificially set magnitude limits" (https://stellarium.org/doc/24.0/classStelSkyDrawer.html). Sky brightness / limiting-magnitude model is based on **B. Schaefer's 1998 VISLIMIT model** (per Stellarium docs/discussions, e.g. https://sourceforge.net/p/stellarium/discussion/278769/thread/af0ceb4a2f/). Takeaway: Stellarium converts magnitude → physical luminance (cd/m²) → tone-mapped screen intensity + small textured halo sprite; the "size" of a star on screen is almost entirely an intensity/halo effect, not a geometric radius.

### Star color
- **Ballesteros (2012), "New insights into black bodies", EPL 97 34008, arXiv:1201.1809** (https://arxiv.org/abs/1201.1809) provides the standard analytic B−V → blackbody temperature formula (see §6; coefficients quoted from memory, paper existence verified).
- **Mitchell Charity's blackbody color tables** (http://www.vendian.org/mncharity/dir3/blackbody/) give sRGB chromaticities of blackbodies per temperature, computed with CIE 1964 10° color matching functions, sRGB primaries/gamma, D65 whitepoint — chromaticity only, brightness deliberately ignored (http://www.vendian.org/mncharity/dir3/blackbody/parameters.html). Star-specific version: http://www.vendian.org/mncharity/dir3/starcolor/blackbody.html.
- **Tanner Helland's temperature→RGB analytic fit** (fit to Charity's table, cheap enough for a shader or preprocessing): https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html.
- Gaia DR3 color↔Teff: ESA's "What colour do they have?" page (https://www.cosmos.esa.int/web/gaia/dr3-what-colour-do-they-have); empirical (BP−RP)→Teff relations with 40–80 K accuracy over 4000–8000 K exist, e.g. the `colte` package (https://github.com/casaluca/colte) and Casagrande et al. IRFM relations (https://arxiv.org/pdf/2004.06140). (BP−RP) is the best Gaia color for deriving Teff.

### Quest hardware & services
- Quest 3 = Snapdragon XR2 Gen 2; WebXR sessions default to **90 Hz** on Quest 3 (120 Hz possible when requested); Quest 2 class defaults to 72 Hz (https://threejsresources.com/vr/blog/best-vr-headsets-with-webxr-support-for-three-js-developers-2026 ; https://communityforums.atmeta.com/discussions/dev-quest/openxrs-xr-fb-display-refresh-rate-extension-only-returns-60hz-and-72hz-for-ques/1237082). Design target: **72 fps minimum (Quest 2), 90 fps preferred (Quest 3)**.
- hips2fits cutout service endpoints: `https://alasky.cds.unistra.fr/hips-image-services/hips2fits` and mirror `https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits`; max cutout 50 Mpixels; JPEG/PNG/FITS output (https://alasky.cds.unistra.fr/hips-image-services/hips2fits).

---

## 2. UNVERIFIED / FROM MEMORY (re-check on hardware or at implementation time)

- **float32 precision math** (textbook, not re-verified online): 24-bit significand ⇒ integers exact only to 2^24 = 16,777,216; relative epsilon ≈ 1.19e−7. At coordinate magnitude 1e7, absolute resolution is ~1 unit; at 1e4, ~1e−3. This is the origin of the "~1e7 units" breakdown rule of thumb.
- **Quest (Adreno) max point size**: Adreno GPUs typically report `ALIASED_POINT_SIZE_RANGE` max of ~1023, but this MUST be queried at runtime in the Quest Browser; do not assume. (Apple 64 px figure above IS verified.)
- Three.js dropped WebGL1 support around r163 (2024); WebGL2 can be assumed, so `gl_FragDepth`, instancing, `OES`-free float textures, and 3D textures are all core. (High confidence, not re-verified today.)
- Three.js ≥ r152 default output color space is sRGB (`renderer.outputColorSpace = SRGBColorSpace`), and the linear→sRGB encode happens in each material's fragment shader when rendering directly to the default framebuffer ⇒ **additive blending then sums sRGB-encoded values, which is mathematically wrong** (energy non-linear). Workaround in §6. (High confidence.)
- Celestia: stars and DSOs are stored in **octrees** with magnitude-based culling; star styles include "fuzzy points", "points", and "scaled discs". (From Celestia source knowledge; medium confidence; source: https://github.com/CelestiaProject/Celestia.)
- Gaia DR3 numbers: ~1.81B sources total; ~1.46B with 5-parameter astrometry (parallax + proper motion); `teff_gspphot` for ~470M; `bp_rp` for ~1.5B. Good parallaxes (σϖ/ϖ < 20%) for roughly a few hundred million stars — a 1–10M-star app subset is easy to extract via ADQL on parallax S/N. (Medium-high confidence; verify counts at https://www.cosmos.esa.int/web/gaia/dr3.)
- Ballesteros formula (from memory, paper verified above): `T = 4600 K · [ 1/(0.92·(B−V) + 1.7) + 1/(0.92·(B−V) + 0.62) ]`. Gaia (BP−RP) ≈ (B−V) only roughly; for better results use Jordi et al. 2010 photometric transforms or `colte`, or just ship `teff_gspphot` when present.
- Quest-class fill-rate intuition: the binding constraint for additive point clouds is **overdraw/fill rate, not vertex count**. ~1–2M small (≤4 px) points per eye at 72 Hz is achievable on XR2-class GPUs if the fragment shader is trivial; large soft sprites for thousands of bright stars are what kill frame rate. (Engineering judgment; must be profiled.)

---

## 3. THREE.Points + ShaderMaterial vs InstancedMesh impostors

| | `THREE.Points` + custom `ShaderMaterial` | `InstancedMesh`/instanced quad impostors |
|---|---|---|
| Geometry cost | 1 vertex/star (cheapest possible) | 4 verts + 6 idx shared, per-instance attribs ≈ same per-star memory |
| Max screen size | clamped by `ALIASED_POINT_SIZE_RANGE` (64 px on Apple!) | unlimited |
| Shape | always a screen-aligned square; cannot rotate; clipped when center leaves frustum (point is culled whole on some drivers when center off-screen) | arbitrary quad; survives center-offscreen; can rotate for diffraction spikes |
| VR/stereo | works, sized in pixels — must scale `gl_PointSize` by per-eye viewport height & FOV | works naturally in world/view space |
| Cubemap/planetarium reproj | broken (why Gaia Sky moved off GL_POINTS) | fine |
| Perspective distortion at FOV edges | wrong (screen-space square) | correct |
| Draw call cost | 1 per chunk | 1 per chunk |

**Recommended hybrid (matches Gaia Sky's evolution):**
1. **Faint/medium stars (≥99.9% of catalog): `THREE.Points` with custom ShaderMaterial.** One vertex per star is unbeatable for millions of points, and faint stars are ≤4 px so none of the Points weaknesses matter.
2. **Bright stars (computed size > ~0.5 × queried max point size, or > ~32 px): instanced-quad impostor pass.** A few hundred to few thousand instances; gives big soft halos + optional diffraction-spike texture, immune to the 64 px Apple/driver clamp. In Three.js use `InstancedBufferGeometry` (plane) + per-instance position/color/mag attributes rather than `InstancedMesh` (no need for per-instance matrices — build the billboard in the vertex shader from camera basis vectors).
3. Selection between passes is done **offline per chunk** (split each chunk's stars into "point list" + "bright list" by absolute magnitude) plus a **runtime promotion**: any point whose vertex-shader size clamps can simply dump excess into intensity (see §5), so the offline split only needs to be approximately right.

---

## 4. Point sprite fragment shader: PSF falloff, blending, size limits

- **PSF profile:** a Gaussian `I(r) = exp(−r²/(2σ²))` is the standard cheap approximation of the Airy pattern core; real Airy `(2J1(x)/x)²` is overkill. A good-looking variant used widely (and similar in spirit to Stellarium's halo) is a two-term profile: narrow Gaussian core + wide low-amplitude halo: `I = exp(−r²/(2σc²)) + h·exp(−r²/(2σh²))` with `h ≈ 0.05–0.15`. Compute in the fragment shader from `gl_PointCoord` — no texture fetch needed (texture-based sprites are also fine and let artists tweak; fetch cost is similar to ALU on mobile).
- **Blending: additive** (`THREE.AdditiveBlending`), `depthWrite: false`. Additive is order-independent ⇒ no sorting ever, which is the whole reason million-star point clouds are tractable. `transparent: true` so Three.js puts it in the transparent pass after opaque objects.
- **Depth test:** for the star field itself, prefer `depthTest: false` and explicit `renderOrder` (sky sphere → stars → foreground UI). Stars are sub-pixel light sources; correct occlusion against each other is meaningless, and skipping depth avoids all log-depth/Points interactions (§7).
- **`gl_PointSize` cap:** query once: `const [ , maxPt ] = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)`. Clamp in the vertex shader to `min(maxPt, uMaxSpriteSize)`. **Energy conservation trick:** when the desired size `s` exceeds the clamp `c`, multiply the star's intensity by `(s/c)²` so total emitted light is preserved — the star stays the right brightness, just less spatially spread. This makes the 64 px Apple clamp visually benign for all but the very brightest stars, which the impostor pass handles anyway.
- **VR caveat:** `gl_PointSize` is in framebuffer pixels. In WebXR the per-eye framebuffer resolution and FOV differ from desktop; scale point size by `uViewportHeightPx / (2 · tan(fovY/2))` (i.e., pixels-per-radian), recomputed per render target. Three.js does an equivalent scale in `PointsMaterial` (`size` × `scale` uniform = half drawing-buffer height when `sizeAttenuation` is on) — replicate that in the custom shader.

---

## 5. Magnitude → size & intensity (and why naive scaling looks wrong)

**Physics:** stellar flux spans ~24 magnitudes ≈ 10^9.6 in linear flux. Displays have ~2–3 decades of usable range. Stars are point sources: to the eye, a brighter star is *brighter and blurrier* (PSF scattering, glare), not geometrically bigger. **Naive `size ∝ flux` or even `size ∝ mag` makes bright stars look like ping-pong balls and faint stars vanish** — the classic mistake. The correct mental model (used by Stellarium and effectively by Gaia Sky's mag→pseudo-size√L pipeline):

1. Convert catalog data once, offline: store **absolute magnitude** `M = m − 5·(log10(d_pc) − 1)` (Gaia Sky does exactly this, verified §1).
2. Per frame, per star (vertex shader), recompute apparent magnitude from the *current camera distance* in parsecs: `m = M + 5·(log10(d_pc) − 1)` — this is what makes the flythrough physically honest (fly toward a star and it brightens by inverse-square automatically).
3. Map magnitude → **linear intensity** with exposure: `I = exposure · 10^(−0.4·(m − m_ref))`, `m_ref` ≈ the magnitude that maps to display 1.0 (a user/auto "exposure" control, exactly like camera ISO; Stellarium's eye-adaptation is an automated version of this).
4. Map intensity → (size, brightness):
   - `I ≤ 1`: size = minimum core size (≈ 1.5–2.5 px, never < ~1.5 px or the star shimmers/aliases when subpixel), brightness = `I`.
   - `I > 1` (saturated): brightness = 1, **grow area instead**: `size = coreSize · sqrt(I)` (energy spread over more pixels ≈ bloom), optionally compressed with a user "brightness power" exponent like Gaia Sky's. The sqrt is the same "constant × square root" Gaia Sky documents.
5. Anti-aliasing of faint stars: stars with `I < ~0.05` should fade alpha rather than shrink below the minimum size; alternatively dither.

This gives ~10 visually distinct magnitude classes on screen from a 10^9 flux range, which is what planetarium software converges on.

---

## 6. Color: bp_rp → blackbody RGB, and the sRGB/gamma trap

**Pipeline (do offline in the preprocessing step, store 3×uint8 per star):**
1. Best: use `teff_gspphot` from Gaia DR3 when present; else estimate Teff from `bp_rp` (empirical relations: `colte` https://github.com/casaluca/colte, or crude Ballesteros via a BP−RP→B−V transform; for a visualization, even a direct monotone fit bp_rp∈[−0.6, 5] → Teff∈[40000, 2500] K is fine).
2. Teff → **linear-light RGB chromaticity** of a blackbody. Use Mitchell Charity's table (http://www.vendian.org/mncharity/dir3/blackbody/) or Tanner Helland's analytic fit (https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html). **Charity's table values are sRGB-encoded (gamma-applied)** — decode to linear (`pow((c+0.055)/1.055, 2.4)` per channel) before storing if your shader works in linear light (it should).
3. **Desaturate**: real star colors are subtle (the eye sees near-white for most stars). Lerp the blackbody chroma toward white by ~30–50% or saturation looks cartoonish. Make it a tunable.
4. Normalize chromaticity to max-channel = 1 (brightness comes from the magnitude pipeline, not the color).

**Gamma/sRGB handling in Three.js:** work in **linear** inside the shader (intensity math of §5 is linear-light). If rendering straight to the canvas with `outputColorSpace = SRGBColorSpace`, Three.js encodes to sRGB *per fragment before blending*, so additive accumulation of overlapping stars sums gamma-encoded values → overlapping halos look too bright/washed. Two options:
- **Acceptable hack (ship first):** render stars directly; the error is only visible where many halos overlap (clusters, galactic plane). Tune exposure to taste.
- **Correct (HDR pipeline):** render sky + stars into a **half-float linear render target**, blend additively there (linear additive = physically correct), then a fullscreen pass does tonemap (ACES or simple exposure) + sRGB encode. This also gives free bloom input. Cost on Quest: one extra fullscreen pass + half-float bandwidth — measure; Quest-class GPUs handle RGBA16F at eye-buffer res but it eats into the budget.

---

## 7. Precision at astronomical scales

- **Unit choice: 1 world unit = 1 parsec.** Gaia DR3 usable-parallax stars live within ~10–20 kpc ⇒ coordinates ≤ ~2×10^4, comfortably inside float32's good range (abs. resolution at 1e4 ≈ 1e−3 pc ≈ 200 AU). The notorious float32 breakdown at ~1e7 units (24-bit mantissa, §2) is avoided *for star positions* by the unit choice alone — but NOT for (a) close flybys of a star (sub-AU camera motion near a star at 8 kpc) and (b) the camera matrix itself.
- **Camera-relative rendering (the fix, verbatim Cesium "RTC" pattern):**
  - Keep the authoritative camera position in **float64 on the CPU** (JS numbers are f64 — free).
  - Each frame, set `camera.position = (0,0,0)` for rendering. For each chunk, upload `uChunkOffset = chunkOriginF64 − cameraPosF64` (computed in f64, *then* truncated to f32 — the subtraction happens at full precision, which is the entire point). Star positions in the VBO are **chunk-local** (small numbers, full f32 precision).
  - Vertex shader: `worldPos = uChunkOffset + localPos` — all small magnitudes near the camera, where precision matters; jitter-free flybys.
  - Three.js implementation: a `Group` per chunk whose `position` is reset every frame from f64 math, camera pinned at origin; or pass `uChunkOffset` as a uniform on the chunk's ShaderMaterial. Community precedent: https://discourse.threejs.org/t/camera-and-floating-point-origin/51486.
- **Depth buffer / log depth:** near/far for a scene spanning 1e−6 pc (cockpit) to 2e4 pc is a ~1e10 ratio — a standard 24-bit depth buffer cannot do this. Options:
  1. **Avoid the problem (recommended):** stars render with `depthTest:false, depthWrite:false` (additive, order-irrelevant); sky sphere renders first with `depthWrite:false`; only *local* opaque objects (planets later, UI panels) use the depth buffer with a sane near/far. No log depth at all.
  2. `logarithmicDepthBuffer: true`: works, but writes `gl_FragDepth` → kills early-Z (verified, §1), has MSAA artifacts (#22017), and with `THREE.Points` you must ensure the log-depth chunk is included in your custom shader (Three.js injects it into built-ins via `#include <logdepthbuf_vertex>` / `<logdepthbuf_fragment>`; with `ShaderMaterial` you must add those includes yourself or depth will be inconsistent with other objects). Reserve this for the later planetary-surfaces milestone.
  3. Reversed-Z via WebGPU renderer — not for this milestone.

---

## 8. LOD / chunking strategy

**Gaia Sky's verified approach (§1):** octree where *each node owns a star group*; deeper levels add fainter/denser stars; nodes stream in/out by camera distance & view angle, with a user "LOD multiplier". The paper (TVCG 2019) describes assigning the brightest stars of a region to the shallowest octant so any view shows the right bright stars first. Adopt this:

- **Offline preprocessing** (Python/Rust job, part of the Gaia pipeline doc):
  1. Cut catalog: parallax S/N > 5 (or distance posterior from Bailer-Jones), keep ~1–10M stars sorted by G magnitude.
  2. Build octree over 3D positions (pc). Node capacity ~8k–64k stars. **Assign stars to levels by brightness**: root gets the globally brightest ~64k, children get the next tier *within their volume*, etc. ⇒ rendering root-only already looks like the naked-eye sky.
  3. Emit one binary blob per node: header + interleaved records. Suggested record (16 B/star): `float32 x,y,z` (chunk-local, chunk origin in header as f64) + `uint8 r,g,b` + `uint8 flags` + `float16/uint16 absMag` (absMag×256 as uint16 works). 10M stars ≈ 160 MB total, but typical loaded set ≪ that. Serve as static files (`/chunks/level/x_y_z.bin`), HTTP-range-friendly, gzip/brotli off (already dense), immutable cache headers.
- **Runtime:**
  - Maintain a load set: walk octree breadth-first; load node if `projectedSolidAngle(node) > θ_lod` (or simply distance(camera, node) < k·nodeSize, Gaia Sky exposes exactly this as a draw-distance slider). Unload LRU beyond a memory budget (Quest: budget ~256 MB JS+GPU for stars).
  - **Frustum culling per chunk**: `THREE.Frustum.intersectsSphere(chunk.boundingSphere)` each frame; skip draw call. With camera-relative offsets, recompute the frustum from the offset camera. Keep chunks just outside the frustum *loaded* (rotation in VR is fast).
  - **Fade-in LOD**: per-chunk uniform `uFade` 0→1 over ~300–500 ms after load; multiply star intensity. Additive blending makes fades trivially pop-free (no sorting, no alpha ordering). Fade *out* before unloading deeper levels when flying away.
  - One `THREE.Points` (+ one instanced-quad mesh for its bright list) per chunk = ~50–300 draw calls typical; fine for WebGL2/Quest.

---

## 9. Prior art summary (Gaia Sky / Celestia / Stellarium)

- **Gaia Sky** (verified, §1): octree LOD + magnitude-derived pseudo-size + (point | billboard | instanced-billboard) renderers; instancing judged most promising; abandoned raw GL_POINTS for correctness reasons that *also apply to VR* (per-eye reprojection). Sources: TVCG 2019 paper, docs (Star-rendering, LOD-catalogs pages), tonisagrista.com blog.
- **Stellarium** (verified API docs): `StelSkyDrawer` = magnitude→luminance with eye adaptation (Schaefer sky-brightness model), small textured sprites, twinkling; 2D planetarium (no 3D flythrough) so no octree — its lesson for us is the *photometric* tone-mapping chain, not spatial data structures.
- **Celestia** (memory, medium confidence): octrees for stars/DSOs with magnitude-threshold traversal; star styles fuzzy-points/points/scaled-discs — "scaled discs" is the naive size-scaling look to avoid.

---

## 10. Sky background (HiPS sphere) × 3D star field interplay

- The HiPS celestial sphere (DSS2/Pan-STARRS imagery) represents **infinity**. Render it as an inside-out sphere (or cube) **centered on the camera every frame** (trivial under camera-relative rendering: position = (0,0,0)), radius anything inside the far plane, with `material.depthWrite = false`, `depthTest = false` (or `depthFunc LEQUAL` with z forced to far), `renderOrder = -100`, drawn **first**. This is the standard "skybox at infinity" pattern; it never occludes anything and parallax-free by construction.
- Draw order: **(1) HiPS sky sphere → (2) 3D Gaia star points/impostors (additive, no depth) → (3) opaque local objects → (4) UI.** Within (2), chunks in any order (additive).
- **The duplication problem:** every bright star in the 3D Gaia layer also exists as baked light in the HiPS imagery. At the solar origin they coincide; flying away, the HiPS copy stays fixed (wrong parallax) while the 3D star moves. Mitigations: (a) **fade the HiPS sphere out as the camera leaves the solar neighborhood** (e.g., alpha = 1 → 0 over 50–500 pc from origin), replacing it with either nothing (black + Milky Way billboard model) or a prerendered all-sky starless background; (b) accept it for v1 — at DSS2 depth the imagery stars are faint relative to rendered bright stars under typical exposure. Gaia Sky itself fades its Milky Way model vs. star octree by camera distance (same pattern).
- HiPS tiles arrive sRGB (JPEG/PNG); if using the HDR linear pipeline of §6, mark textures `texture.colorSpace = THREE.SRGBColorSpace` so Three.js decodes to linear before the additive star light is composited on top.

---

## 11. Reference shader pseudocode (Three.js `ShaderMaterial` for the Points pass)

```glsl
// ---------- vertex ----------
// geometry attributes (per star, chunk-local):
attribute vec3 position;     // chunk-local position, parsecs (float32)
attribute vec3 starColor;    // linear-light chromaticity, max-channel=1 (uint8 normalized)
attribute float absMag;      // absolute magnitude M (float16/uint16-decoded)

uniform vec3  uChunkOffset;   // (chunkOrigin - cameraPos) computed in f64 on CPU, pc
uniform float uExposure;      // user/auto exposure, linear multiplier
uniform float uMRef;          // magnitude mapping to intensity 1.0 at d=10pc-equivalent
uniform float uPxPerRad;      // viewportHeightPx / (2*tan(fovY/2)); per-eye in XR
uniform float uMaxPointSize;  // min(ALIASED_POINT_SIZE_RANGE[1], 64.0)
uniform float uMinPointSize;  // ~1.7
uniform float uCoreSizePx;    // ~2.2  PSF core diameter at I=1
uniform float uFade;          // chunk LOD fade 0..1

varying vec3  vColor;
varying float vIntensity;

void main() {
  vec3 camRel = position + uChunkOffset;          // small numbers near camera
  float d = length(camRel);                       // parsecs
  // apparent magnitude at current camera distance (inverse-square, in mags)
  float m = absMag + 5.0 * (log2(max(d, 1e-6)) * 0.30103 /*log10*/ - 1.0);
  // linear intensity, exposure-controlled:  I = exp10(-0.4 (m - mRef)) * exposure
  float I = exp2(-0.4 * 3.321928 * (m - uMRef)) * uExposure;

  // intensity -> (size, brightness): constant core, grow area only when saturated
  float sizePx = uCoreSizePx * sqrt(max(I, 1.0)); // sqrt: spread energy (Gaia-Sky-like)
  float brightness = min(I, 1.0);

  // clamp size; conserve energy by boosting brightness*(s/c)^2 is wrong when
  // brightness==1 already, so route excess into a soft cap instead:
  float clamped = clamp(sizePx, uMinPointSize, uMaxPointSize);
  brightness *= (sizePx > uMaxPointSize) ? (sizePx*sizePx)/(uMaxPointSize*uMaxPointSize)
                                         : 1.0;   // impostor pass should own these
  // subpixel fade instead of shrinking below min size:
  brightness *= clamp(I / 0.05, 0.0, 1.0) * uFade;

  vColor = starColor;
  vIntensity = brightness;

  vec4 mvPos = modelViewMatrix * vec4(camRel, 1.0); // model matrix = identity
  gl_Position = projectionMatrix * mvPos;
  gl_PointSize = clamped;                  // already in framebuffer px via uPxPerRad
  // NOTE: if uCoreSizePx is defined in "px at reference FOV", instead do:
  // gl_PointSize = clamped * (uPxPerRad / uPxPerRadReference);
}

// ---------- fragment ----------
precision mediump float;
varying vec3  vColor;
varying float vIntensity;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;     // [-1,1]^2
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;                    // circular sprite
  // gaussian core + faint wide halo (cheap Airy-ish PSF)
  float core = exp(-r2 * 4.5);              // sigma ~0.33 of radius
  float halo = 0.08 * exp(-r2 * 1.2);
  float psf  = core + halo;
  vec3 c = vColor * (vIntensity * psf);
  gl_FragColor = vec4(c, 1.0);              // AdditiveBlending: dst += src.rgb
}
```

```ts
// ---------- material setup (Three.js) ----------
const mat = new THREE.ShaderMaterial({
  vertexShader, fragmentShader,
  uniforms: { uChunkOffset: { value: new THREE.Vector3() }, /* ... */ },
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false,          // see §7; flip to true only if local occluders needed
  transparent: true,
});
const pts = new THREE.Points(chunkGeometry, mat);
pts.frustumCulled = false;   // we cull per-chunk manually with f64-correct frustum
pts.renderOrder = 10;        // after sky sphere (-100), before opaque/UI
```

Bright-star impostor pass: same magnitude/color math in an `InstancedBufferGeometry` quad vertex shader; build billboard corners as `mvPos.xy += corner * worldSize` in view space; fragment shader identical PSF plus optional spike texture; also additive/no-depth.

---

## 12. Decisions recommended

1. **Hybrid renderer:** `THREE.Points` + custom ShaderMaterial for the bulk; instanced-quad impostors for stars exceeding ~32 px or the queried point-size max. Mirrors Gaia Sky's verified trajectory (points → instanced billboards).
2. **Units = parsecs; camera-relative rendering** with f64 CPU camera, per-chunk `uChunkOffset = chunkOrigin − cameraPos` (f64 subtract), chunk-local f32 positions. Camera pinned at origin. **No logarithmicDepthBuffer in v1** — stars render depth-free (additive, depthTest/Write off); revisit log depth only when planetary surfaces arrive.
3. **Photometry:** store absolute magnitude per star; recompute apparent magnitude per frame in the vertex shader; magnitude→intensity via `10^(−0.4Δm)` with a user exposure slider (+ optional auto-exposure later); intensity→size only past saturation, via sqrt; minimum point size ~1.7 px with sub-pixel alpha fade.
4. **Color:** offline bp_rp/teff_gspphot → Teff → blackbody linear RGB (Charity table / Helland fit), desaturated ~40%, stored as 3×uint8; shader works in linear; v1 renders direct-to-canvas (accepting sRGB additive error), v2 moves to RGBA16F linear target + tonemap pass shared with the HiPS layer.
5. **Data structure:** magnitude-stratified octree (Gaia Sky pattern), 8k–64k stars/node, 16 B/star static binary chunks over HTTP, per-chunk `Points` object, manual frustum culling by bounding sphere, distance-based load/unload with LRU budget and 300–500 ms intensity fades.
6. **Sky sphere:** HiPS sphere camera-centered, drawn first, `depthWrite:false`, `renderOrder:-100`; fade it out beyond ~100 pc from the solar origin to avoid false parallax against the 3D stars.
7. **Perf budget:** target 72 fps Quest 2 / 90 fps Quest 3; cap simultaneous rendered stars ~1.5–2M on Quest (deeper octree levels desktop-only); profile fill rate first — it, not vertex count, will be the wall.
8. **Runtime capability probe at startup:** `ALIASED_POINT_SIZE_RANGE`, max texture size, XR framebuffer scale — and feed `uMaxPointSize` and impostor threshold from it (Apple-64px case verified real).

## 13. Open questions

1. **Actual Quest Browser `ALIASED_POINT_SIZE_RANGE`** (Adreno 650/740) — assumed ~1023, must be read on-device or via Immersive Web Emulator + real phone proxy.
2. **Fill-rate ceiling on XR2 Gen 2** for additive RGBA16F vs direct sRGB rendering — decides whether the correct linear-HDR pipeline ships in v1 or v2. Needs a benchmark scene (e.g., 2M points + 2k impostors at 1.3× eye-buffer scale).
3. **Three.js exact current release & WebGPURenderer maturity** (r184 per threejs.org snippet) — if WebGPU + WebXR is viable on target browsers by build time, reversed-Z and storage-buffer point rendering change several answers; assume WebGL2 path for the blueprint.
4. **gl_PointCoord behavior under WebXR multiview** (OCULUS_multiview): Three.js multiview + Points has had breakage historically (#17442 discussion); if multiview is enabled for perf, the Points pass must be re-validated; impostors are the safe fallback.
5. **Best bp_rp→Teff relation for the full −0.6..5 color range** (M dwarfs + hot stars): `colte` covers FGK well; decide between piecewise empirical fit vs shipping `teff_gspphot` and a fallback fit. Affects only the offline pipeline.
6. **HiPS fade-out aesthetics:** what replaces the imagery sky beyond ~100 pc — pure rendered stars + procedural Milky Way billboard (Gaia Sky uses a particle/billboard galaxy model), or a precomputed starless all-sky map? Needs visual prototyping.
7. **Chunk record format final layout** (16 B vs 20 B with proper motion for future epoch propagation) — adding `float16 pmra,pmdec,rv` enables time-travel features later at +6 B/star.
8. **Magnitude-stratification details** in Gaia Sky's published octree (exact per-level magnitude split heuristic) — paper PDF (IEEE paywalled) not fully re-read; the docs confirm the structure but the splitting heuristic above is a reconstruction. If needed, read the open-access author copy at https://vcg.iwr.uni-heidelberg.de/publications/pubdetails/Sagrista2019GaiaSky/ or the Gaia Sky source (https://codeberg.org/gaiasky/gaiasky or GitHub mirror).
