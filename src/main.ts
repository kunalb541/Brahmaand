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
import { FlyControls } from './core/flyControls';
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

// --- 3D star field (real Gaia/HYG distances) + fly controls ---
const fly = new FlyControls(rig, camera);
let starField: StarField | null = null;
StarField.load('catalogs/hyg.bin', 'catalogs/hyg.json', maxPointSize())
  .then((sf) => {
    starField = sf;
    sf.setPixelScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
    scene.add(sf.points);
  })
  .catch((e) => console.warn('star field failed to load', e));

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
  starField?.setExposure(parseFloat((e.target as HTMLInputElement).value));
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
  worldToRaDec(clickNdc, clickRd);
  void objectPanel.identifyAt(clickRd.raRad * RAD2DEG, clickRd.decRad * RAD2DEG);
});

// --- WebXR "Enter VR" (additive; shows "VR NOT SUPPORTED" on desktop without a headset) ---
const vrbtn = document.getElementById('vrbtn')!;
vrbtn.appendChild(VRButton.createButton(renderer));

// --- Resize ---
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  starField?.setPixelScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
});

// --- Dev helper: window.goto(raDeg, decDeg) ---
declare global {
  interface Window {
    goto: (raDeg: number, decDeg: number) => void;
  }
}
window.goto = (raDeg, decDeg) => controls.pointAt(raDeg * DEG2RAD, decDeg * DEG2RAD);
// debug handle
(window as unknown as { __dbg: unknown }).__dbg = { hips, scene, camera, controls, rig, fly };

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
