// Build the Messier catalogue (M1–M110) from SIMBAD TAP — REAL positions/types, no hand-typed
// coordinates. → public/data/messier.json  (re-runnable; SIMBAD is the source of truth)
import { writeFileSync, mkdirSync } from 'node:fs';

const TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const ids = Array.from({ length: 110 }, (_, i) => `'M ${i + 1}'`).join(',');
const adql = `SELECT ident.id, basic.ra, basic.dec, basic.otype, basic.main_id
FROM ident JOIN basic ON ident.oidref = basic.oid WHERE ident.id IN (${ids})`;

const r = await fetch(`${TAP}?request=doQuery&lang=adql&format=json&query=${encodeURIComponent(adql)}`, {
  signal: AbortSignal.timeout(60000),
});
if (!r.ok) throw new Error(`SIMBAD TAP ${r.status}`);
const j = await r.json();
const objects = j.data
  .map(([id, ra, dec, otype, mainId]) => ({
    m: parseInt(String(id).slice(2), 10),
    ra,
    dec,
    otype,
    name: mainId,
  }))
  .filter((o) => isFinite(o.ra) && isFinite(o.dec))
  .sort((a, b) => a.m - b.m);

mkdirSync('public/data', { recursive: true });
writeFileSync(
  'public/data/messier.json',
  JSON.stringify({ source: 'SIMBAD (CDS), TAP query of idents M 1–M 110', generated: new Date().toISOString(), objects }),
);
console.log(`wrote ${objects.length} Messier objects (expected 110)`);
