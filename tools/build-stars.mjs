// Build a compact binary star catalog from the HYG v4.1 CSV.
// Output: public/catalogs/hyg.bin  (positions f32 ×3N | colors u8 ×3N | absMag f32 ×N)
//         public/catalogs/hyg.json (count + metadata)
//
// Positions are stored in WORLD frame (parsecs): world = (hyg.y, hyg.z, hyg.x), i.e. the
// icrs.yzx swizzle the sky uses — so bright stars coincide with the HiPS imagery at the Sun.
// World coordinates are baked at build time.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'data-src/hyg.csv';
const OUT_DIR = 'public/catalogs';
const MAX_DIST_PC = 5000; // HYG uses 100000 as "unknown"; cap keeps coords bounded

/** Minimal CSV line splitter handling double-quoted fields. */
function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** B−V colour index → effective temperature (Ballesteros 2012). */
function bvToTeff(bv) {
  const c = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

/** Teff (K) → sRGB 0..255 (Tanner Helland fit), softened toward white. */
function teffToRgb(t) {
  const x = t / 100;
  let r, g, b;
  r = x <= 66 ? 255 : 329.698727446 * Math.pow(x - 60, -0.1332047592);
  g = x <= 66 ? 99.4708025861 * Math.log(x) - 161.1195681661
              : 288.1221695283 * Math.pow(x - 60, -0.0755148492);
  b = x >= 66 ? 255 : x <= 19 ? 0 : 138.5177312231 * Math.log(x - 10) - 305.0447927307;
  const clamp = (v) => Math.max(0, Math.min(255, v));
  // soften 35% toward white so the field doesn't look cartoonish
  const mix = (v) => clamp(v * 0.65 + 255 * 0.35);
  return [mix(r), mix(g), mix(b)];
}

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);
const header = splitCsv(lines[0]);
const col = (name) => header.indexOf(name);
const iX = col('x'), iY = col('y'), iZ = col('z');
const iDist = col('dist'), iMag = col('mag'), iAbs = col('absmag'), iCi = col('ci'), iId = col('id');

const xs = [], cols = [], mags = [], cis = [];
let kept = 0;
for (let r = 1; r < lines.length; r++) {
  if (!lines[r]) continue;
  const f = splitCsv(lines[r]);
  if (f[iId] === '0') continue; // the Sun (origin)
  const dist = parseFloat(f[iDist]);
  if (!isFinite(dist) || dist <= 0 || dist > MAX_DIST_PC) continue;
  const x = parseFloat(f[iX]), y = parseFloat(f[iY]), z = parseFloat(f[iZ]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
  const absmag = parseFloat(f[iAbs]);
  const ci = parseFloat(f[iCi]);
  const [rr, gg, bb] = teffToRgb(bvToTeff(isFinite(ci) ? ci : 0.6));
  // world = (hyg.y, hyg.z, hyg.x)
  xs.push(y, z, x);
  cols.push(Math.round(rr), Math.round(gg), Math.round(bb));
  mags.push(isFinite(absmag) ? absmag : 5);
  cis.push(isFinite(ci) ? ci : NaN); // true B−V colour index for the H–R diagram (NaN = unknown)
  kept++;
}

const N = kept;
// posF32x3 | colU8x3 | absMagF32x1 | ciF32x1 (real B−V, not the lossy 8-bit render colour)
const buf = new ArrayBuffer(N * 3 * 4 + N * 3 + N * 4 + N * 4);
const pos = new Float32Array(buf, 0, N * 3);
const colU = new Uint8Array(buf, N * 3 * 4, N * 3);
const mag = new Float32Array(buf, N * 3 * 4 + N * 3, N);
const ciArr = new Float32Array(buf, N * 3 * 4 + N * 3 + N * 4, N);
pos.set(xs);
colU.set(cols);
mag.set(mags);
ciArr.set(cis);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/hyg.bin`, Buffer.from(buf));
writeFileSync(
  `${OUT_DIR}/hyg.json`,
  JSON.stringify({
    count: N,
    units: 'parsec',
    frame: 'world (icrs.yzx)',
    layout: ['posF32x3', 'colU8x3', 'absMagF32x1', 'ciF32x1'],
    source: 'HYG v4.1 (astronexus) — CC BY-SA 4.0',
  }),
);
console.log(`wrote ${N} stars → ${OUT_DIR}/hyg.bin (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
