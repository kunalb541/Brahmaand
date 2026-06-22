// Build a compact Gaia DR3 star catalogue from the ESA Gaia TAP service, into the same binary
// format the runtime already consumes (posF32x3 | colU8x3 | absMagF32). ~639k stars at G<10.5.
//
// This is a single magnitude-limited extract (no octree chunking / no ESA account needed at
// this size), using Bailer-Jones distances (never 1/parallax) and Gaia colours.
import { writeFileSync, mkdirSync } from 'node:fs';

const TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
// Bright, high-S/N subset (parallax_over_error > 5): distance = 1000/parallax is reliable
// here (~<20% error), so we skip the heavy Bailer-Jones external join (which exceeds the
// anonymous async limit). A full faint catalogue would use Bailer-Jones distances instead.
//
// The anonymous async job errors on the full 639k result, and a single sync call caps near
// 100k rows, so we partition by RA into bands fetched in parallel (disjoint → no dedup).
const RA_BANDS = Array.from({ length: 12 }, (_, i) => [i * 30, (i + 1) * 30]);
const CONCURRENCY = 3;
const MAX_DIST_PC = 20000;

function bandQuery(loRa, hiRa) {
  return `SELECT ra, dec, phot_g_mean_mag, bp_rp, teff_gspphot, parallax
FROM gaiadr3.gaia_source
WHERE phot_g_mean_mag < 10.5 AND parallax_over_error > 5 AND ruwe < 1.4 AND parallax > 0
AND ra >= ${loRa} AND ra < ${hiRa}`;
}

async function fetchBand(loRa, hiRa) {
  const body = new URLSearchParams({
    REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', MAXREC: '200000', QUERY: bandQuery(loRa, hiRa),
  });
  const r = await fetch(TAP, { method: 'POST', body, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`band ${loRa}-${hiRa}: HTTP ${r.status}`);
  return r.text();
}

/** Run band fetches with limited concurrency; return concatenated CSV bodies (header kept once). */
async function runBands() {
  const results = new Array(RA_BANDS.length);
  let next = 0;
  async function worker() {
    while (next < RA_BANDS.length) {
      const i = next++;
      const [lo, hi] = RA_BANDS[i];
      const csv = await fetchBand(lo, hi);
      const rows = csv.split(/\r?\n/).length - 1;
      results[i] = csv;
      process.stdout.write(`  band ${lo}-${hi}° → ~${rows} rows\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function bvToTeff(bp_rp) {
  const c = Math.max(-0.4, Math.min(2.0, bp_rp));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}
function teffToRgb(t) {
  const x = t / 100;
  let r = x <= 66 ? 255 : 329.698727446 * Math.pow(x - 60, -0.1332047592);
  let g = x <= 66 ? 99.4708025861 * Math.log(x) - 161.1195681661 : 288.1221695283 * Math.pow(x - 60, -0.0755148492);
  let b = x >= 66 ? 255 : x <= 19 ? 0 : 138.5177312231 * Math.log(x - 10) - 305.0447927307;
  const mix = (v) => Math.max(0, Math.min(255, v * 0.65 + 255 * 0.35));
  return [mix(r), mix(g), mix(b)];
}

console.log(`fetching Gaia DR3 in ${RA_BANDS.length} RA bands (concurrency ${CONCURRENCY})…`);
const bands = await runBands();

const xs = [], cols = [], mags = [], cis = [];
let kept = 0;
for (const csv of bands) {
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(',').map((s) => s.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const col = (f, n) => {
    const v = f[idx[n]];
    return v === undefined || v === '' ? NaN : parseFloat(v);
  };
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r]) continue;
    const f = lines[r].split(',');
    const ra = col(f, 'ra'), dec = col(f, 'dec'), g = col(f, 'phot_g_mean_mag');
    const bp_rp = col(f, 'bp_rp'), teff = col(f, 'teff_gspphot');
  const plx = col(f, 'parallax'); // mas
  const d = isFinite(plx) && plx > 0 ? 1000 / plx : NaN; // parsecs (high-S/N subset)
  if (!isFinite(ra) || !isFinite(dec) || !isFinite(g) || !isFinite(d) || d <= 0 || d > MAX_DIST_PC) continue;
  const ra_r = (ra * Math.PI) / 180, dec_r = (dec * Math.PI) / 180;
  const cd = Math.cos(dec_r);
  // ICRS XYZ → world (y,z,x) swizzle (matches the sky + HYG set)
  const ix = d * cd * Math.cos(ra_r), iy = d * cd * Math.sin(ra_r), iz = d * Math.sin(dec_r);
  xs.push(iy, iz, ix);
  const T = isFinite(teff) && teff > 1000 ? teff : bvToTeff(isFinite(bp_rp) ? bp_rp : 0.6);
  const [rr, gg, bb] = teffToRgb(T);
  cols.push(Math.round(rr), Math.round(gg), Math.round(bb));
  mags.push(g - 5 * (Math.log10(d) - 1)); // absolute magnitude
  cis.push(isFinite(bp_rp) ? bp_rp : NaN); // true Gaia BP−RP colour index for the H–R diagram
  kept++;
  }
}

const N = kept;
// posF32x3 | colU8x3 | absMagF32x1 | ciF32x1 (real BP−RP, not the lossy 8-bit render colour)
const buf = new ArrayBuffer(N * 3 * 4 + N * 3 + N * 4 + N * 4);
new Float32Array(buf, 0, N * 3).set(xs);
new Uint8Array(buf, N * 3 * 4, N * 3).set(cols);
new Float32Array(buf, N * 3 * 4 + N * 3, N).set(mags);
new Float32Array(buf, N * 3 * 4 + N * 3 + N * 4, N).set(cis);

mkdirSync('public/catalogs', { recursive: true });
writeFileSync('public/catalogs/gaia.bin', Buffer.from(buf));
writeFileSync(
  'public/catalogs/gaia.json',
  JSON.stringify({
    count: N,
    units: 'parsec',
    frame: 'world (icrs.yzx)',
    layout: ['posF32x3', 'colU8x3', 'absMagF32x1', 'ciF32x1'],
    source: 'Gaia DR3 (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO) · distances 1/parallax (parallax_over_error>5) · G<10.5',
  }),
);
console.log(`wrote ${N} Gaia stars → public/catalogs/gaia.bin (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
