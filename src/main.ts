import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createRenderer } from './core/renderer';
import { startLoop } from './core/loop';
import { StatsHud } from './core/stats';
import { LookControls } from './core/lookControls';
import { createSkySphere } from './sky/skySphere';
import { HipsLayer } from './sky/hips/hipsLayer';
import { createConstellationLines } from './sky/constellations';
import { StarLabels } from './sky/starLabels';
import { StarField } from './stars/starField';
import { TransientLayer } from './sky/transientLayer';
import { fetchNear, loadSnapshot, type Transient } from './data/transients';
import { FlyControls } from './core/flyControls';
import { XRInput } from './core/xrInput';
import { SkyReadout } from './ui/readout';
import { ObjectPanel } from './ui/objectPanel';
import { SURVEYS, type SurveyEntry } from './config/surveys';
import { DEG2RAD, RAD2DEG } from './math/angles';
import { worldToRaDec } from './math/frames';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 2000);
rig.add(camera);
scene.add(rig);

const loader = new THREE.TextureLoader();
const loadingEl = document.getElementById('loading')!;
const attribEl = document.getElementById('attrib')!;

// --- Sky sphere (real survey imagery) + live HiPS tile overlay ---
let sky: THREE.Mesh | null = null;
let currentSurvey = SURVEYS[0]!;
const hips = new HipsLayer(scene);

async function setSurvey(entry: SurveyEntry): Promise<void> {
  const texture = await loader.loadAsync(entry.texture);
  const next = createSkySphere(texture);
  if (sky) {
    scene.remove(sky);
    (sky.material as THREE.MeshBasicMaterial).map?.dispose();
    (sky.material as THREE.MeshBasicMaterial).dispose();
    sky.geometry.dispose();
  }
  sky = next;
  scene.add(sky);
  hips.setConfig(entry.hips);
  currentSurvey = entry;
  attribEl.innerHTML = `${entry.attribution} · <a href="https://aladin.cds.unistra.fr" target="_blank" rel="noopener">CDS</a>`;
  for (const b of surveyButtons) b.classList.toggle('active', b.dataset.id === entry.id);
}

// --- UI: survey switcher ---
const surveyRow = document.getElementById('surveys')!;
const surveyButtons: HTMLButtonElement[] = SURVEYS.map((s) => {
  const b = document.createElement('button');
  b.textContent = s.name;
  b.dataset.id = s.id;
  b.addEventListener('click', () => void setSurvey(s));
  surveyRow.appendChild(b);
  return b;
});

// --- Overlays ---
const controls = new LookControls(camera, canvas);
const readout = new SkyReadout(camera, document.getElementById('readout')!, canvas);
const starLabels = new StarLabels(camera);
const hud = new StatsHud(renderer);

let constellations: THREE.LineSegments | null = null;
createConstellationLines('data/constellations.lines.json')
  .then((lines) => {
    constellations = lines;
    scene.add(lines);
  })
  .catch((e) => console.warn('constellations failed to load', e));

let constellationsOn = true;
let starLabelsOn = true;
const toggleConst = document.getElementById('toggle-const') as HTMLButtonElement;
toggleConst.addEventListener('click', () => {
  constellationsOn = toggleConst.classList.toggle('active');
});
const toggleStars = document.getElementById('toggle-stars') as HTMLButtonElement;
toggleStars.addEventListener('click', () => {
  starLabelsOn = toggleStars.classList.toggle('active');
});

// --- 3D star field + fly controls ---
// Gaia DR3 (638k) is the deep field; HYG patches the very brightest naked-eye stars that
// Gaia's ruwe/parallax cuts exclude (Sirius, Vega, …). Both render with one shared exposure.
const fly = new FlyControls(rig, camera);
const starFields: StarField[] = [];
function loadField(bin: string, meta: string): void {
  StarField.load(bin, meta, maxPointSize())
    .then((sf) => {
      sf.setPixelScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
      scene.add(sf.points);
      starFields.push(sf);
    })
    .catch((e) => console.warn(`star field ${bin} failed to load`, e));
}
loadField('catalogs/gaia.bin', 'catalogs/gaia.json');
loadField('catalogs/hyg.bin', 'catalogs/hyg.json');

function maxPointSize(): number {
  const gl = renderer.getContext();
  return gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] as number;
}

// flythrough UI: exposure slider + "Return to Earth"
const flyRow = document.createElement('div');
flyRow.className = 'row';
flyRow.innerHTML =
  '<label style="font-size:11px;display:flex;align-items:center;gap:6px">exposure ' +
  '<input id="exposure" type="range" min="-3" max="3" step="0.1" value="0" style="width:90px"></label>' +
  '<button id="return-earth">Return to Earth</button>';
document.getElementById('hud')!.insertBefore(flyRow, document.querySelector('#hud .hint'));
(document.getElementById('exposure') as HTMLInputElement).addEventListener('input', (e) => {
  const stops = parseFloat((e.target as HTMLInputElement).value);
  for (const sf of starFields) sf.setExposure(stops);
});
document.getElementById('return-earth')!.addEventListener('click', () => {
  fly.reset();
  controls.fovDeg = 70;
});
document.querySelector('#hud .hint')!.textContent =
  'Drag to look · scroll to zoom · WASD/QE to fly · click a star to identify';

// --- Object info: search box + click-to-identify (SIMBAD/Sesame/hips2fits, browser-direct) ---
const objectPanel = new ObjectPanel({
  flyTo: (raDeg, decDeg, extended) => {
    fly.reset(); // return to Earth so the sky imagery frames the target
    controls.flyTo(raDeg * DEG2RAD, decDeg * DEG2RAD, extended ? 2 : 4);
  },
  getFovDeg: () => controls.fovDeg,
});

// --- Live transients ("Tonight": Rubin/LSST-precursor ZTF alerts via ALeRCE) ---
const transientLayer = new TransientLayer(scene);
const transientMap = new Map<string, Transient>();
let transientsOn = false;
const lastFetchDir = new THREE.Vector3(2, 0, 0);
const viewDir = new THREE.Vector3();
const tonightRd = { raRad: 0, decRad: 0 };

function applyTransients(): void {
  transientLayer.setTransients([...transientMap.values()], Date.now());
}
async function loadTonightSnapshot(): Promise<void> {
  for (const t of await loadSnapshot()) transientMap.set(t.oid, t);
  applyTransients();
}
async function fetchTransientsNearView(): Promise<void> {
  camera.getWorldDirection(viewDir);
  worldToRaDec(viewDir, tonightRd);
  try {
    const near = await fetchNear(tonightRd.raRad * RAD2DEG, tonightRd.decRad * RAD2DEG, 8);
    for (const t of near) transientMap.set(t.oid, t);
    applyTransients();
  } catch (e) {
    console.warn('live transient fetch failed (keeping snapshot)', e);
  }
}

const tonightBtn = document.createElement('button');
tonightBtn.textContent = '◎ Tonight';
tonightBtn.title = 'Live transient alerts (ZTF via ALeRCE)';
(document.getElementById('toggle-stars') as HTMLElement).parentElement!.appendChild(tonightBtn);
tonightBtn.addEventListener('click', () => {
  transientsOn = tonightBtn.classList.toggle('active');
  if (transientsOn) {
    fly.reset(); // transients are sky-direction objects — view from Earth
    if (transientMap.size === 0) void loadTonightSnapshot();
    void fetchTransientsNearView();
  }
});

// click (not drag) → sky direction → identify
const clickNdc = new THREE.Vector3();
const clickCamPos = new THREE.Vector3();
const clickRd = { raRad: 0, decRad: 0 };
let downX = 0;
let downY = 0;
let downT = 0;
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
  downT = performance.now();
});
canvas.addEventListener('pointerup', (e) => {
  // distinguish a click from a drag-look (small movement, short dwell)
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || performance.now() - downT > 500) return;
  clickNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1, 0.5);
  camera.getWorldPosition(clickCamPos);
  clickNdc.unproject(camera).sub(clickCamPos).normalize();
  pickSkyDirection(clickNdc);
});

/** Shared by mouse-click and the XR trigger: a transient marker wins, else SIMBAD identify. */
function pickSkyDirection(dir: THREE.Vector3): void {
  if (transientsOn && transientLayer.count) {
    const hit = transientLayer.pickNearest(dir, 0.6);
    if (hit) {
      void objectPanel.showTransient(hit);
      return;
    }
  }
  worldToRaDec(dir, clickRd);
  void objectPanel.identifyAt(clickRd.raRad * RAD2DEG, clickRd.decRad * RAD2DEG);
}

// --- WebXR controller input (PHASE-6): rays, trigger→identify, thumbstick fly + snap-turn ---
const xrInput = new XRInput(renderer, rig, camera, pickSkyDirection);

// --- WebXR "Enter VR" (additive; shows "VR NOT SUPPORTED" on desktop without a headset) ---
const vrbtn = document.getElementById('vrbtn')!;
vrbtn.appendChild(VRButton.createButton(renderer));

// --- Resize ---
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  for (const sf of starFields) sf.setPixelScale(h);
  transientLayer.setPixelScale(h);
});

// --- Dev helper: window.goto(raDeg, decDeg) ---
declare global {
  interface Window {
    goto: (raDeg: number, decDeg: number) => void;
  }
}
window.goto = (raDeg, decDeg) => controls.pointAt(raDeg * DEG2RAD, decDeg * DEG2RAD);
// debug handle
(window as unknown as { __dbg: unknown }).__dbg = {
  hips,
  scene,
  camera,
  controls,
  rig,
  fly,
  transientLayer,
  tonightBtn,
};
transientLayer.setPixelScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);

// --- Boot ---
setSurvey(currentSurvey)
  .then(() => {
    loadingEl.style.opacity = '0';
    setTimeout(() => loadingEl.remove(), 600);
    controls.pointAt(83.82 * DEG2RAD, -5.39 * DEG2RAD); // start looking at Orion
  })
  .catch((e) => {
    loadingEl.textContent = 'Failed to load sky imagery — see console.';
    console.error(e);
  });

// --- About / credits panel ---
const aboutBtn = document.createElement('button');
aboutBtn.textContent = 'ⓘ About';
(document.getElementById('toggle-stars') as HTMLElement).parentElement!.appendChild(aboutBtn);
const aboutPanel = document.createElement('div');
aboutPanel.style.cssText =
  'position:fixed;inset:0;z-index:30;display:none;place-items:center;background:rgba(2,6,14,.8);backdrop-filter:blur(4px)';
aboutPanel.innerHTML =
  '<div style="max-width:520px;background:rgba(8,14,28,.96);border:1px solid rgba(120,170,255,.25);' +
  'border-radius:14px;padding:22px 24px;font:13px ui-monospace,monospace;color:#cfe3ff;line-height:1.6">' +
  '<h2 style="margin:0 0 8px;color:#9cc4ff">★ BRAHMAAND (ब्रह्मांड)</h2>' +
  '<p style="margin:0 0 10px;color:#bcd">A real-data planetarium: real survey imagery, real-distance 3D stars, ' +
  'live transient alerts. Built on public astronomy data, no backend.</p>' +
  '<div style="font-size:12px;color:#9fb3d6">' +
  '<b>Sky imagery</b> — DSS2 (STScI) &amp; Mellinger Milky Way, via CDS HiPS / hips2fits<br>' +
  '<b>3D stars</b> — Gaia DR3 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO) + HYG (CC BY-SA 4.0); distances from parallax / Bailer-Jones<br>' +
  '<b>Object data</b> — SIMBAD, Sesame, VizieR (CDS, Strasbourg)<br>' +
  '<b>Transients</b> — ALeRCE broker · ZTF alert stream (Rubin/LSST precursor)<br>' +
  '<b>Constellations</b> — d3-celestial (BSD-3, Olaf Frohn)' +
  '</div>' +
  '<p style="margin:12px 0 0;font-size:11px;color:#5f7494">Code MIT · data per provider terms. ' +
  '<a href="https://github.com/kunalb541/Bramhaand.com" target="_blank" rel="noopener" style="color:#8aa6d6">source ↗</a></p>' +
  '<button id="about-close" style="margin-top:14px;font:inherit;font-size:12px;cursor:pointer;color:#dcebff;' +
  'background:rgba(40,70,130,.5);border:1px solid rgba(120,170,255,.3);border-radius:6px;padding:5px 12px">Close</button>' +
  '</div>';
document.body.appendChild(aboutPanel);
aboutBtn.addEventListener('click', () => (aboutPanel.style.display = 'grid'));
aboutPanel.addEventListener('click', (e) => {
  if (e.target === aboutPanel || (e.target as HTMLElement).id === 'about-close') aboutPanel.style.display = 'none';
});

// --- Service worker (offline shell + cached assets/tiles) — production only ---
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// small LOD / tile-count status
const hipsStatus = document.createElement('div');
hipsStatus.style.cssText =
  'position:fixed;bottom:8px;left:120px;z-index:10;font:11px ui-monospace,monospace;' +
  'color:#7f93b5;background:rgba(6,12,24,.55);padding:3px 7px;border-radius:6px;pointer-events:none';
document.body.appendChild(hipsStatus);

startLoop(renderer, (dt) => {
  try {
    if (!renderer.xr.isPresenting) controls.update(dt);
    fly.update(dt);
    xrInput.update(dt);

    // planetarium ↔ space mode: fade the Earth-view celestial sphere as you leave the Sun
    const dist = fly.distFromSun;
    const f = 1 - THREE.MathUtils.smoothstep(dist, 30, 150); // 1 near Earth → 0 in deep space
    const nearEarth = f > 0.4;

    if (sky) {
      sky.position.copy(rig.position); // keep the sky "at infinity", centred on the camera
      (sky.material as THREE.MeshBasicMaterial).opacity = f;
      sky.visible = f > 0.01;
    }
    if (constellations) {
      constellations.position.copy(rig.position);
      (constellations.material as THREE.LineBasicMaterial).opacity = 0.55 * f;
      constellations.visible = constellationsOn && f > 0.02;
    }
    starLabels.setVisible(starLabelsOn && f > 0.6);

    hips.setCenter(rig.position);
    hips.setVisible(nearEarth);
    if (nearEarth) hips.update(camera);
    else if (hips.tileCount) hips.clear();

    // transients: Earth-view only; refetch when the view pans far enough
    transientLayer.setCenter(rig.position);
    const showTransients = transientsOn && f > 0.5;
    transientLayer.setVisible(showTransients);
    if (showTransients) {
      camera.getWorldDirection(viewDir);
      if (viewDir.angleTo(lastFetchDir) > 0.06) {
        lastFetchDir.copy(viewDir);
        void fetchTransientsNearView();
      }
    }

    readout.update();
    starLabels.update();
    renderer.render(scene, camera);
    hud.tick(dt);

    hipsStatus.textContent =
      dist < 1
        ? hips.order
          ? `Earth view · HiPS order ${hips.order} · ${hips.tileCount} tiles`
          : 'Earth view · base sky'
        : `flying · ${dist.toFixed(1)} pc from the Sun`;
  } catch (e) {
    // surface instead of silently killing the animation loop
    (window as unknown as { __loopErr: unknown }).__loopErr = e;
    console.error('loop error:', e);
  }
});
