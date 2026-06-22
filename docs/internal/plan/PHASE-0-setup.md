# PHASE 0 — Repo scaffold & engine skeleton (execution runbook)

```yaml
phase: 0
deliverable: A running Vite + TypeScript + Three.js app ("hello cube" with resize handling
             and a stats overlay), strict tooling, one passing vitest test, git initialized.
depends_on: nothing
feeds: every later phase (PHASE-1 .. PHASE-5 build inside this skeleton)
design_docs: docs/01-architecture.md (folder layout & module boundaries; if that file is
             missing, the layout in §4 below is authoritative)
research: docs/research/threejs-webxr.md (versions, renderer factory, tooling),
          docs/research/performance-quest.md (frame-loop discipline, HUD),
          docs/research/deploy-assets.md (hosting; CI is optional in this phase)
est_effort: 1 session
```

This is a runbook for a coding agent. Execute steps in order. Every step states what to
run/create and how to know it worked. All paths are relative to the repo root
`vr-astronomy-app/` unless absolute.

---

## 0. Preconditions

1. **Node.js ≥ 22.12** (LTS) and **pnpm ≥ 9** installed.
   ```bash
   node --version   # expect v22.x or newer
   pnpm --version   # expect 9.x or newer; if missing: corepack enable && corepack prepare pnpm@latest --activate
   ```
   VERIFY: Vite 8's exact minimum Node version was not pinned by research. If `pnpm dev`
   later fails with an engine error, read the error and upgrade Node — do not downgrade Vite.
2. The repo root already contains `docs/`, `plan/`, `README.md`, `ROADMAP.md`. The web app
   goes into a new `app/` subdirectory (keeps the Python pipeline of PHASE-4 and the docs
   out of the JS toolchain's way).

---

## 1. Git init

```bash
cd /Users/kunalbhatia/Downloads/vr-astronomy-app
git init -b main
```

Create `.gitignore` at the repo root:

```gitignore
# JS
node_modules/
app/dist/
*.local
.vite/

# Python (PHASE-4 pipeline)
pipeline/.venv/
pipeline/__pycache__/
**/__pycache__/
*.pyc

# Large generated data — never commit catalogs or raw archive dumps
pipeline/data/
app/public/data/catalog/

# OS / editor
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# env / secrets (Gaia archive credentials in PHASE-4)
.env
.env.*
```

Commit checkpoint: `git add -A && git commit -m "phase-0: repo init"` (commit after each
numbered section from here on; messages `phase-0: <section>`).

---

## 2. Scaffold the Vite app

```bash
cd /Users/kunalbhatia/Downloads/vr-astronomy-app
pnpm create vite app --template vanilla-ts
cd app
pnpm install
```

If `pnpm create vite` prompts interactively, choose: framework **Vanilla**, variant
**TypeScript**.

Delete the demo files the template ships (we replace them):

```bash
rm -f src/counter.ts src/typescript.svg public/vite.svg src/style.css
```

---

## 3. Dependencies — exact versions

Pin exactly (no `^`) for the research-verified packages. From `app/`:

```bash
# runtime
pnpm add three@0.184.0 healpix-ts@1.1.0
# dev
pnpm add -D @types/three@0.184.1 typescript@6.0.3 vite@8.0.16 @vitejs/plugin-basic-ssl@2.3.0
pnpm add -D vitest
```

Then open `app/package.json` and **remove the `^` prefix** from `three`, `healpix-ts`,
`@types/three`, `typescript`, `vite`, `@vitejs/plugin-basic-ssl` if pnpm added one.
Three.js does not follow semver; `three` and `@types/three` must move in lockstep and only
deliberately (see `docs/research/threejs-webxr.md` §2).

Version provenance (all live-verified on npm 2026-06-11 — see `docs/research/threejs-webxr.md`
and `docs/research/healpix-math.md`):

| package | version | why |
|---|---|---|
| `three` | 0.184.0 (= r184) | latest stable; WebGLRenderer is the supported XR path |
| `@types/three` | 0.184.1 | lockstep types |
| `healpix-ts` | 1.1.0 | MIT, maintained, `cornersNest`/`queryDiscInclusiveNest`/hierarchy API (used from PHASE-2) |
| `typescript` | 6.0.3 | current |
| `vite` | 8.0.16 | current major |
| `@vitejs/plugin-basic-ssl` | 2.3.0 | HTTPS for later LAN/XR device testing |
| `vitest` | latest at install time | VERIFY: version not pinned by research — record what resolves in the lockfile and pin it in package.json afterwards |

Do **not** install `aladin-lite` (GPL/LGPL embed only, never a code source) or any
`healpixjs` package (commercial dual license since v2). License rules:
`docs/research/existing-projects.md`.

`package.json` scripts (replace the scripts block):

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "format": "prettier --write \"src/**/*.{ts,json}\""
  }
}
```

---

## 4. Folder skeleton

Create this tree under `app/` (empty `.gitkeep` files where needed). It matches the module
boundaries in `docs/01-architecture.md`; if that doc specifies a different layout, follow the
doc and adjust later phases' paths accordingly.

```
app/
  public/
    data/                 # vendored static data (constellations, bright stars …)
    textures/             # generated equirect placeholder (PHASE-1)
  src/
    core/                 # renderer factory, frame loop, stats HUD, input
      renderer.ts
      loop.ts
      stats.ts
    math/                 # pure math: angles, ICRS<->world frames, healpix grid (PHASE-2)
      angles.ts
      frames.ts
    sky/                  # sky sphere + HiPS engine (PHASE-1/2)
    stars/                # star field (PHASE-3)
    data/                 # survey registry, properties parser, TAP clients (PHASE-1/5)
    ui/                   # HTML/CSS UI: readouts, pickers, attribution
    workers/              # web workers (tile decode, PHASE-2)
    config/               # surveys.json + schema (PHASE-1, from docs/02-data-sources.md §3)
    main.ts
```

```bash
cd app
mkdir -p public/data public/textures src/core src/math src/sky src/stars src/data src/ui src/workers src/config
```

Convention used throughout all phases (define once, here):

- **Units:** 1 world unit = 1 parsec (matters from PHASE-3; harmless before).
- **World frame:** Three.js right-handed Y-up. ICRS→world axis mapping:
  `world.x = icrs.y`, `world.y = icrs.z` (north celestial pole = +Y), `world.z = icrs.x`
  (vernal equinox = +Z). Implemented in `src/math/frames.ts` in PHASE-1; nothing else in the
  codebase may do its own frame math.
- **Render order:** sky sphere `-100`, overlays (constellation lines) `-50`, stars `+10`,
  UI in-scene objects `+100`.
- **Frame loop:** `renderer.setAnimationLoop` only (never raw `requestAnimationFrame`) —
  this is what makes WebXR a bolt-on later. Zero allocations in steady state (no `new`,
  no array literals, no closures inside the loop) — see
  `docs/research/performance-quest.md` §8.

---

## 5. TypeScript config (strict)

Replace `app/tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "types": ["vite/client"],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,

    "useDefineForClassFields": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

Note: `three/addons/*` imports type-resolve via `@types/three`. If TS cannot find an addon
module, add
`"paths": { "three/addons/*": ["./node_modules/@types/three/examples/jsm/*"] }` —
VERIFY: usually unnecessary with `@types/three@0.184` + `moduleResolution: bundler`
(`docs/research/threejs-webxr.md` §11).

---

## 6. Vite config

Create `app/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is only needed when testing from another device (phone/headset) on the LAN —
// http://localhost is already a secure context for WebXR/device sensors.
// Run `pnpm dev` for plain localhost; `pnpm dev -- --mode ssl --host` for LAN HTTPS.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'ssl' ? [basicSsl()] : [],
  server: { host: mode === 'ssl' },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
```

(`test` is vitest's config key; vitest reads `vite.config.ts` natively. If the `test` key
errors on your vitest version, create a separate `vitest.config.ts` with the same `test`
block and `mergeConfig` — see vitest docs.)

---

## 7. ESLint + Prettier (minimal)

```bash
cd app
pnpm add -D eslint @eslint/js typescript-eslint prettier eslint-config-prettier
```

(Versions: latest at install time — VERIFY: not research-pinned; lockfile is the record.)

`app/eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // dev tool; revisit before release
    },
  },
  { ignores: ['dist/**'] },
);
```

`app/.prettierrc`:

```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

---

## 8. Core modules

### 8.1 `src/core/renderer.ts` — renderer factory

Wrap construction so a later swap to WebGPURenderer is one file
(`docs/research/threejs-webxr.md` §12 decision 1). XR flags are set now, cost nothing on
desktop, and make PHASE-5+ (VR) additive.

```ts
import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; // default in r184, made explicit
  renderer.xr.enabled = true; // harmless on desktop; required for the VR phase
  return renderer;
}
```

### 8.2 `src/core/stats.ts` — stats overlay (hand-rolled HUD)

We write our own tiny HUD instead of importing `three/addons/libs/stats.module.js` because
PHASE-2's acceptance test needs a **max-frame-time** counter, which Stats.js doesn't expose.

```ts
import type * as THREE from 'three';

export class StatsHud {
  private el: HTMLDivElement;
  private frames = 0;
  private lastReport = performance.now();
  private lastFrame = performance.now();
  private maxFrameMs = 0;
  private longFrames = 0; // frames > 50 ms since last reset (PHASE-2 acceptance metric)

  constructor(private renderer: THREE.WebGLRenderer) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;top:0;left:0;z-index:1000;font:11px monospace;' +
      'color:#0f0;background:rgba(0,0,0,.6);padding:4px 6px;pointer-events:none;white-space:pre';
    document.body.appendChild(this.el);
  }

  resetLongFrames(): void {
    this.longFrames = 0;
  }

  /** Call once per rendered frame, after renderer.render(). Allocation-free. */
  tick(): void {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > this.maxFrameMs) this.maxFrameMs = dt;
    if (dt > 50) this.longFrames++;
    this.frames++;
    if (now - this.lastReport >= 500) {
      const fps = (this.frames * 1000) / (now - this.lastReport);
      const info = this.renderer.info;
      this.el.textContent =
        `${fps.toFixed(0)} fps  max ${this.maxFrameMs.toFixed(1)} ms  long>50ms ${this.longFrames}\n` +
        `calls ${info.render.calls}  tris ${info.render.triangles}  tex ${info.memory.textures}  geo ${info.memory.geometries}`;
      this.frames = 0;
      this.maxFrameMs = 0;
      this.lastReport = now;
    }
  }
}
```

### 8.3 `src/core/loop.ts` — frame loop

```ts
import type * as THREE from 'three';

export type FrameCallback = (dtSeconds: number, timeMs: number) => void;

export function startLoop(renderer: THREE.WebGLRenderer, onFrame: FrameCallback): void {
  let last = -1;
  // setAnimationLoop (NOT requestAnimationFrame): the XR session replaces the loop
  // source transparently when a session starts. docs/research/threejs-webxr.md §4.
  renderer.setAnimationLoop((timeMs: number) => {
    const dt = last < 0 ? 0 : (timeMs - last) / 1000;
    last = timeMs;
    onFrame(Math.min(dt, 0.1), timeMs); // clamp dt across tab-suspends
  });
}
```

### 8.4 `src/math/angles.ts` — first pure-math module (test target)

```ts
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Wrap an angle in radians to [0, 2π). */
export function wrapTwoPi(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** Format RA (radians) as HHh MMm SS.Ss */
export function formatRa(raRad: number): string {
  const hours = (wrapTwoPi(raRad) * 12) / Math.PI;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = ((hours - h) * 60 - m) * 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.toFixed(1)}s`;
}

/** Format Dec (radians) as ±DD° MM′ SS″ */
export function formatDec(decRad: number): string {
  const sign = decRad < 0 ? '−' : '+';
  const deg = Math.abs(decRad) * RAD2DEG;
  const d = Math.floor(deg);
  const m = Math.floor((deg - d) * 60);
  const s = Math.round(((deg - d) * 60 - m) * 60);
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}
```

### 8.5 `src/main.ts` — hello cube

```ts
import * as THREE from 'three';
import { createRenderer } from './core/renderer';
import { startLoop } from './core/loop';
import { StatsHud } from './core/stats';

const canvas = document.createElement('canvas');
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.appendChild(canvas);

const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000208);

// Camera rig pattern from day one: XR/headset pose will drive `camera`,
// locomotion will move `rig` (docs/research/threejs-webxr.md §6).
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(0, 0, 3);
rig.add(camera);
scene.add(rig);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshNormalMaterial(),
);
scene.add(cube);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const hud = new StatsHud(renderer);

startLoop(renderer, (dt) => {
  cube.rotation.x += dt * 0.7;
  cube.rotation.y += dt * 1.1;
  renderer.render(scene, camera);
  hud.tick();
});
```

Replace `app/index.html` body content so only our script loads:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VR Astronomy</title>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

---

## 9. First vitest test

`src/math/angles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEG2RAD, formatDec, formatRa, wrapTwoPi } from './angles';

describe('angles', () => {
  it('wraps to [0, 2π)', () => {
    expect(wrapTwoPi(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(wrapTwoPi(2 * Math.PI)).toBeCloseTo(0, 12);
  });

  it('formats Vega RA/Dec (ICRS 279.2347°, +38.7837°)', () => {
    // Vega: RA 18h36m56.3s, Dec +38°47′01″
    expect(formatRa(279.2347 * DEG2RAD)).toBe('18h 36m 56.3s');
    expect(formatDec(38.7837 * DEG2RAD)).toBe('+38° 47′ 01″');
  });
});
```

---

## 10. Acceptance tests (run all; all must pass)

| # | Command / action | Expected result |
|---|---|---|
| 1 | `cd app && pnpm dev`, open `http://localhost:5173` | Spinning rainbow cube on near-black background. No console errors. |
| 2 | Watch the HUD for 10 s | `~60 fps` (or your display's refresh rate), `long>50ms 0` after the first second, `calls 1`, `tris 12`. |
| 3 | Resize the browser window | Canvas fills the window, aspect stays correct (cube not stretched). |
| 4 | `pnpm test` | 1 test file, all tests green. |
| 5 | `pnpm typecheck` | No errors under the strict flags of §5. |
| 6 | `pnpm lint` | No errors. |
| 7 | `pnpm build` | `dist/` produced; `pnpm preview` serves the same spinning cube. |
| 8 | `pnpm dev -- --mode ssl --host`, open `https://<lan-ip>:5173` from the same machine | Page loads after accepting the self-signed-cert warning (this is the XR-device path used in the VR phase). |
| 9 | `git log --oneline` | One commit per section; working tree clean. |

Optional sanity (recommended, 5 min): open Chrome DevTools → Performance → record 5 s of
the cube. The JS heap sawtooth should be flat (no per-frame allocations). This discipline is
load-bearing for VR later (`docs/research/performance-quest.md` §8).

## Exit state

A clean engine chassis: renderer factory, allocation-free loop, HUD, strict TS, tests, and
the folder skeleton every later phase fills in. PHASE-1 replaces the cube with the sky.
