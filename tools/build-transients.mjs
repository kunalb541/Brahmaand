// Ingest a recent all-sky alert snapshot from the ANTARES broker (NOIRLab) — the REAL Rubin/LSST
// stream (+ ZTF), with community-filter tags. ANTARES's recent-sorted + paginated query is fast
// and CORS-open (unlike ALeRCE's throttled cone grid), so a few pages give a solid all-sky
// baseline. The runtime tops this up LIVE near the view. Re-runnable nightly (PHASE-8 cron).
import { writeFileSync, mkdirSync } from 'node:fs';

const ANTARES = 'https://api.antares.noirlab.edu/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function antaresCls(tags) {
  for (const t of tags) {
    const x = t.toLowerCase();
    if (x.includes('transient') || x.includes('supernova') || x.includes('sn_')) return 'Transient';
  }
  return null;
}

const seen = new Map();
function ingest(data) {
  for (const o of data) {
    const a = o.attributes ?? {};
    const pr = a.properties ?? {};
    if (a.ra == null || a.dec == null || seen.has(o.id)) continue;
    const tags = a.tags ?? [];
    seen.set(o.id, {
      oid: o.id,
      ra: a.ra,
      dec: a.dec,
      firstmjd: pr.oldest_alert_observation_time ?? pr.newest_alert_observation_time,
      lastmjd: pr.newest_alert_observation_time,
      ndet: pr.num_alerts ?? 1,
      cls: antaresCls(tags),
      tags,
    });
  }
}
async function get(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (r.ok) return (await r.json()).data ?? [];
  } catch {
    /* skip */
  }
  return [];
}

// recent LSST/ZTF alerts (genuinely "tonight")
ingest(await get(`${ANTARES}/loci?sort=-properties.newest_alert_observation_time&page%5Bsize%5D=100`));
console.log(`  recent → ${seen.size}`);

// cone grid for an all-sky baseline (ANTARES cone search is fast + un-throttled)
const cones = [];
for (let dec = -24; dec <= 80; dec += 13) {
  const nRa = Math.max(4, Math.round(16 * Math.cos((dec * Math.PI) / 180)));
  for (let i = 0; i < nRa; i++) cones.push([(i * 360) / nRa, dec]);
}
for (let i = 0; i < cones.length; i++) {
  const [ra, dec] = cones[i];
  ingest(await get(`${ANTARES}/loci?filter%5Bcone%5D=${ra},${dec},6&page%5Bsize%5D=100`));
  process.stdout.write(`  cone ${i + 1}/${cones.length} · ${seen.size} unique alerts\n`);
  await sleep(120);
}

const transients = [...seen.values()].sort((a, b) => b.lastmjd - a.lastmjd);
const lsst = transients.filter((t) => /lsst/i.test(t.oid) || (t.tags ?? []).some((g) => /lsst/i.test(g))).length;
mkdirSync('public/transients', { recursive: true });
writeFileSync(
  'public/transients/tonight.json',
  JSON.stringify({
    generated: new Date().toISOString(),
    source: 'ANTARES broker (NOIRLab) · Rubin/LSST + ZTF alert streams',
    survey: 'ANTARES',
    note: 'Recent all-sky snapshot; the app also queries the live ANTARES broker near the view.',
    count: transients.length,
    transients,
  }),
);
console.log(`\nwrote ${transients.length} alerts (${lsst} LSST-tagged) → tonight.json`);
