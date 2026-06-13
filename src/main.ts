import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createRenderer } from './core/renderer';
import { startLoop } from './core/loop';
import { StatsHud } from './core/stats';
import { LookControls } from './core/lookControls';
import { createSkySphere } from './sky/skySphere';
import { HipsLayer } from './sky/hips/hipsLayer';
import { createConstellationLines } from './sky/constellations';
import { createEquatorialGrid, createEquator, createEcliptic, createGalacticEquator } from './sky/grids';
import { SolarSystemLayer } from './sky/solarSystem';
import { solarSystemAt } from './data/ephemeris';
import { getSimMs, getRate, setRate, setSimMs, resetToNow, isLive } from './core/simTime';
import { StarLabels } from './sky/starLabels';
import { StarField } from './stars/starField';
import { TransientLayer } from './sky/transientLayer';
import {
  fetchNear,
  loadSnapshot,
  getBroker,
  setBroker,
  classGroup,
  ageDays,
  GROUP_LIST,
  GROUP_LABEL,
  GROUP_COLOR,
  type Transient,
  type TransientGroup,
} from './data/transients';
import { CatalogOverlay } from './sky/catalogOverlay';
import { CATALOGS, fetchCatalog, type CatalogPreset } from './data/vizier';
import { FlyControls } from './core/flyControls';
import { DeviceSky } from './core/deviceSky';
import { XRInput } from './core/xrInput';
import { SkyReadout } from './ui/readout';
import { ObjectPanel } from './ui/objectPanel';
import { SURVEYS, type SurveyEntry } from './config/surveys';
import { getMode, setMode, onModeChange, isPro } from './config/mode';
import { initHelpPanel } from './ui/helpPanel';
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

async function setSurvey(entry: SurveyEntry, opts?: { jump?: boolean }): Promise<void> {
  // Surveys with an equirect texture (DSS2, Milky Way) also reset the all-sky base sphere;
  // high-res surveys (texture: null) keep the current base and just stream tiles on top.
  if (entry.texture) {
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
  }
  hips.setConfig(entry.hips);
  currentSurvey = entry;
  applySkyExposure();
  attribEl.innerHTML = `${entry.attribution} · <a href="https://aladin.cds.unistra.fr" target="_blank" rel="noopener">CDS</a>`;
  for (const b of surveyButtons) b.classList.toggle('active', b.dataset.id === entry.id);

  // A user CLICK should visibly do something at any zoom: field surveys fly to a famous
  // covered target; wide HiPS surveys zoom in place past the tile-streaming threshold
  // (tiles only stream below ~3.5° FOV — at wide field only the all-sky base is visible).
  if (opts?.jump) {
    if (entry.target) {
      fly.reset();
      controls.flyTo(entry.target.raDeg * DEG2RAD, entry.target.decDeg * DEG2RAD, entry.target.fovDeg);
    } else if (entry.hips && !entry.texture && controls.fovDeg > 3.2) {
      camera.getWorldDirection(jumpDir);
      worldToRaDec(jumpDir, jumpRd);
      controls.flyTo(jumpRd.raRad, jumpRd.decRad, 2.5);
    }
  }
}
const jumpDir = new THREE.Vector3();
const jumpRd = { raRad: 0, decRad: 0 };

// Base-sphere brightness: the exposure slider drives the sky sphere too (DSS2 gets a default
// boost — the vendored all-sky JPEG is dark, which is why the Milky Way band was invisible).
let skyStops = 0;
function applySkyExposure(): void {
  if (!sky) return;
  const boost = currentSurvey.id === 'dss2' ? 1.7 : 1;
  (sky.material as THREE.MeshBasicMaterial).color.setScalar(boost * Math.pow(2, skyStops));
}

// --- UI: survey switcher (PRO only — the public doesn't pick observatories; see auto-survey) ---
const surveyRow = document.getElementById('surveys')!;
surveyRow.classList.add('pro-only');
const surveyButtons: HTMLButtonElement[] = SURVEYS.map((s) => {
  const b = document.createElement('button');
  b.textContent = s.name;
  b.dataset.id = s.id;
  b.title = `${s.hemisphere} · ${s.resolution}/px · zoom in to stream`;
  b.addEventListener('click', () => void setSurvey(s, { jump: true }));
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

// reference grids & lines (Stellarium-style) — accurate great/small circles on the sphere
const equGrid = createEquatorialGrid();
const equator = createEquator();
const ecliptic = createEcliptic();
const galactic = createGalacticEquator();
const gridGroup = new THREE.Group();
gridGroup.add(equGrid, equator, ecliptic, galactic);
scene.add(gridGroup);
const gridOn = { equ: false, ecl: false, gal: false };
const wireGrid = (id: string, key: keyof typeof gridOn) => {
  const btn = document.getElementById(id) as HTMLButtonElement;
  btn.addEventListener('click', () => (gridOn[key] = btn.classList.toggle('active')));
};
wireGrid('toggle-grid', 'equ');
wireGrid('toggle-ecliptic', 'ecl');
wireGrid('toggle-galactic', 'gal');

// --- Solar system (Sun, Moon with phase, planets) + the time machine ---
const solar = new SolarSystemLayer(scene);
let solarOn = true;
{
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<button id="toggle-solar" class="active" title="Sun, Moon (with phase) and planets at their real ephemeris positions">Planets</button>';
  document.getElementById('sec-overlays')!.appendChild(row);
  document.getElementById('toggle-solar')!.addEventListener('click', (e) => {
    solarOn = (e.currentTarget as HTMLButtonElement).classList.toggle('active');
  });
}

// time-machine bar: rate steps (negative = backwards), date jump, return-to-now
const RATE_STEPS = [-31536000, -2592000, -86400, -3600, -60, -1, 0, 1, 60, 3600, 86400, 2592000, 31536000];
const rateLabel = (r: number): string =>
  r === 0 ? '⏸ paused' :
  Math.abs(r) === 1 ? (r > 0 ? '× real time' : '× −real time') :
  Math.abs(r) === 60 ? `× ${r > 0 ? '' : '−'}1 min/s` :
  Math.abs(r) === 3600 ? `× ${r > 0 ? '' : '−'}1 h/s` :
  Math.abs(r) === 86400 ? `× ${r > 0 ? '' : '−'}1 day/s` :
  Math.abs(r) === 2592000 ? `× ${r > 0 ? '' : '−'}1 mo/s` : `× ${r > 0 ? '' : '−'}1 yr/s`;
const timebar = document.getElementById('timebar')!;
const timeDisplay = document.getElementById('time-display')!;
const timeRate = document.getElementById('time-rate')!;
const stepRate = (dir: 1 | -1): void => {
  const i = RATE_STEPS.indexOf(getRate());
  const j = Math.min(RATE_STEPS.length - 1, Math.max(0, (i < 0 ? RATE_STEPS.indexOf(1) : i) + dir));
  setRate(RATE_STEPS[j]!);
};
document.getElementById('t-slower')!.addEventListener('click', () => stepRate(-1));
document.getElementById('t-faster')!.addEventListener('click', () => stepRate(1));
document.getElementById('t-pause')!.addEventListener('click', () => setRate(getRate() === 0 ? 1 : 0));
document.getElementById('t-back1d')!.addEventListener('click', () => setSimMs(getSimMs() - 86400000));
document.getElementById('t-fwd1d')!.addEventListener('click', () => setSimMs(getSimMs() + 86400000));
document.getElementById('t-now')!.addEventListener('click', resetToNow);
timeDisplay.addEventListener('click', () => {
  const cur = new Date(getSimMs());
  const pad = (n: number): string => String(n).padStart(2, '0');
  const local = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:${pad(cur.getMinutes())}`;
  const v = prompt('Set date & time (local, YYYY-MM-DDTHH:MM):', local);
  if (v) {
    const ms = new Date(v).getTime();
    if (isFinite(ms)) setSimMs(ms);
  }
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

// flythrough UI: exposure slider (Imagery section) + "Return to Earth" / Share (Tools section)
const expRow = document.createElement('div');
expRow.className = 'row pro-only';
expRow.innerHTML =
  '<label style="display:flex;align-items:center;gap:6px;width:100%">exposure ' +
  '<input id="exposure" type="range" min="-3" max="3" step="0.1" value="0" style="flex:1;min-width:80px"></label>';
document.getElementById('sec-imagery')!.appendChild(expRow);
const toolsRow = document.createElement('div');
toolsRow.className = 'row';
toolsRow.innerHTML =
  '<button id="return-earth">⌂ Return to Earth</button>' +
  '<button id="share-view" title="copy a link to this exact view">⌁ Share</button>' +
  '<button id="toggle-fov" title="Field-of-view framing circle (cycles common eyepiece/detector sizes)">⊕ FOV</button>';
document.getElementById('sec-tools')!.appendChild(toolsRow);

// FOV framing tool: a centred circle of a chosen TRUE angular diameter, scaling with zoom — frames
// an eyepiece / detector / finder field (a Stellarium "ocular"-style aid). Cycles preset sizes.
const fovPresets: { deg: number; label: string }[] = [
  { deg: 5, label: '5° finder' },
  { deg: 1, label: '1°' },
  { deg: 0.5, label: '30′' },
  { deg: 0.25, label: '15′ eyepiece' },
  { deg: 1 / 12, label: '5′ detector' },
];
let fovIdx = -1; // -1 = off
const fovRing = document.createElement('div');
fovRing.style.cssText =
  'position:absolute;left:50%;top:50%;border:1.5px solid rgba(111,227,255,.8);border-radius:50%;' +
  'box-shadow:0 0 8px rgba(111,227,255,.4);pointer-events:none;display:none;transform:translate(-50%,-50%)';
const fovLabel = document.createElement('div');
fovLabel.style.cssText =
  'position:absolute;left:50%;top:50%;margin-top:-2px;transform:translate(-50%,calc(-50% - 0px));' +
  'pointer-events:none;display:none;color:#9fe0ff;font:11px ui-monospace,monospace;text-shadow:0 0 4px #000';
document.getElementById('skyspace')!.append(fovRing, fovLabel);
document.getElementById('toggle-fov')!.addEventListener('click', () => {
  fovIdx = fovIdx >= fovPresets.length - 1 ? -1 : fovIdx + 1;
  const btn = document.getElementById('toggle-fov')!;
  btn.classList.toggle('active', fovIdx >= 0);
  btn.textContent = fovIdx < 0 ? '⊕ FOV' : `⊕ ${fovPresets[fovIdx]!.label}`;
});
(document.getElementById('exposure') as HTMLInputElement).addEventListener('input', (e) => {
  const stops = parseFloat((e.target as HTMLInputElement).value);
  for (const sf of starFields) sf.setExposure(stops);
  skyStops = stops;
  applySkyExposure(); // base sky imagery brightens/darkens with the same stops
});
document.getElementById('return-earth')!.addEventListener('click', () => {
  fly.reset();
  controls.fovDeg = 70;
});
const shareBtn = document.getElementById('share-view')!;
shareBtn.addEventListener('click', () => {
  const url = location.origin + location.pathname + currentViewHash();
  history.replaceState(null, '', url);
  void navigator.clipboard?.writeText(url).then(
    () => {
      const o = shareBtn.textContent;
      shareBtn.textContent = '✓ Copied';
      setTimeout(() => (shareBtn.textContent = o), 1200);
    },
    () => {},
  );
});
const isTouch = matchMedia('(pointer: coarse)').matches; // (controls guide lives in ? Help)

// --- Touch controls (phones/tablets): a fly joystick + a gyro "move phone to look" toggle ---
const deviceSky = new DeviceSky(controls);
if (isTouch) {
  // gyro toggle — lives INSIDE the sky area (#skyspace), so it can never cover the bars
  const gyroBtn = document.createElement('button');
  gyroBtn.textContent = '📱 Move-to-look';
  gyroBtn.style.cssText =
    'position:absolute;left:50%;transform:translateX(-50%);bottom:14px;' +
    'font:12px ui-monospace,monospace;color:#dcebff;background:rgba(40,70,130,.6);border:1px solid rgba(120,170,255,.4);' +
    'border-radius:18px;padding:7px 14px';
  document.getElementById('skyspace')!.appendChild(gyroBtn);
  let gyroPoll: ReturnType<typeof setInterval> | null = null;
  gyroBtn.addEventListener('click', async () => {
    if (deviceSky.enabled) {
      deviceSky.disable();
      gyroBtn.style.background = 'rgba(40,70,130,.6)';
      gyroBtn.textContent = '📱 Move-to-look';
      if (gyroPoll) {
        clearInterval(gyroPoll);
        gyroPoll = null;
      }
    } else if (await deviceSky.enable()) {
      gyroBtn.style.background = 'rgba(90,140,230,.85)';
      // reflect whether a real-sky (GPS+compass) lock came through, or relative-only
      gyroPoll = setInterval(() => {
        gyroBtn.textContent = deviceSky.absolute ? '📡 Sky-locked (GPS)' : '📱 Move-to-look';
      }, 1000);
    } else {
      gyroBtn.textContent = '📱 motion blocked';
    }
  });

  // fly joystick (bottom-left of the sky area): drag the nub → fly.touchFwd / touchStrafe
  const pad = document.createElement('div');
  pad.style.cssText =
    'position:absolute;left:14px;bottom:58px;' +
    'width:96px;height:96px;border-radius:50%;background:rgba(20,30,55,.5);border:1px solid rgba(120,170,255,.3);touch-action:none';
  const nub = document.createElement('div');
  nub.style.cssText =
    'position:absolute;left:50%;top:50%;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:rgba(120,170,255,.7)';
  pad.appendChild(nub);
  document.getElementById('skyspace')!.appendChild(pad);
  let padId = -1;
  const R = 38;
  const setNub = (dx: number, dy: number) => {
    const m = Math.hypot(dx, dy) || 1;
    const c = Math.min(m, R);
    const nx = (dx / m) * c;
    const ny = (dy / m) * c;
    nub.style.transform = `translate(${nx}px,${ny}px)`;
    fly.touchStrafe = nx / R;
    fly.touchFwd = -ny / R; // up = forward
  };
  pad.addEventListener('pointerdown', (e) => {
    padId = e.pointerId;
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== padId) return;
    const r = pad.getBoundingClientRect();
    setNub(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  });
  const endPad = () => {
    padId = -1;
    nub.style.transform = '';
    fly.touchFwd = fly.touchStrafe = 0;
  };
  pad.addEventListener('pointerup', endPad);
  pad.addEventListener('pointercancel', endPad);
}

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
  refreshLegend();
}
async function loadTonightSnapshot(): Promise<void> {
  for (const t of await loadSnapshot()) transientMap.set(t.oid, t);
  applyTransients();
}
let lastAlertUpdate = 0;
async function fetchTransientsNearView(): Promise<void> {
  camera.getWorldDirection(viewDir);
  worldToRaDec(viewDir, tonightRd);
  try {
    const before = transientMap.size;
    const near = await fetchNear(tonightRd.raRad * RAD2DEG, tonightRd.decRad * RAD2DEG, 8);
    for (const t of near) transientMap.set(t.oid, t);
    lastAlertUpdate = Date.now();
    if (transientMap.size !== before || near.length) applyTransients();
  } catch (e) {
    console.warn('live transient fetch failed (keeping snapshot)', e);
  }
}

const alertsSec = document.getElementById('sec-alerts')!;
const alertsBtnRow = document.createElement('div');
alertsBtnRow.className = 'row';
alertsSec.appendChild(alertsBtnRow);
const tonightBtn = document.createElement('button');
tonightBtn.textContent = '◎ Live alerts';
tonightBtn.title = 'Stream live transient alerts (all-sky) from the broker';
alertsBtnRow.appendChild(tonightBtn);

// Broker toggle: ⚡ ZTF (ALeRCE — dense all-sky, the LSST precursor) ⇄ 🔭 LSST (ANTARES — the
// real Rubin/LSST stream + ZTF, fuller per-object tags but a smaller recent population). LSST is
// a toggle today (sparse) and becomes the default as Rubin ramps up; ZTF is the dense default.
const brokerBtn = document.createElement('button');
function updateBrokerBtn(): void {
  const antares = getBroker() === 'antares';
  brokerBtn.textContent = antares ? '🔭 LSST' : '⚡ ZTF';
  brokerBtn.title = antares
    ? 'Broker: ANTARES — real Rubin/LSST + ZTF, fuller per-object tags (smaller recent set). Tap → ZTF (denser).'
    : 'Broker: ALeRCE — dense all-sky ZTF (LSST precursor). Tap → ANTARES (Rubin/LSST + tags).';
}
updateBrokerBtn();
alertsBtnRow.appendChild(brokerBtn);
brokerBtn.addEventListener('click', () => {
  setBroker(getBroker() === 'antares' ? 'ztf' : 'antares');
  updateBrokerBtn();
  transientMap.clear();
  transientLayer.setTransients([], Date.now());
  refreshLegend();
  if (transientsOn) {
    void loadTonightSnapshot();
    void fetchTransientsNearView();
  }
});

// Live polling: while alerts are on, re-query the broker near the view every 30 s (the cone
// cache TTL) so fresh alerts stream in. The "● LIVE" indicator lives in the bottom status bar.
const liveStatus = document.getElementById('live-slot')!;
liveStatus.classList.add('pro-only');
let livePoll: ReturnType<typeof setInterval> | null = null;

tonightBtn.addEventListener('click', () => {
  transientsOn = tonightBtn.classList.toggle('active');
  liveStatus.style.display = transientsOn ? '' : 'none';
  renderFeed();
  if (transientsOn) {
    fly.reset(); // transients are sky-direction objects — view from Earth
    if (transientMap.size === 0) void loadTonightSnapshot();
    void fetchTransientsNearView();
    livePoll ??= setInterval(() => {
      if (transientsOn) void fetchTransientsNearView();
    }, 30000);
  } else if (livePoll) {
    clearInterval(livePoll);
    livePoll = null;
  }
});

// --- classification legend + per-class filter (markers coloured by the broker's ML class).
//     Lives inside the dock's Alerts section — never floats over anything. ---
const hiddenGroups = new Set<TransientGroup>();
const legend = document.createElement('div');
legend.style.cssText = 'margin-top:8px;font-size:11px';
alertsSec.appendChild(legend);
const legendRows = new Map<TransientGroup, { row: HTMLDivElement; count: HTMLSpanElement }>();
{
  const title = document.createElement('div');
  title.textContent = 'Alert classes (tap to filter)';
  title.style.cssText = 'color:#9cc4ff;margin-bottom:5px;font-size:10px';
  legend.appendChild(title);
  for (const g of GROUP_LIST) {
    const [r, gg, b] = GROUP_COLOR[g];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;cursor:pointer;padding:2px 0';
    const sw = document.createElement('span');
    sw.style.cssText = `width:10px;height:10px;border-radius:50%;background:rgb(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0});flex:none`;
    const lbl = document.createElement('span');
    lbl.textContent = GROUP_LABEL[g];
    lbl.style.color = '#cfe3ff';
    const count = document.createElement('span');
    count.style.cssText = 'color:#7f93b5;margin-left:auto';
    row.append(sw, lbl, count);
    row.addEventListener('click', () => {
      if (hiddenGroups.has(g)) hiddenGroups.delete(g);
      else hiddenGroups.add(g);
      row.style.opacity = hiddenGroups.has(g) ? '0.35' : '1';
      transientLayer.setHiddenGroups(hiddenGroups);
      renderFeed();
    });
    legend.appendChild(row);
    legendRows.set(g, { row, count });
  }
}
function refreshLegend(): void {
  for (const g of GROUP_LIST) legendRows.get(g)!.count.textContent = String(transientLayer.groupCounts[g]);
  renderFeed();
}

// --- alert FEED (inbox): newest loci first, filtered by the legend; click → fly + details ---
const feed = document.createElement('div');
feed.style.cssText = 'margin-top:8px;max-height:38vh;overflow-y:auto;overscroll-behavior:contain';
alertsSec.appendChild(feed);
const FEED_MAX = 60;
function renderFeed(): void {
  feed.textContent = '';
  if (!transientsOn) {
    feed.innerHTML = `<div style="color:#5f7494;font-size:10px">enable ◎ Live alerts to stream the feed</div>`;
    return;
  }
  const items = [...transientMap.values()]
    .filter((t) => !hiddenGroups.has(classGroup(t.cls)))
    .sort((a, b) => b.lastMjd - a.lastMjd)
    .slice(0, FEED_MAX);
  if (!items.length) {
    feed.innerHTML = `<div style="color:#5f7494;font-size:10px">no alerts match the current filters</div>`;
    return;
  }
  const now = Date.now();
  for (const t of items) {
    const [r, g, b] = GROUP_COLOR[classGroup(t.cls)];
    const age = ageDays(t.lastMjd, now);
    const row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer;font-size:10px;' +
      'border-bottom:1px solid rgba(120,170,255,.07)';
    row.innerHTML =
      `<span style="width:7px;height:7px;border-radius:50%;flex:none;background:rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})"></span>` +
      `<span style="color:#dcebff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${t.oid}</span>` +
      `<span style="color:#7f93b5;flex:none">${t.cls ?? '—'}</span>` +
      `<span style="color:#5f7494;flex:none">${age < 1 ? `${Math.max(0, age * 24).toFixed(0)}h` : `${age.toFixed(0)}d`}</span>`;
    row.title = `${t.oid} · ${t.cls ?? 'unclassified'} · ${t.ndet} detections — click to view`;
    row.addEventListener('click', () => {
      fly.reset();
      controls.flyTo(t.raDeg * DEG2RAD, t.decDeg * DEG2RAD, 4);
      void objectPanel.showTransient(t);
    });
    feed.appendChild(row);
  }
}
renderFeed();

// --- VizieR multiwavelength catalogue overlays ---
const catalogOverlay = new CatalogOverlay(scene);
const activeCatalogs = new Map<string, CatalogPreset>();
const lastCatFetchDir = new THREE.Vector3(2, 0, 0);
const catRd = { raRad: 0, decRad: 0 };

async function fetchCatalogNearView(preset: CatalogPreset): Promise<void> {
  camera.getWorldDirection(viewDir);
  worldToRaDec(viewDir, catRd);
  const radius = Math.min(Math.max(controls.fovDeg / 1.5, 0.05), 1.0);
  try {
    const src = await fetchCatalog(preset, catRd.raRad * RAD2DEG, catRd.decRad * RAD2DEG, radius);
    if (activeCatalogs.has(preset.id)) catalogOverlay.setCatalog(preset.id, preset.name, preset.color, src);
  } catch (e) {
    console.warn(`catalog ${preset.id} fetch failed`, e);
  }
}

const catRow = document.createElement('div');
catRow.className = 'row pro-only';
catRow.innerHTML = '<span style="font-size:11px;color:#7f93b5;align-self:center">Catalogs:</span>';
document.getElementById('sec-overlays')!.appendChild(catRow);
for (const preset of CATALOGS) {
  const b = document.createElement('button');
  b.textContent = preset.name;
  b.title = `${preset.band} · VizieR ${preset.table}`;
  b.style.borderColor = '#' + preset.color.toString(16).padStart(6, '0');
  b.addEventListener('click', () => {
    if (activeCatalogs.has(preset.id)) {
      activeCatalogs.delete(preset.id);
      catalogOverlay.remove(preset.id);
      b.classList.remove('active');
    } else {
      activeCatalogs.set(preset.id, preset);
      b.classList.add('active');
      fly.reset();
      void fetchCatalogNearView(preset);
    }
  });
  catRow.appendChild(b);
}

// click (not drag) → sky direction → identify
const clickNdc = new THREE.Vector3();
const clickCamPos = new THREE.Vector3();
const clickRd = { raRad: 0, decRad: 0 };
const autoRd = { raRad: 0, decRad: 0 }; // public auto-survey view direction
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

/** Shared by mouse-click and the XR trigger: solar-system body, then transient, else SIMBAD. */
function pickSkyDirection(dir: THREE.Vector3): void {
  if (solarOn) {
    const body = solar.pick(dir, Math.max(0.7, controls.fovDeg / 30));
    if (body) {
      objectPanel.showSolarBody(body);
      return;
    }
  }
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

// --- WebXR "Enter VR" (additive; shows "VR NOT SUPPORTED" on desktop without a headset).
//     Docked in Tools — VRButton ships fixed-positioning styles that we strip. ---
const vrBtnEl = VRButton.createButton(renderer);
vrBtnEl.style.position = 'static';
vrBtnEl.style.left = '';
vrBtnEl.style.bottom = '';
vrBtnEl.style.margin = '6px 0 0';
document.getElementById('sec-tools')!.appendChild(vrBtnEl);

// --- Resize ---
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  for (const sf of starFields) sf.setPixelScale(h);
  transientLayer.setPixelScale(h);
  catalogOverlay.setPixelScale(h);
});

// --- Dev helper: window.goto(raDeg, decDeg) ---
declare global {
  interface Window {
    goto: (raDeg: number, decDeg: number) => void;
  }
}
window.goto = (raDeg, decDeg) => controls.pointAt(raDeg * DEG2RAD, decDeg * DEG2RAD);

// --- Shareable deep-link views (URL hash: #ra=..&dec=..&fov=..&survey=..) ---
const shareRd = { raRad: 0, decRad: 0 };
const shareDir = new THREE.Vector3();
function currentViewHash(): string {
  camera.getWorldDirection(shareDir);
  worldToRaDec(shareDir, shareRd);
  return `#ra=${(shareRd.raRad * RAD2DEG).toFixed(4)}&dec=${(shareRd.decRad * RAD2DEG).toFixed(4)}&fov=${controls.fovDeg.toFixed(3)}&survey=${currentSurvey.id}`;
}
function applyViewHash(): void {
  const h = location.hash.replace(/^#/, '');
  if (!h) return;
  const p = new URLSearchParams(h);
  const ra = parseFloat(p.get('ra') ?? '');
  const dec = parseFloat(p.get('dec') ?? '');
  if (isFinite(ra) && isFinite(dec)) {
    const surveyId = p.get('survey');
    const sv = SURVEYS.find((s) => s.id === surveyId);
    if (sv && sv.id !== currentSurvey.id) void setSurvey(sv);
    const fov = parseFloat(p.get('fov') ?? '');
    controls.pointAt(ra * DEG2RAD, dec * DEG2RAD);
    if (isFinite(fov)) controls.fovDeg = fov;
  }
}
addEventListener('hashchange', applyViewHash);
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
  catalogOverlay,
  activeCatalogs,
};
const _h0 = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
transientLayer.setPixelScale(_h0);
catalogOverlay.setPixelScale(_h0);

// --- Boot ---
setSurvey(currentSurvey)
  .then(() => {
    loadingEl.style.opacity = '0';
    setTimeout(() => loadingEl.remove(), 600);
    if (location.hash.includes('ra=')) applyViewHash(); // restore a shared view
    else controls.pointAt(83.82 * DEG2RAD, -5.39 * DEG2RAD); // default: Orion
  })
  .catch((e) => {
    loadingEl.textContent = 'Failed to load sky imagery — see console.';
    console.error(e);
  });

// --- Help (controls + install steps) ---
initHelpPanel();

// --- About / credits panel ---
const aboutBtn = document.createElement('button');
aboutBtn.textContent = 'ⓘ';
aboutBtn.title = 'About · data credits';
document.getElementById('topbar-actions')!.appendChild(aboutBtn);
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
  '<b>Alerts</b> — ALeRCE broker (ZTF) &amp; ANTARES broker, NOIRLab (Rubin/LSST + ZTF)<br>' +
  '<b>Constellations</b> — d3-celestial (BSD-3, Olaf Frohn)' +
  '</div>' +
  '<p style="margin:12px 0 0;font-size:11px;color:#5f7494">Code MIT · data per provider terms. ' +
  '<a href="https://github.com/kunalb541/Brahmaand" target="_blank" rel="noopener" style="color:#8aa6d6">source ↗</a></p>' +
  '<button id="about-close" style="margin-top:14px;font:inherit;font-size:12px;cursor:pointer;color:#dcebff;' +
  'background:rgba(40,70,130,.5);border:1px solid rgba(120,170,255,.3);border-radius:6px;padding:5px 12px">Close</button>' +
  '</div>';
document.body.appendChild(aboutPanel);
aboutBtn.addEventListener('click', () => (aboutPanel.style.display = 'grid'));
aboutPanel.addEventListener('click', (e) => {
  if (e.target === aboutPanel || (e.target as HTMLElement).id === 'about-close') aboutPanel.style.display = 'none';
});

// --- Dock behaviour: accordion sections + the phone drawer (☰) ---
for (const h of document.querySelectorAll<HTMLElement>('#dock h2[data-sec]')) {
  h.addEventListener('click', () => h.parentElement!.classList.toggle('closed'));
}
const midrow = document.getElementById('midrow')!;
document.getElementById('dock-burger')!.addEventListener('click', () => midrow.classList.toggle('dock-open'));
// touching the sky dismisses the phone drawer
canvas.addEventListener('pointerdown', () => midrow.classList.remove('dock-open'));

// --- Service worker (offline shell + cached assets/tiles) — production only ---
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// --- PRO ⇄ EXPLORE mode toggle ---
const modeBtn = document.createElement('button');
document.getElementById('topbar-actions')!.appendChild(modeBtn);
function applyMode(): void {
  const pro = isPro();
  modeBtn.textContent = pro ? '◆ PRO' : '◇ Explore';
  modeBtn.title = pro
    ? 'Professional mode — tap for the simplified public experience'
    : 'Public mode — tap for research tools (catalogs, readouts, classifiers)';
  document.getElementById('readout')!.style.display = pro ? '' : 'none';
  for (const el of document.querySelectorAll<HTMLElement>('.pro-only')) el.style.display = pro ? '' : 'none';
  // the ● LIVE line only shows while alert streaming is actually on
  liveStatus.style.display = pro && transientsOn ? '' : 'none';
}
modeBtn.addEventListener('click', () => setMode(getMode() === 'pro' ? 'public' : 'pro'));
onModeChange(applyMode);
applyMode(); // initial state (all pro-only elements exist by this point)

// small LOD / tile-count status (bottom status bar slot)
const hipsStatus = document.getElementById('hips-slot')!;
hipsStatus.classList.add('pro-only');
applyMode(); // re-apply: hipsStatus (pro-only) is tagged after the initial applyMode()

let hudAccum = 0;
startLoop(renderer, (dt) => {
  try {
    // throttle text-HUD DOM writes to ~10 Hz — the 3-D scene still renders every frame, but
    // rebuilding the readout/status strings 60×/s is wasted main-thread work (smoother on mobile).
    hudAccum += dt;
    const hudTick = hudAccum >= 0.1;
    if (hudTick) hudAccum = 0;

    deviceSky.update(dt); // ease toward the latest gyro/compass fix (smooth, Star-Walk-like)
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
    // reference grids/lines: pinned to the sky, shown only in the planetarium (Earth) view
    gridGroup.position.copy(rig.position);
    gridGroup.visible = f > 0.4 && (gridOn.equ || gridOn.ecl || gridOn.gal);
    equGrid.visible = equator.visible = gridOn.equ;
    ecliptic.visible = gridOn.ecl;
    galactic.visible = gridOn.gal;

    // solar system: ephemerides at sim-time (10 Hz is plenty — bodies move slowly on screen),
    // sized true-to-angular-diameter, Moon limb turned toward the Sun
    solar.setCenter(rig.position);
    solar.setVisible(solarOn && nearEarth);
    if (hudTick && solarOn && nearEarth) {
      solar.update(solarSystemAt(getSimMs()), controls.fovDeg, canvas.clientHeight, camera);
    }
    // the clock display ticks regardless of the Planets toggle / Earth-vs-space view
    if (hudTick) {
      const live = isLive();
      timebar.classList.toggle('warped', !live);
      timeDisplay.textContent = new Date(getSimMs()).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
      timeRate.textContent = rateLabel(getRate());
    }

    // FOV framing circle: pixel diameter = (target° / vertical-FOV°) × viewport height
    if (fovIdx >= 0 && nearEarth) {
      const px = (fovPresets[fovIdx]!.deg / controls.fovDeg) * canvas.clientHeight;
      fovRing.style.width = fovRing.style.height = `${px}px`;
      fovRing.style.display = 'block';
      fovLabel.style.marginTop = `${-px / 2 - 15}px`;
      fovLabel.textContent = fovPresets[fovIdx]!.label;
      fovLabel.style.display = 'block';
    } else if (fovRing.style.display !== 'none') {
      fovRing.style.display = fovLabel.style.display = 'none';
    }
    starLabels.setVisible(starLabelsOn && f > 0.6);

    hips.setCenter(rig.position);
    hips.setVisible(nearEarth);
    if (nearEarth) {
      hips.update(camera);
      // Public mode: auto-pick the deepest survey for the view (Pan-STARRS north / DES south),
      // so detail "just appears" on zoom — the public never sees the observatory picker.
      if (!isPro() && controls.fovDeg < 25) {
        camera.getWorldDirection(viewDir);
        worldToRaDec(viewDir, autoRd);
        const wantId = (autoRd.decRad * RAD2DEG) > -28 ? 'panstarrs' : 'des';
        if (currentSurvey.id !== wantId) {
          const sv = SURVEYS.find((s) => s.id === wantId);
          if (sv) void setSurvey(sv);
        }
      }
    } else if (hips.tileCount) {
      // left Earth view → drop the streamed tiles (was previously mis-attached to the
      // auto-survey `if`, which wiped the HiPS layer EVERY frame in Pro mode — the reason
      // survey switching and zoomed tile streaming appeared completely dead)
      hips.clear();
    }

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
      if (hudTick) {
        const ago = lastAlertUpdate ? Math.round((Date.now() - lastAlertUpdate) / 1000) : -1;
        liveStatus.textContent =
          ago < 0
            ? '◌ connecting to broker…'
            : `● LIVE · ${transientMap.size} alerts · updated ${ago}s ago`;
      }
    }

    // catalogue overlays: Earth-view; refetch around the new view when panned
    catalogOverlay.setCenter(rig.position);
    const showCats = activeCatalogs.size > 0 && f > 0.5;
    catalogOverlay.setVisible(showCats);
    if (showCats) {
      camera.getWorldDirection(viewDir);
      if (viewDir.angleTo(lastCatFetchDir) > 0.05) {
        lastCatFetchDir.copy(viewDir);
        for (const p of activeCatalogs.values()) void fetchCatalogNearView(p);
      }
    }

    if (hudTick) readout.update();
    starLabels.update();
    renderer.render(scene, camera);
    hud.tick(dt);

    // honest tile status: names the active survey and says when you're outside its coverage
    if (hudTick) hipsStatus.textContent =
      dist < 1
        ? hips.order
          ? `${currentSurvey.name} · order ${hips.order} · ${hips.readyCount}/${hips.tileCount} tiles` +
            (hips.missingCount && hips.missingCount >= hips.tileCount - 1
              ? ' · outside survey coverage'
              : hips.missingCount
                ? ` · ${hips.missingCount} off-coverage`
                : '')
          : `${currentSurvey.name} · base sky (zoom for telescope tiles)`
        : `flying · ${dist.toFixed(1)} pc from the Sun`;
  } catch (e) {
    // surface instead of silently killing the animation loop
    (window as unknown as { __loopErr: unknown }).__loopErr = e;
    console.error('loop error:', e);
  }
});
