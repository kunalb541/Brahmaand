# PHASE 1 — Static sky sphere, look-around, RA/Dec readout (execution runbook)

```yaml
phase: 1
deliverable: Inside-out celestial sphere textured with a single full-sky image (Mellinger via
             hips2fits), inertial look-around controls with correct up-axis, live RA/Dec readout
             under the cursor, survey registry + HiPS properties fetch/parse, constellation-line
             overlay as a coordinate sanity layer.
depends_on: PHASE-0 (engine skeleton)
feeds: PHASE-2 (replaces the static texture with streamed HiPS tiles, keeps everything else),
       PHASE-5 data layer (needs pointCameraAt(ra,dec) + pointer→sky-direction picking from here)
design_docs: docs/01-architecture.md, docs/02-data-sources.md (§3 survey registry schema —
             copy it verbatim), doc 03 (HiPS rendering; if missing use the research dumps)
research: docs/research/hips-format.md (properties file, starter surveys, hips2fits),
          docs/research/tap-apis.md (hips2fits params/path trap),
          docs/research/gaia-pipeline.md §9 (ICRS→world axis mapping),
          docs/research/existing-projects.md (d3-celestial data license)
est_effort: 1–2 sessions
```

Key idea of this phase: **get the coordinate plumbing right before any HiPS complexity.**
The readout + constellation overlay form a self-checking instrument: if the lines land on
the right stars in the imagery and the readout matches published coordinates, the frame
math is correct, and PHASE-2 can trust it.

---

## 1. `src/math/frames.ts` — the single source of frame truth

Every module converts through these functions. Mapping (decided in
`docs/research/gaia-pipeline.md` §9): **world.x = icrs.y, world.y = icrs.z, world.z = icrs.x**
— right-handed, north celestial pole = world +Y, vernal equinox (RA 0, Dec 0) = world +Z.

```ts
import * as THREE from 'three';

/** ICRS unit vector from RA/Dec (radians). icrs.x→vernal equinox, icrs.z→NCP. */
export function raDecToIcrsVec(raRad: number, decRad: number, out: THREE.Vector3): THREE.Vector3 {
  const cd = Math.cos(decRad);
  return out.set(cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad));
}

/** ICRS → Three.js world axes: (x,y,z)_world = (y,z,x)_icrs */
export function icrsVecToWorld(icrs: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(icrs.y, icrs.z, icrs.x);
}

/** World → ICRS axes: (x,y,z)_icrs = (z,x,y)_world */
export function worldVecToIcrs(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(world.z, world.x, world.y);
}

/** RA/Dec (radians) directly to a world-frame unit vector. */
export function raDecToWorld(raRad: number, decRad: number, out: THREE.Vector3): THREE.Vector3 {
  const cd = Math.cos(decRad);
  // world.x=icrs.y, world.y=icrs.z, world.z=icrs.x
  return out.set(cd * Math.sin(raRad), Math.sin(decRad), cd * Math.cos(raRad));
}

/** World-frame unit vector to {raRad ∈ [0,2π), decRad}. Allocation-free via out param. */
export function worldToRaDec(world: THREE.Vector3, out: { raRad: number; decRad: number }): void {
  out.decRad = Math.asin(THREE.MathUtils.clamp(world.y, -1, 1));
  const ra = Math.atan2(world.x, world.z);
  out.raRad = ra < 0 ? ra + 2 * Math.PI : ra;
}
```

`src/math/frames.test.ts` (lock the convention with known stars; ICRS coords from SIMBAD):

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEG2RAD } from './angles';
import { raDecToWorld, worldToRaDec } from './frames';

const v = new THREE.Vector3();
const rd = { raRad: 0, decRad: 0 };

describe('frames', () => {
  it('NCP is world +Y', () => {
    raDecToWorld(0, Math.PI / 2, v);
    expect(v.y).toBeCloseTo(1, 12);
  });
  it('RA0/Dec0 (vernal equinox) is world +Z', () => {
    raDecToWorld(0, 0, v);
    expect(v.z).toBeCloseTo(1, 12);
    expect(v.x).toBeCloseTo(0, 12);
  });
  it('RA 90° / Dec 0 is world +X (RA increases x-ward from z)', () => {
    raDecToWorld(Math.PI / 2, 0, v);
    expect(v.x).toBeCloseTo(1, 12);
  });
  it('round-trips Vega (279.2347°, +38.7837°)', () => {
    raDecToWorld(279.2347 * DEG2RAD, 38.7837 * DEG2RAD, v);
    worldToRaDec(v, rd);
    expect(rd.raRad / DEG2RAD).toBeCloseTo(279.2347, 6);
    expect(rd.decRad / DEG2RAD).toBeCloseTo(38.7837, 6);
  });
});
```

---

## 2. Generate the placeholder full-sky texture (one-time, offline)

Use **hips2fits** to render the Mellinger HiPS into a plate-carrée (equirectangular) image
in ICRS. This sidesteps Mellinger's galactic HiPS frame entirely — the service reprojects
server-side. Endpoint + CORS verified live 2026-06-11 (`docs/research/tap-apis.md` §6);
the path **must** include `/hips-image-services/` (bare `/hips2fits` is a 404).

```bash
cd /Users/kunalbhatia/Downloads/vr-astronomy-app
curl -G "https://alasky.cds.unistra.fr/hips-image-services/hips2fits" \
  --data-urlencode "hips=CDS/P/Mellinger/color" \
  --data-urlencode "projection=CAR" \
  --data-urlencode "coordsys=icrs" \
  --data-urlencode "ra=0" --data-urlencode "dec=0" \
  --data-urlencode "fov=360" \
  --data-urlencode "width=4096" --data-urlencode "height=2048" \
  --data-urlencode "format=jpg" \
  -o app/public/textures/sky-mellinger-icrs-4k.jpg
file app/public/textures/sky-mellinger-icrs-4k.jpg   # expect "JPEG image data, ... 4096x2048"
```

- VERIFY: `projection=CAR` with `fov=360` producing a clean full-sky equirect was not
  live-tested in research (the service and its `projection` parameter were; the 50 Mpixel
  cap allows 4096×2048). If the output looks wrong (clipped/repeated sky), fallbacks in
  order: (a) `width=4002&height=2001&fov=360.0`-style tweaks, (b) use
  `hips=CDS/P/DSS2/color` instead, (c) skip the static texture and proceed to PHASE-2's
  Allsky bootstrap, keeping a plain dark sphere here.
- Generate **once** and commit the JPEG (~1–2 MB). Do not hotlink hips2fits per page load —
  cutout generation is CPU-bound server-side (`docs/research/tap-apis.md` §6).
- Mellinger attribution (show in the footer in §7): "Mellinger Milky Way Panorama —
  A. Mellinger / CDS HiPS" with the survey's `obs_copyright` once fetched.

---

## 3. `src/sky/skySphere.ts` — inside-out sphere

```ts
import * as THREE from 'three';

export const SKY_RADIUS = 100; // world units; arbitrary (depth is not used for the sky)

export function createStaticSkySphere(texture: THREE.Texture): THREE.Mesh {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; // allows RA-offset calibration via texture.offset.x
  texture.anisotropy = 8;

  const geo = new THREE.SphereGeometry(SKY_RADIUS, 96, 48);
  geo.scale(-1, 1, 1); // view from inside without mirroring the image

  const mat = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100; // always behind everything
  mesh.frustumCulled = false; // camera sits inside the sphere
  return mesh;
}
```

### Texture orientation derivation + calibration

Three.js `SphereGeometry` maps texture u→azimuth, v→polar with the +Y pole at v=0 and
`uv.y = 1 − v`, so the image **top row lands on Dec +90** — correct for an equirect with
north up. After `geo.scale(-1,1,1)`, the vertex direction at parameter u is
`(cos φ·sinθ, cosθ, sin φ·sinθ)` with `φ = u·2π`, i.e. `ra = π/2 − φ`. A FITS-convention
CAR image centered on RA 0 has RA increasing **leftward** (east-left sky convention).
The combined result is expected to need only a constant RA offset:

```ts
sky.rotation.y = Math.PI / 2; // starting guess — calibrate below
```

**Calibration procedure (mandatory, do after §5 readout works):**

1. Point the cursor at the Orion belt/M42 region in the imagery; the readout should say
   roughly RA 5h35m, Dec −5°23′ (M42). If RA is offset by a constant, adjust
   `sky.rotation.y` in steps of `Math.PI/2`; for fine alignment use
   `texture.offset.x` (one full RA turn = offset 1.0).
2. If the sky is **mirrored** (constellation shapes backwards, e.g. Orion's belt slants
   the wrong way vs a planetarium reference), remove/add the `geo.scale(-1,1,1)` and set
   `material.side = THREE.BackSide` instead, then redo step 1.
3. Record the final constants in code with a comment `// calibrated PHASE-1 §3`.

This is throwaway precision (PHASE-2 replaces this mesh), but the calibration exercise
validates the frame math that PHASE-2 depends on.

---

## 4. `src/core/lookControls.ts` — inertial look-around

Up-axis = world +Y (NCP). Pitch clamped to avoid pole flip. Drag scale follows FOV so
panning feels right when zoomed. Includes `pointAt(raRad, decRad)` (required later by the
data-layer phase's "search → fly to object").

```ts
import * as THREE from 'three';
import { raDecToWorld } from '../math/frames';

export class LookControls {
  yaw = 0;        // rotation around +Y; yaw=0 looks along +Z (RA 0, Dec 0)
  pitch = 0;      // radians, + looks north
  fovDeg = 60;

  private velYaw = 0;
  private velPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly damping = 6; // 1/s — higher = less inertia
  private readonly minFov = 0.5;
  private readonly maxFov = 100;
  private targetDir = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const radPerPx = (this.fovDeg * Math.PI) / 180 / dom.clientHeight;
      const dx = (e.clientX - this.lastX) * radPerPx;
      const dy = (e.clientY - this.lastY) * radPerPx;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw += dx;       // drag right → sky moves right (camera pans left)
      this.pitch += dy;
      this.velYaw = dx * 60;   // seed inertia (per-second velocity)
      this.velPitch = dy * 60;
      this.clampPitch();
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.fovDeg = THREE.MathUtils.clamp(
          this.fovDeg * Math.pow(1.0015, e.deltaY),
          this.minFov,
          this.maxFov,
        );
      },
      { passive: false },
    );
  }

  /** Aim the camera at an ICRS position (used by search/goto). */
  pointAt(raRad: number, decRad: number): void {
    raDecToWorld(raRad, decRad, this.targetDir);
    this.pitch = Math.asin(THREE.MathUtils.clamp(this.targetDir.y, -1, 1));
    this.yaw = -Math.atan2(this.targetDir.x, this.targetDir.z);
    this.velYaw = this.velPitch = 0;
    this.clampPitch();
  }

  update(dt: number): void {
    if (!this.dragging) {
      const k = Math.exp(-this.damping * dt);
      this.yaw += this.velYaw * dt;
      this.pitch += this.velPitch * dt;
      this.velYaw *= k;
      this.velPitch *= k;
      this.clampPitch();
    }
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, -this.yaw, 0, 'YXZ'));
    if (this.camera.fov !== this.fovDeg) {
      this.camera.fov = this.fovDeg;
      this.camera.updateProjectionMatrix();
    }
  }

  private clampPitch(): void {
    const lim = Math.PI / 2 - 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);
  }
}
```

Note: the `new THREE.Euler` inside `update` violates the zero-allocation rule — hoist it
to a module-scope scratch (`const EULER = new THREE.Euler(0,0,0,'YXZ')`) and reuse. (Left
inline above for clarity; fix it when transcribing.)

Sign conventions (drag direction, yaw sign) are taste — flip signs until: **dragging the
sky right moves the sky right, and dragging up moves the sky up** (planetarium "grab the
sky" convention; verify against Aladin Lite's feel).

---

## 5. RA/Dec readout under the cursor

With the camera at the sphere's center, the pointer direction **is** the sky direction —
no mesh intersection needed, just unproject the NDC point.

`src/ui/readout.ts`:

```ts
import * as THREE from 'three';
import { worldToRaDec } from '../math/frames';
import { formatDec, formatRa } from '../math/angles';

const ndc = new THREE.Vector3();
const rd = { raRad: 0, decRad: 0 };

export class SkyReadout {
  private el: HTMLDivElement;
  private mouseX = -1;
  private mouseY = -1;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;bottom:8px;left:8px;z-index:1000;font:13px monospace;color:#9cf;' +
      'background:rgba(0,0,0,.55);padding:4px 8px;pointer-events:none';
    document.body.appendChild(this.el);
    dom.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  /**
   * Pointer pixel → world-frame sky direction. Reused by PHASE-5 picking.
   * Returns false if no pointer position is known yet.
   */
  skyDirectionFromPointer(out: THREE.Vector3): boolean {
    if (this.mouseX < 0) return false;
    ndc.set(
      (this.mouseX / window.innerWidth) * 2 - 1,
      -(this.mouseY / window.innerHeight) * 2 + 1,
      0.5,
    );
    out.copy(ndc).unproject(this.camera).sub(this.camera.getWorldPosition(ndc)).normalize();
    return true;
  }

  private dir = new THREE.Vector3();

  /** Call once per frame (cheap; or throttle to ~15 Hz). */
  update(): void {
    if (!this.skyDirectionFromPointer(this.dir)) return;
    worldToRaDec(this.dir, rd);
    this.el.textContent = `RA ${formatRa(rd.raRad)}   Dec ${formatDec(rd.decRad)}`;
  }
}
```

Careful: `out.copy(ndc).unproject(...)` then subtracting the camera world position reuses
`ndc` as scratch — that is intentional and allocation-free, but order matters (unproject
first, then fetch camera position into the scratch).

---

## 6. Survey registry + HiPS properties parser

The registry **schema and starter instance live in `docs/02-data-sources.md` §3.1–3.2 —
copy them verbatim**: the JSON Schema to `src/config/survey-registry.schema.json`, the
TypeScript `HipsSurveyDescriptor` interface to `src/sky/types.ts`, and the six-survey
registry instance (DSS2, Pan-STARRS DR1, SDSS9, Mellinger, 2MASS, Rubin First Look) to
`src/config/surveys.json`.

### 6.1 `src/data/hipsProperties.ts`

Parser (from `docs/research/hips-format.md` §2, spec-compliant) + fetch with mirror
failover + merge into the descriptor:

```ts
import type { HipsSurveyDescriptor } from '../sky/types';

export function parseHipsProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Fetch {base}/properties with [primary, ...mirror] failover. */
export async function fetchHipsProperties(
  baseUrls: readonly string[],
): Promise<Record<string, string>> {
  let lastErr: unknown;
  for (const base of baseUrls) {
    try {
      const r = await fetch(`${base}/properties`, { mode: 'cors' });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${base}/properties`);
      return parseHipsProperties(await r.text());
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all mirrors failed');
}

/** Runtime truth wins over the static registry (except baseUrls). */
export function mergeProperties(
  d: HipsSurveyDescriptor,
  p: Record<string, string>,
): HipsSurveyDescriptor {
  return {
    ...d,
    maxOrder: p['hips_order'] !== undefined ? Number(p['hips_order']) : d.maxOrder,
    tileWidth: p['hips_tile_width'] !== undefined ? Number(p['hips_tile_width']) : (d.tileWidth ?? 512),
    tileFormats:
      p['hips_tile_format'] !== undefined
        ? (p['hips_tile_format'].split(/\s+/) as HipsSurveyDescriptor['tileFormats'])
        : d.tileFormats,
    frame: (p['hips_frame'] as HipsSurveyDescriptor['frame']) ?? d.frame,
    skyFraction: p['moc_sky_fraction'] !== undefined ? Number(p['moc_sky_fraction']) : d.skyFraction,
    attribution: {
      ...d.attribution,
      text: p['obs_copyright'] ?? d.attribution.text,
      url: p['obs_copyright_url'] ?? d.attribution.url,
      license: p['hips_license'] ?? d.attribution.license,
    },
  };
}
```

Trap (carry from research): **never derive pixel scale from `hips_pixel_scale`** — DSS2
publishes an inconsistent value. Compute from order + tile width (PHASE-2 does).

### 6.2 Test with a fixture

`src/data/hipsProperties.test.ts` — embed the live-verified DSS2 properties text from
`docs/research/hips-format.md` §2 as a string fixture and assert:
`hips_order === '9'`, `hips_frame === 'equatorial'`, `hips_tile_width === '512'`,
`hips_tile_format === 'jpeg'`, comment/blank lines skipped, whitespace around `=` trimmed.
Plus a merge test: `mergeProperties(dss2Descriptor, parsed).maxOrder === 9`.

### 6.3 Boot-time registry load

`src/data/surveys.ts`:

```ts
import rawRegistry from '../config/surveys.json';
import type { HipsSurveyDescriptor } from '../sky/types';
import { fetchHipsProperties, mergeProperties } from './hipsProperties';

export const REGISTRY = rawRegistry as HipsSurveyDescriptor[];

export async function loadSurvey(id: string): Promise<HipsSurveyDescriptor> {
  const entry = REGISTRY.find((s) => s.id === id);
  if (!entry) throw new Error(`unknown survey: ${id}`);
  return mergeProperties(entry, await fetchHipsProperties(entry.baseUrls));
}
```

In `main.ts`, call `loadSurvey('dss2-color')` at startup and `console.table` the merged
descriptor (proves live CORS fetch works; PHASE-2 consumes it for real).

---

## 7. Constellation-line overlay

Source: **d3-celestial** data files, BSD-3-Clause (license gate verified in
`docs/research/existing-projects.md`). Vendor the file — do not hotlink GitHub raw at
runtime:

```bash
curl -L -o app/public/data/constellations.lines.json \
  https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json
```

Add the BSD-3 notice: create `app/public/data/LICENSE-d3-celestial.txt` with the BSD-3
license text from https://github.com/ofrohn/d3-celestial/blob/master/LICENSE and the line
"constellations.lines.json from d3-celestial © Olaf Frohn".

Format: GeoJSON `FeatureCollection`; each feature is a `MultiLineString`;
`coordinates = [[[lon, lat], ...], ...]` in **degrees** with `lon = RA mapped to
[−180, 180]` (negative lon ⇒ RA = lon + 360) and `lat = Dec`. VERIFY on first load: log
`features[0]` and confirm the shape; if the repo layout changed, any GeoJSON constellation
line set works (adjust the parse accordingly).

`src/sky/constellations.ts`:

```ts
import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';
import { SKY_RADIUS } from './skySphere';

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const P = new THREE.Vector3();

export async function createConstellationLines(): Promise<THREE.LineSegments> {
  const geojson = (await (await fetch('/data/constellations.lines.json')).json()) as {
    features: { geometry: { type: string; coordinates: number[][][] } }[];
  };

  const positions: number[] = [];
  const R = SKY_RADIUS * 0.99; // just inside the sky sphere

  for (const f of geojson.features) {
    if (f.geometry.type !== 'MultiLineString') continue;
    for (const line of f.geometry.coordinates) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [lon1, lat1] = line[i]!;
        const [lon2, lat2] = line[i + 1]!;
        raDecToWorld(((lon1! + 360) % 360) * DEG2RAD, lat1! * DEG2RAD, A);
        raDecToWorld(((lon2! + 360) % 360) * DEG2RAD, lat2! * DEG2RAD, B);
        // Subdivide along the great circle (chords would cut visibly inside the sphere)
        const steps = Math.max(1, Math.ceil((A.angleTo(B) / DEG2RAD) / 2)); // ~2° segments
        for (let s = 0; s < steps; s++) {
          for (const t of [s / steps, (s + 1) / steps]) {
            P.copy(A).lerp(B, t).normalize().multiplyScalar(R);
            positions.push(P.x, P.y, P.z);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x3a6ea5,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = -50; // above sky (-100), below everything else
  lines.frustumCulled = false;
  return lines;
}
```

Add a `C` key handler (or a checkbox in `src/ui/`) toggling `lines.visible`.

---

## 8. Wire it together (`src/main.ts` replaces the cube)

```ts
import * as THREE from 'three';
import { createRenderer } from './core/renderer';
import { startLoop } from './core/loop';
import { StatsHud } from './core/stats';
import { LookControls } from './core/lookControls';
import { createStaticSkySphere } from './sky/skySphere';
import { createConstellationLines } from './sky/constellations';
import { SkyReadout } from './ui/readout';
import { loadSurvey } from './data/surveys';

const canvas = document.createElement('canvas');
document.body.style.margin = '0';
document.body.appendChild(canvas);

const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);
rig.add(camera);
scene.add(rig);

const tex = await new THREE.TextureLoader().loadAsync('/textures/sky-mellinger-icrs-4k.jpg');
const sky = createStaticSkySphere(tex);
sky.rotation.y = Math.PI / 2; // calibrate per §3
scene.add(sky);

scene.add(await createConstellationLines());

const controls = new LookControls(camera, canvas);
const readout = new SkyReadout(camera, canvas);
const hud = new StatsHud(renderer);

loadSurvey('dss2-color').then((s) => console.table(s)); // registry smoke test

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

startLoop(renderer, (dt) => {
  controls.update(dt);
  readout.update();
  renderer.render(scene, camera);
  hud.tick();
});
```

(Top-level `await` is fine with Vite's es2022 target.)

Debug helper for calibration and later phases — expose on `window` in dev:

```ts
import { DEG2RAD } from './math/angles';
declare global { interface Window { goto: (raDeg: number, decDeg: number) => void } }
window.goto = (raDeg, decDeg) => controls.pointAt(raDeg * DEG2RAD, decDeg * DEG2RAD);
```

---

## 9. Acceptance tests

| # | Action | Expected |
|---|---|---|
| 1 | `pnpm dev` → open app | Full-sky Milky Way panorama surrounds you; HUD ≥ 60 fps; no console errors. |
| 2 | Drag and release | Sky follows the "grab the sky" convention; inertia glides to a stop in ~0.5 s. |
| 3 | Drag pitch to either pole | View clamps just short of the pole; no flip/roll. |
| 4 | Wheel zoom | FOV glides between 0.5° and 100°; pan speed scales with zoom (no over-twitchy pan at 1°). |
| 5 | `window.goto(83.82, -5.39)` in the console | Camera centers on the Orion sword region; M42 visible in the imagery. |
| 6 | Hover the cursor over M42 | Readout ≈ `RA 05h 35m, Dec −05° 23′` (±1°). Repeat for Polaris (`02h 31m, +89° 16′` — point near the +Y pole) and Vega (`18h 36m, +38° 47′`). |
| 7 | Press `C` | Constellation lines toggle; Orion's hourglass figure lands on Orion's stars in the imagery (this is the combined frame+texture calibration check — if lines match coordinates but imagery is offset, recalibrate §3; if lines are mirrored, the frame mapping is wrong — fix `frames.ts`, not the texture). |
| 8 | Network tab on load | Exactly one texture fetch + one `constellations.lines.json` + one `properties` fetch (CORS OK, status 200). No hips2fits calls at runtime. |
| 9 | `pnpm test` | angles, frames, hipsProperties suites green. |
| 10 | `pnpm typecheck && pnpm lint && pnpm build` | Clean. |

## Exit state

A correctly-oriented static sky with trustworthy coordinate plumbing, controls, readout,
registry, and a sanity overlay. PHASE-2 deletes only `createStaticSkySphere`'s usage and
streams real HiPS tiles into the same scene.
