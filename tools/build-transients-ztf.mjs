// Dense all-sky ZTF snapshot from the ALeRCE broker (an LSST-precursor stream). Instead of a cone
// grid (which ALeRCE throttles hard), we pull the most RECENT objects of each lc_classifier class
// — one request per class, spaced out. That yields a dense, ALREADY-CLASSIFIED, all-sky population
// (each object keeps its ML class for marker colouring), which is exactly what the app wants.
// Re-runnable nightly. → public/transients/tonight.json
import { writeFileSync, mkdirSync } from 'node:fs';

const ALERCE = 'https://api.alerce.online/ztf/v1/objects/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// lc_classifier hierarchical taxonomy (transient / stochastic / periodic top classes).
const CLASSES = [
  'SNIa', 'SNIbc', 'SNII', 'SLSN', // transients
  'QSO', 'AGN', 'Blazar', 'YSO', 'CV/Nova', // stochastic
  'LPV', 'E', 'DSCT', 'RRL', 'CEP', 'Periodic-Other', // periodic
];

const seen = new Map();
function ingest(items, cls) {
  for (const o of items) {
    if (o.meanra == null || o.meandec == null || seen.has(o.oid)) continue;
    seen.set(o.oid, {
      oid: String(o.oid),
      ra: o.meanra,
      dec: o.meandec,
      firstmjd: o.firstmjd,
      lastmjd: o.lastmjd,
      ndet: o.ndet ?? 0,
      cls, // the class we queried for (filtered server-side by the lc_classifier)
    });
  }
}

async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (r.ok) return (await r.json()).items ?? [];
    if (r.status === 429) {
      await sleep(2500);
      const r2 = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (r2.ok) return (await r2.json()).items ?? [];
    }
  } catch {
    /* skip */
  }
  return [];
}

for (let i = 0; i < CLASSES.length; i++) {
  const cls = CLASSES[i];
  const url =
    `${ALERCE}?classifier=lc_classifier&class=${encodeURIComponent(cls)}` +
    `&probability=0.5&ndet=6&page=1&page_size=80&order_by=lastmjd&order_mode=DESC&count=false`;
  const before = seen.size;
  ingest(await get(url), cls);
  process.stdout.write(`  ${cls.padEnd(16)} +${seen.size - before}  (total ${seen.size})\n`);
  await sleep(400); // be polite to the shared broker
}

const transients = [...seen.values()].sort((a, b) => b.lastmjd - a.lastmjd);
mkdirSync('public/transients', { recursive: true });
writeFileSync(
  'public/transients/tonight.json',
  JSON.stringify({
    generated: new Date().toISOString(),
    source: 'ALeRCE broker · ZTF alert stream (LSST precursor) · lc_classifier ML classes',
    survey: 'ALeRCE-ZTF',
    note: 'Dense all-sky classified snapshot (recent objects per class). The app also queries the live broker near the view; toggle 🔭 LSST for the ANTARES Rubin/LSST stream.',
    count: transients.length,
    transients,
  }),
);
console.log(`\nwrote ${transients.length} classified ZTF alerts → tonight.json`);
