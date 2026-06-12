// Fetch a real snapshot of recent transients from the ALeRCE ZTF broker (cone searches,
// which are indexed/fast — the full-table lastmjd sort times out) and write it as a static
// fallback the app serves when the live broker is slow/down. Re-runnable (e.g. nightly cron
// in PHASE-8). ZTF is the LSST precursor survey; swap the host for LSST when its API stabilises.
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://api.alerce.online/ztf/v1/objects/';
// A spread of cone centres across the ZTF-visible sky (dec > -30), radius 5°.
const CONES = [
  [30, 20], [90, 10], [150, 5], [210, 25], [270, 15], [330, 0], [180, 40], [60, -10],
];
const RADIUS_ARCSEC = 18000; // 5°

async function cone(ra, dec) {
  const url = `${BASE}?ra=${ra}&dec=${dec}&radius=${RADIUS_ARCSEC}&page=1&page_size=12&order_by=lastmjd&order_mode=DESC&count=false`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return [];
    const j = await r.json();
    return j.items ?? [];
  } catch {
    return [];
  }
}

const seen = new Map();
for (const [ra, dec] of CONES) {
  const items = await cone(ra, dec);
  for (const o of items) {
    if (!seen.has(o.oid)) {
      seen.set(o.oid, {
        oid: String(o.oid), // keep as string (ZTF oid; LSST diaObjectId is int64 > 2^53)
        ra: o.meanra,
        dec: o.meandec,
        firstmjd: o.firstmjd,
        lastmjd: o.lastmjd,
        ndet: o.ndet,
        cls: o.class ?? null,
      });
    }
  }
  process.stdout.write(`cone(${ra},${dec}) → ${items.length}; total ${seen.size}\n`);
}

const transients = [...seen.values()].sort((a, b) => b.lastmjd - a.lastmjd);
mkdirSync('public/transients', { recursive: true });
writeFileSync(
  'public/transients/tonight.json',
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      source: 'ALeRCE broker · ZTF alert stream (LSST precursor)',
      survey: 'ZTF',
      note: 'Static fallback snapshot; the app queries the live broker first.',
      count: transients.length,
      transients,
    },
    null,
    0,
  ),
);
console.log(`wrote ${transients.length} transients → public/transients/tonight.json`);
