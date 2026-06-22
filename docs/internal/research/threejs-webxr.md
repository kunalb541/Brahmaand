# Research: Three.js + WebXR best practice (desktop-first, VR-ready)

```yaml
topic: Three.js + WebXR stack research for web-based 3D/VR astronomy app
date: 2026-06-11
researcher: web-research subagent (Claude)
confidence_notes: |
  - npm version numbers/dates below were pulled live from registry.npmjs.org on 2026-06-11 (high confidence).
  - three.js docs/GitHub issue contents were fetched from threejs.org / github.com on 2026-06-11 (high confidence).
  - Meta Horizon OS developer docs were fetched on 2026-06-11 (high confidence for what they state;
    they omit some specifics like exact supported-Hz lists, flagged below).
  - Third-party blog claims (utsubo.com, vr.org) are used only for context and are flagged as
    lower-confidence where not corroborated by a primary source.
  - Anything marked UNVERIFIED is from model memory or inference and must be runtime-tested.
status: complete
```

---

## 1. Executive summary

- Latest stable three.js is **r184 (npm `three@0.184.0`, published 2026-04-16)**; release cadence is now ~6–8 weeks, each release can contain breaking changes (no semver).
- **For a WebXR app today, ship `WebGLRenderer`** (or `WebGPURenderer` with `forceWebGL: true` if you want TSL/node materials). Native-WebGPU-backend XR is landing in **r185** (tracking issue closed against the r185 milestone, not yet released as of 2026-06-11) and multiview in the WebGL backend still has open stereo-projection bugs.
- The desktop-first pattern is well-trodden: one scene, `renderer.setAnimationLoop`, `renderer.xr.enabled = true`, `XRButton`, OrbitControls on desktop, controller/hand rays in XR, behind a small input-abstraction layer.
- **three-mesh-ui is effectively dormant** (last release v6.5.4, March 2023). **`@pmndrs/uikit` is the actively maintained choice** (v1.0.73, 2026-05-27, works with vanilla Three.js, used by Meta's IWSDK).
- Headset-free testing: Meta's **Immersive Web Emulator** browser extension (adds a "WebXR" tab to Chrome DevTools) and/or the **IWER** runtime (`iwer@2.2.1` on npm) injected directly into the app.
- WebXR requires a **secure context**: use `@vitejs/plugin-basic-ssl` or `vite-plugin-mkcert` + `--host` for LAN testing; `adb reverse` or Cloudflare/ngrok tunnels for Quest-on-USB / remote devices.
- **iOS Safari still has no WebXR** (immersive-vr is visionOS Safari only) → the phone story is a "magic window" using `DeviceOrientationEvent` with the iOS 13+ `requestPermission()` gesture-gated flow.

---

## 2. Three.js release line & cadence

### VERIFIED

- Latest release: **`three@0.184.0` = r184**, published **2026-04-16** (live query of https://registry.npmjs.org/three/latest, 2026-06-11).
- Recent release dates (from npm registry `time` field — primary source):
  | npm version | rXXX | published |
  |---|---|---|
  | 0.180.0 | r180 | 2025-09-03 |
  | 0.181.0 | r181 | 2025-10-31 |
  | 0.182.0 | r182 | 2025-12-10 |
  | 0.183.0 | r183 | 2026-02-18 |
  | 0.184.0 | r184 | 2026-04-16 |
  → cadence has slowed from the historical monthly rhythm to **~6–8 weeks**; expect **r185 around June/July 2026**.
- Three.js does **not** use semver. Breaking changes land in any rXXX release and are documented in the Migration Guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide and per-release notes at https://github.com/mrdoob/three.js/releases.
- Package entry points (from `three@0.184.0` package.json, fetched from registry):
  - `three` → `./build/three.module.js`
  - `three/webgpu` → `./build/three.webgpu.js`
  - `three/tsl` → `./build/three.tsl.js`
  - `three/addons/*` → `./examples/jsm/*` (canonical addons path; `three/examples/jsm/*` also still works)
- TypeScript types: **`@types/three@0.184.1`** (published 2026-05-06) — types are versioned in lockstep with `three` minor versions; keep them pinned together (live npm query).

### UNVERIFIED / guidance

- Practice: **pin the exact three version** (`"three": "0.184.0"`, no `^`) and upgrade deliberately one release at a time using the migration guide. A `^0.184.0` range never matches 0.185.x anyway (0.x semver), but pinning + lockfile makes the intent explicit.
- r170/r171 (Aug–Sep 2025) reorganized WebGPU/TSL entry points per a third-party recap (https://www.utsubo.com/blog/threejs-2026-what-changed — low confidence on details); the practical takeaway (import `WebGPURenderer` from `three/webgpu`) is corroborated by the package.json exports above.

---

## 3. WebGPURenderer vs WebGLRenderer — what to ship for WebXR (June 2026)

### VERIFIED

- `WebGPURenderer` constructor options include **`forceWebGL`** (default `false`; forces the WebGL 2 backend) and **`multiview`** (default `false`; "the renderer will use multiview during WebXR rendering if supported"). It auto-falls back to WebGL 2 when the browser lacks WebGPU. Source: https://threejs.org/docs/pages/WebGPURenderer.html
- WebXR support for the **native WebGPU backend** of `WebGPURenderer` is tracked in https://github.com/mrdoob/three.js/issues/28968 — that issue is **closed against the r185 milestone**, i.e. it ships in the *next* release after the current stable r184 (fetched 2026-06-11).
- `WebGPURenderer` **with the WebGL backend already runs WebXR** (people are running `new THREE.WebGPURenderer({ forceWebGL: true, multiview: true })` on Quest), but there is an **open bug**: multiview produces a wrong right-eye projection ("loses the 3D effect") and antialias+multiview flickers — https://github.com/mrdoob/three.js/issues/32538 (reported on r181, still open 2026-06-11; related: #31729, #32151). Workaround in the issue: disable multiview.
- Historical context: as of Jan 2025 the official answer was "not possible to use WebXR with WebGPURenderer yet" — https://discourse.threejs.org/t/webgpurenderer-vr-support/76048 — so all WebGPU-XR support is recent and should be treated as fresh code.
- WebGPU itself reached cross-browser baseline (Chrome/Edge/Firefox/Safari 26) per third-party reporting (https://vr.org/articles/webgpu-baseline-2026-three-js-webxr-default, https://www.utsubo.com/blog/threejs-2026-what-changed). Treat browser-XR-via-WebGPU claims in those posts as **uncorroborated by primary sources** — the WebXR/WebGPU binding spec status on Quest Browser was not confirmed by Meta docs during this research.
- TSL/node materials only work with `WebGPURenderer` (either backend), not classic `WebGLRenderer` (https://discourse.threejs.org/t/webgpurenderer-vr-support/76048).

### Recommendation (see §12)

For an XR-critical app in June 2026: **`WebGLRenderer`** (battle-tested XR path, all examples/docs assume it) or `WebGPURenderer({ forceWebGL: true })` if TSL is wanted. Re-evaluate native-WebGPU XR after r185 ships *and* Quest Browser's WebXR-WebGPU binding is confirmed. The astronomy use case (huge starfields → instanced/points rendering, potential compute-shader point culling) will eventually benefit from WebGPU, so keep renderer construction behind a factory function.

---

## 4. Core WebXR wiring in three.js

### VERIFIED (three.js docs: https://threejs.org/docs/pages/WebXRManager.html, VRButton docs: https://threejs.org/docs/pages/VRButton.html)

- `renderer.xr.enabled = true` — must be set before entering a session.
- **Must use `renderer.setAnimationLoop(fn)`** instead of `requestAnimationFrame` — the XR session drives the loop with its own rAF when presenting; `setAnimationLoop` switches between window rAF and `XRSession.requestAnimationFrame` transparently.
- Buttons are **addons** (not core): `three/addons/webxr/VRButton.js`, `three/addons/webxr/ARButton.js`, and `three/addons/webxr/XRButton.js`. `XRButton` picks `immersive-ar` if supported else `immersive-vr` — for a VR-first app with optional AR later, `XRButton` is the forward-compatible choice; `VRButton` is fine for VR-only.
- `WebXRManager` API (exact signatures from docs):
  - `.getCamera() : ArrayCamera` — XR camera with one sub-camera per view.
  - `.getController(index) : Group` — target-ray space (pointing).
  - `.getControllerGrip(index) : Group` — grip space (where the controller model goes).
  - `.getHand(index) : Group` — hand-joint space.
  - `.setFoveation(value)` — 0 = full res, 1 = max foveation.
  - `.setFramebufferScaleFactor(value)` — **cannot be called during an active session**.
  - `.setReferenceSpaceType(value)` — default `'local-floor'`; cannot change mid-session.
  - `.updateCamera(camera)` — needed if `cameraAutoUpdate` is false.

### Canonical bootstrap (synthesized from verified APIs)

```ts
import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
// 'local-floor' default is right for room-scale; for a seated planetarium
// 'local' is acceptable — set BEFORE session start:
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(XRButton.createButton(renderer, {
  optionalFeatures: ['hand-tracking', 'layers'],
}));

renderer.setAnimationLoop((time, xrFrame) => {
  // xrFrame is the XRFrame when presenting, undefined on desktop
  update(time);
  renderer.render(scene, camera);
});

renderer.xr.addEventListener('sessionstart', () => {/* swap input mode */});
renderer.xr.addEventListener('sessionend',   () => {/* restore desktop mode */});
```

UNVERIFIED detail: the exact options bag accepted by `XRButton.createButton` (`sessionInit`-style `optionalFeatures`) should be confirmed against the r184 source at https://github.com/mrdoob/three.js/blob/dev/examples/jsm/webxr/XRButton.js before relying on it.

---

## 5. Controllers, hands, gaze fallback

### VERIFIED (source read: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/webxr/XRControllerModelFactory.js)

- `XRControllerModelFactory` constructor: `constructor(gltfLoader = null, onLoad = null)`. It auto-fetches a GLTF model matching the user's physical controller from the WebXR Input Profiles CDN, default path **`https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles`** (self-host this for production; the factory accepts a custom path via `.setPath()` — UNVERIFIED method name, check source).
- `XRControllerModelFactory` explicitly **ignores hand input sources** (`if (xrInputSource.hand) return;` in its `connected` handler) — hands need `XRHandModelFactory` (`three/addons/webxr/XRHandModelFactory.js` — path UNVERIFIED but standard).
- Usage pattern:

```ts
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const cmf = new XRControllerModelFactory();
for (const i of [0, 1]) {
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(cmf.createControllerModel(grip));
  scene.add(grip);

  const ray = renderer.xr.getController(i); // target-ray space
  ray.addEventListener('selectstart', onSelectStart);
  ray.addEventListener('selectend', onSelectEnd);
  scene.add(ray);
}
```

- Controller `Group`s fire `connected` / `disconnected` (with `event.data = XRInputSource`) and `selectstart/select/selectend`, `squeezestart/squeeze/squeezeend`. r184 release notes add a grip-update event option (per release page summary — verify exact API in r184 changelog).

### Gaze fallback (UNVERIFIED — design pattern, no dedicated three.js helper)

- WebXR input sources expose `targetRayMode: 'gaze' | 'tracked-pointer' | 'screen'` (WebXR spec). Vision Pro Safari uses **transient-pointer gaze+pinch input** (reported: https://www.uploadvr.com/visionos-2-apple-vision-pro-webxr/). For cardboard-class viewers and Vision Pro, implement selection by raycasting from `renderer.xr.getController(i)` regardless of mode — three.js maps all `select` events onto the controller Groups, so the same code handles gaze, pinch, and trigger. Add a dwell-timer fallback only if targeting 3-DoF/no-button devices.
- For the astronomy app: "gaze/click object info" = one shared `Raycaster` helper that takes a ray (from mouse NDC on desktop, from controller target-ray pose in XR) and does the SIMBAD/TAP lookup on hit.

---

## 6. One scene, two input modes (desktop OrbitControls ↔ XR)

UNVERIFIED (architecture guidance — standard practice, no single canonical source):

- **Camera rig pattern**: never move the XR camera directly; parent `camera` under a `cameraRig: THREE.Group`. Desktop: OrbitControls mutates the camera as usual. XR: the headset pose writes camera-local transform every frame, and locomotion (flythrough between stars) moves `cameraRig`.
- Disable OrbitControls while presenting:

```ts
renderer.xr.addEventListener('sessionstart', () => { controls.enabled = false; });
renderer.xr.addEventListener('sessionend',   () => { controls.enabled = true; controls.update(); });
```

- `OrbitControls` import: `three/addons/controls/OrbitControls.js` (VERIFIED canonical addons layout via package.json exports). For an astronomy viewer consider two desktop modes: orbit (around an object) and look-around (inverted controls, camera at origin of celestial sphere) — implement look-around as OrbitControls with `target` glued just in front of the camera, or a small custom pointer-drag yaw/pitch controller (the latter is what sky viewers like Aladin Lite/Stellarium Web do).
- Input abstraction interface suggestion:

```ts
interface PointerLike {            // implemented by MousePointer & XRControllerPointer
  getRay(out: THREE.Ray): boolean; // false if not available this frame
  onSelect(cb: () => void): void;
}
```

- DPR/perf: cap `setPixelRatio` at ~2 on desktop; in XR pixel ratio is irrelevant (XR framebuffer is sized by `framebufferScaleFactor`).

---

## 7. UI in VR

### VERIFIED

- **three-mesh-ui**: last release **v6.5.4, 2023-03-24** (npm registry, live query); GitHub shows a "7.x.x in evaluation" note from years ago and no releases since (https://github.com/felixmariotto/three-mesh-ui). → Treat as **unmaintained/dormant; do not adopt for new code**.
- **@pmndrs/uikit**: actively maintained — **v1.0.73 published 2026-05-27**, with releases ~weekly through May 2026 (npm registry live query). Despite the README tagline ("user interfaces for react-three-fiber"), there is a **first-class vanilla Three.js API**: https://pmndrs.github.io/uikit/docs/getting-started/vanilla
  - install: `npm i @pmndrs/uikit` (core, no React)
  - flexbox-style components (`Container`, `Text`, etc. — common base class `Component`), HTML/CSS-aligned properties
  - integration requirements (from the vanilla docs):
    ```ts
    import { reversePainterSortStable, Container } from '@pmndrs/uikit';
    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);
    const root = new Container({ flexDirection: 'row', sizeX: 8, sizeY: 4 });
    scene.add(root);
    // in the loop: root.update(delta)  — call update() ONLY on the root
    ```
  - uikit is used as the spatial-UI layer of Meta's IWSDK (https://developers.meta.com/horizon/documentation/web/iwsdk-guide-spatial-ui/), a strong maintenance signal.
- **DOM Overlay API** (`dom-overlay` feature, `XRDOMOverlayState`): displays one interactive DOM element over the XR scene — but it is **handheld-AR only in practice**: "currently only supported for handheld AR using Chrome on Android" (spec/explainer: https://immersive-web.github.io/dom-overlays/, https://github.com/immersive-web/dom-overlays, chromestatus: https://chromestatus.com/feature/6048666307526656). **Not a VR-headset UI solution.**

### UNVERIFIED / guidance

- Pattern for desktop-first apps: keep **HTML/CSS UI for desktop and mobile** (search box, object info cards, layer toggles — far better text rendering, accessibility, and dev speed), and render an **in-scene uikit panel only while `renderer.xr.isPresenting`**. Drive both from the same state store so they can't drift.
- Quest Browser does not support DOM overlay inside `immersive-vr` (consistent with the Chrome-Android-AR-only statement above; mark as assumed).

---

## 8. Headset-free testing (no VR device — critical for this project)

### VERIFIED

- **Immersive Web Emulator** (Meta) — browser extension, repo: https://github.com/meta-quest/immersive-web-emulator, Chrome Web Store: https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik
  - Manifest V3; works in Chrome/Edge (any WebExtensions browser).
  - Integrates as a **"WebXR" tab inside Chrome DevTools** — open DevTools → WebXR panel → 3D viewport with transform controls for the emulated headset + both Touch controllers; analog inputs (trigger/grip/joystick) + keyboard shortcuts. (Meta blog: https://developers.meta.com/horizon/blog/webxr-development-immersive-web-emulator/)
  - Emulates Meta Quest devices "on par with the WebXR support in Meta Quest Browser".
  - Latest tagged GitHub release was v1.3.0 (2023-06-12); v1.1 added MR/`immersive-ar` emulation (https://developers.meta.com/horizon/blog/immersive-web-emulator-1-1/). Repo is not archived. The store build may be newer than GitHub tags — check the store listing version at install time.
  - The extension is powered by **IWER** and the README points to IWER as the direct-integration alternative.
- **IWER (Immersive Web Emulation Runtime)** — npm **`iwer@2.2.1`** ("Javascript WebXR Runtime for Emulation", live npm query). Injects a fake `navigator.xr` at runtime → works in **any** browser without an extension, scriptable (synthetic poses/inputs), usable in CI/automated tests. Meta's IWSDK uses IWER for built-in emulation and even exposes it to AI agents via an MCP server (https://developers.meta.com/horizon/documentation/web/iwsdk-ai-assisted-dev-tooling/).
- **Meta IWSDK** (`facebook/immersive-web-sdk`, launched Meta Connect 2025, MIT, docs https://iwsdk.dev) — full Three.js-based WebXR framework (ECS, grab interactions, locomotion, spatial UI, Vite tooling). Relevant here as a **reference implementation / source of patterns**, not necessarily a dependency (it imposes its ECS architecture).

### Recommended dev-loop (guidance)

1. Daily dev: desktop mode (OrbitControls), no XR involved.
2. XR smoke tests: IWE extension's DevTools WebXR tab (enter VR, move emulated headset/controllers).
3. Automated tests: inject IWER in Playwright/Vitest-browser runs to enter a fake `immersive-vr` session and assert render-loop/controller logic.

---

## 9. Quest Browser specifics (for when real-headset users arrive)

### VERIFIED (Meta Horizon OS docs)

- **Frame rate API** (https://developers.meta.com/horizon/documentation/web/webxr-frames/):
  - default: **90 fps on Quest 2** ("and newer" implied), **72 fps on Quest 1**;
  - query: `session.frameRate` (current), `session.supportedFrameRates` (list);
  - set: `await session.updateTargetFrameRate(rate)` — promise resolves when applied; available in Quest Browser ≥ 16.4.
  - The doc does **not** enumerate the exact supported list (72/80/90/120) — query `supportedFrameRates` at runtime.
- **framebufferScaleFactor** (https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/): in three.js use `renderer.xr.setFramebufferScaleFactor(v)` *before* session start; Meta recommends 0.8–0.9 as a cheap GPU win at slight sharpness cost. Default 1.0 is the "recommended" XR resolution, which on Quest is below native panel res (exact native-vs-recommended mapping: UNVERIFIED).
- **Fixed Foveated Rendering**: supported by Quest Browser; three.js API `renderer.xr.setFoveation(0..1)` (three.js docs, §4). UNVERIFIED: three.js's default foveation value (memory says 1.0 — i.e., max foveation enabled by default — verify in WebXRManager source; if true you may want to *lower* it for a starfield app, since foveation blurs the periphery and point-like stars show it badly).
- **WebXR Layers** are supported in Quest Browser and can improve quality/perf for media and HUD quads (https://developers.meta.com/horizon/blog/achieve-better-rendering-and-performance-with-webxr-layers-in-oculus-browser/).
- Quest Browser version now tracks Chromium major ("starting with Chromium 144, the major version of Browser will match") — https://developers.meta.com/horizon/documentation/web/browser-specs/
- Remote debugging: enable developer mode + USB, then desktop `chrome://inspect` to inspect Quest Browser tabs (Meta docs / pmndrs xr guide: https://pmndrs.github.io/xr/docs/getting-started/development-setup).

### UNVERIFIED

- 120 Hz: historically Quest 2/3 expose 120 only when the system-level "120 Hz refresh rate" toggle is on; treat 90 as the design target and 120 as opportunistic via `supportedFrameRates`.
- For a mostly-static star sky, a lower-rate fallback (72) plus reprojection is acceptable; don't promise 120.

```ts
// session config sketch (runtime-verify supportedFrameRates)
renderer.xr.addEventListener('sessionstart', async () => {
  const session = renderer.xr.getSession()!;
  const rates = session.supportedFrameRates;          // e.g. Float32Array [72, 80, 90, 120]
  if (rates?.includes(90)) await session.updateTargetFrameRate(90);
});
renderer.xr.setFoveation(0.5);                         // tune: stars hate heavy foveation
renderer.xr.setFramebufferScaleFactor(1.0);            // drop to 0.9 if GPU-bound
```

---

## 10. "Magic window" on phones (2026)

### VERIFIED

- **iOS Safari still does not implement WebXR** on iPhone/iPad (only visionOS Safari has immersive-vr; AR module not enabled even there) — https://www.uploadvr.com/visionos-2-apple-vision-pro-webxr/ and 2026 compatibility roundups (https://www.testmuai.com/learning-hub/webxr-compatible-browsers/). → On iPhone, sensor-driven look-around must use **DeviceOrientation**, not WebXR.
- **iOS 13+ permission flow** (unchanged through 2026): `DeviceOrientationEvent.requestPermission()` exists on iOS, must be called from a **user gesture** (click/touchend), page must be **HTTPS**; resolves `'granted' | 'denied'` (https://dev.to/li/how-to-requestpermission-for-devicemotion-and-deviceorientation-events-in-ios-13-46g2 and Apple dev forums). Third-party iframes additionally need Permissions-Policy `accelerometer`/`gyroscope` allowances (https://bugs.webkit.org/show_bug.cgi?id=221399).

```ts
async function enableGyroLook(): Promise<boolean> {
  const D = DeviceOrientationEvent as any;
  if (typeof D?.requestPermission === 'function') {        // iOS 13+
    try { if (await D.requestPermission() !== 'granted') return false; }
    catch { return false; }                                 // throws if not in a user gesture
  }
  window.addEventListener('deviceorientation', onDeviceOrientation);
  return true;
}
// Call ONLY from a click handler on a visible "Look around with your phone" button.
```

### UNVERIFIED / notes

- three.js removed `DeviceOrientationControls` from examples years ago (~r134); you must vendor the old implementation or write a small quaternion mapper (`alpha/beta/gamma` + screen orientation → camera quaternion). Known-good reference implementations exist in old three.js history and in A-Frame's `look-controls`. (Memory — verify the removal release in the migration guide.)
- Android Chrome supports `deviceorientation` without a permission prompt (subject to Permissions-Policy) and *also* offers real WebXR `immersive-ar`; the magic-window path can be the universal fallback with WebXR used when available.
- `deviceorientationabsolute` (compass-anchored) is Android-only; on iOS use `webkitCompassHeading` if you want the sky aligned to true north — important for an astronomy app's "hold phone up to the sky" mode. Test on devices.

---

## 11. Vite + TypeScript project setup, HTTPS, device testing

### VERIFIED (npm registry live queries, 2026-06-11)

- **vite 8.0.16** (2026-06-01) — current major is Vite 8.
- **typescript 6.0.3** (2026-04-16).
- **@vitejs/plugin-basic-ssl 2.3.0** (2026-03-24) — auto-generates an untrusted self-signed cert (browser warning, click through).
- **vite-plugin-mkcert 2.1.0** (2026-06-03) — uses mkcert to issue a locally **trusted** cert (no warnings on the dev machine; other LAN devices still need the CA installed or will warn).
- Scaffold: `npm create vite@latest vr-astronomy -- --template vanilla-ts` (vanilla-ts template is the right base; no framework needed). (Template name VERIFIED as a long-standing Vite convention; re-check `npm create vite` prompts on Vite 8.)

### Config sketch (synthesized)

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true },      // expose on LAN: https://<your-ip>:5173 from phone/headset
  build: { target: 'es2022' },
});
```

```jsonc
// tsconfig.json essentials
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "types": ["vite/client", "@types/three"]  // @types/three pinned to 0.184.x
  }
}
```

(Note: `three/addons/*` types resolve via `@types/three`; if TS can't find them, add `"paths": { "three/addons/*": ["node_modules/@types/three/examples/jsm/*"] }` — UNVERIFIED whether still needed with @types/three 0.184 + moduleResolution bundler.)

### HTTPS / secure-context rules (VERIFIED behavior of the platform)

- `navigator.xr.requestSession` and `DeviceOrientationEvent.requestPermission` require a **secure context**. `http://localhost` **is** a secure context (no cert needed for same-machine emulator testing!) — HTTPS only becomes necessary when testing from **another device over LAN/Internet**.
- Options for device testing (all corroborated by https://pmndrs.github.io/xr/docs/getting-started/development-setup and the plugin docs):
  1. `basicSsl()` + `vite --host` → `https://192.168.x.x:5173` on phone/headset, accept cert warning.
  2. `vite-plugin-mkcert` for a trusted local cert.
  3. **USB + adb reverse** (Quest, headset only): `adb reverse tcp:5173 tcp:5173` → open `http://localhost:5173` *on the Quest* — secure context without any certs. Also enables `chrome://inspect` remote DevTools.
  4. Tunnels for off-LAN/iPhone-without-cert-hassle: `cloudflared tunnel --url http://localhost:5173`, `ngrok http 5173`, or Tailscale Funnel — all give a real HTTPS URL. (Tool availability VERIFIED as common practice; commands from memory — confirm current CLI syntax at use time.)

---

## 12. Decisions recommended

1. **Renderer: `WebGLRenderer` now.** Wrap construction in `createRenderer()` so a later swap to `WebGPURenderer` is one file. Revisit after r185 + confirmation that Quest Browser ships WebXR-WebGPU bindings; do not enable `multiview` until #32538 is fixed.
2. **Pin `three@0.184.0` + `@types/three@0.184.x`** exactly; upgrade one release at a time against the Migration Guide. Budget for an upgrade pass every ~2 releases (~3–4 months).
3. **XR entry: `XRButton`** from `three/addons/webxr/XRButton.js` with `optionalFeatures: ['hand-tracking', 'layers']`; `renderer.xr.enabled = true`; everything through `renderer.setAnimationLoop`.
4. **Reference space `'local-floor'`**, camera-in-rig pattern; OrbitControls (orbit + look-around modes) on desktop, disabled on `sessionstart`.
5. **Input abstraction:** one `PointerLike` ray interface feeding a shared `Raycaster` picker; sources = mouse NDC, XR controller target-ray, gaze/transient-pointer. All `select*` events handled identically.
6. **Controller visuals:** `XRControllerModelFactory` + `XRHandModelFactory`; self-host the `@webxr-input-profiles/assets` profiles folder rather than relying on jsDelivr at runtime.
7. **UI: HTML/CSS for desktop+mobile, `@pmndrs/uikit` (vanilla API) for in-headset panels.** Do NOT use three-mesh-ui (dormant since 2023). Do not plan around DOM Overlay for VR (handheld-AR-only).
8. **Testing without a headset:** Immersive Web Emulator extension for interactive checks (DevTools → WebXR tab); `iwer` (2.2.1) injected for automated/CI XR tests.
9. **Quest session tuning:** query `supportedFrameRates`, target 90; `setFoveation(~0.3–0.5)` (validate visually on starfields); `framebufferScaleFactor 1.0`, drop to 0.9 only if profiling says GPU-bound.
10. **Phone fallback:** no WebXR on iOS — ship pointer-drag look-around everywhere + opt-in gyro mode via gesture-gated `DeviceOrientationEvent.requestPermission()`; vendor a DeviceOrientation camera controller.
11. **Tooling:** Vite 8 + TypeScript 6 `vanilla-ts`; `basicSsl` + `--host` for LAN device tests; `adb reverse`/`chrome://inspect` once a Quest is available; cloudflared/ngrok for remote testers.
12. Keep an eye on **Meta IWSDK** (iwsdk.dev) as a pattern reference (locomotion, grab, spatial UI with uikit, IWER-based emulation), but build on plain three.js to keep the HiPS/Gaia rendering core unconstrained.

## 13. Open questions (need runtime tests or future re-research)

1. **r185 contents** (due ~June/July 2026): does native-WebGPU-backend XR actually ship, and does Quest Browser expose the WebXR-WebGPU binding it needs? (Third-party blogs claim yes; no primary Meta source found.)
2. **Multiview bug #32538** — fixed by the time we adopt WebGPURenderer? Multiview is a big CPU/GPU win for stereo starfields, worth tracking.
3. Exact `supportedFrameRates` lists on Quest 2/3/3S in current Quest Browser (Meta doc doesn't enumerate; need a device or fresh release notes).
4. three.js **default foveation value** in r184 (`WebXRManager` source) — confirm before assuming we must lower it.
5. `XRButton.createButton` options shape in r184 (sessionInit passthrough) — read source when scaffolding.
6. Does `@pmndrs/uikit` v1.0.x vanilla API work under `WebGPURenderer` (it requires `setTransparentSort` + `localClippingEnabled` — WebGL-isms)? Test if/when we migrate renderers.
7. Immersive Web Emulator: hand-tracking emulation status in the current store build (blog said not supported as of v1.x; IWER may have gained it — check `iwer` docs).
8. iOS: precise behavior of `webkitCompassHeading` / absolute orientation for sky alignment, and whether the permission prompt is remembered across sessions (per-site, per-tab?) on iOS 18/19-era Safari.
9. Vision Pro Safari: does the transient-pointer input map cleanly onto three.js controller events (select on pinch)? No device access; verify via community reports when prioritizing visionOS.
10. Whether `vite-plugin-mkcert` or `basicSsl` plays nicer with Quest Browser's cert handling for LAN IPs (cert warnings on Quest are clickable-through but annoying; `adb reverse` avoids entirely).
