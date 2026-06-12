// Ingest the broker's CLASSIFIED all-sky alert population from ALeRCE and write it as a static
// snapshot the app serves instantly (the broker already does detection + ML classification; we
// just ingest oid / position / recency / class). The full-table lastmjd sort times out and the
// broker throttles cone-grid bursts, but the CLASSIFIER-ordered query returns classified objects
// across the whole sky fast — so we page through it. The runtime then tops this up LIVE near the
// view (one fast cone). Re-runnable nightly (PHASE-8 cron). ZTF is the LSST precursor.
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://api.alerce.online/ztf/v1/objects/';
const PAGES = 6; // × page_size classified objects (kept small — the broker throttles bursts)
const PAGE_SIZE = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(p, orderBy) {
  // class_name is a required param but the broker returns objects of all classes ordered
  // by the requested key — we read each object's real `class`. probability-ordered = the
  // confidently-classified population; lastmjd-ordered = recent (catches new transients).
  const url =
    `${BASE}?classifier=lc_classifier&class_name=SNIa&probability=0.5` +
    `&page=${p}&page_size=${PAGE_SIZE}&order_by=${orderBy}&order_mode=DESC&count=false`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (r.ok) return (await r.json()).items ?? [];
  } catch {
    /* skip */
  }
  return [];
}

const seen = new Map();
async function ingest(orderBy, pages) {
  for (let p = 1; p <= pages; p++) {
    const items = await page(p, orderBy);
    for (const o of items) {
      if (o.meanra == null) continue;
      if (!seen.has(o.oid)) {
        seen.set(o.oid, {
          oid: String(o.oid),
          ra: o.meanra,
          dec: o.meandec,
          firstmjd: o.firstmjd,
          lastmjd: o.lastmjd,
          ndet: o.ndet,
          cls: o.class ?? null,
        });
      }
    }
    process.stdout.write(`  ${orderBy} page ${p}/${pages} · ${seen.size} unique alerts\n`);
    if (!items.length) break;
    await sleep(700);
  }
}

console.log('ingesting classified all-sky alerts (probability + recency passes)…');
await ingest('probability', PAGES); // the classified population, all sky
await ingest('lastmjd', 6); // recent alerts (new transients)

const transients = [...seen.values()].sort((a, b) => b.lastmjd - a.lastmjd);
const classified = transients.filter((t) => t.cls).length;
const byClass = {};
for (const t of transients) byClass[t.cls ?? 'null'] = (byClass[t.cls ?? 'null'] ?? 0) + 1;

mkdirSync('public/transients', { recursive: true });
writeFileSync(
  'public/transients/tonight.json',
  JSON.stringify({
    generated: new Date().toISOString(),
    source: 'ALeRCE broker · ZTF alert stream (LSST precursor)',
    survey: 'ZTF',
    note: 'Classified all-sky snapshot; the app also queries the live broker near the view.',
    count: transients.length,
    classified,
    byClass,
    transients,
  }),
);
console.log(`\nwrote ${transients.length} alerts (${classified} classified) → tonight.json`);
console.log('classes:', byClass);
