/**
 * Search autocomplete index — instant, OFFLINE "recommendations while typing". A remote SIMBAD
 * prefix-search was measured at ~10 s (or returns nothing), so the long tail is covered locally
 * instead: the planets, the brightest named stars, the full Messier catalogue (with common names),
 * a curated set of famous deep-sky objects, AND the complete NGC (1–7840) + IC (1–5386) catalogues.
 * Anything still not here resolves on Enter via the full Sesame/SIMBAD name service.
 */
import { STARS } from '../sky/starLabels';

export interface Suggestion {
  label: string;
  query: string; // what gets sent to the name resolver
}

const PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

/** Common names for the well-known Messier objects (the rest list as plain "M##"). */
const MESSIER_NAMES: Record<number, string> = {
  1: 'Crab Nebula',
  8: 'Lagoon Nebula',
  13: 'Hercules Globular Cluster',
  16: 'Eagle Nebula',
  17: 'Omega / Swan Nebula',
  20: 'Trifid Nebula',
  27: 'Dumbbell Nebula',
  31: 'Andromeda Galaxy',
  33: 'Triangulum Galaxy',
  42: 'Orion Nebula',
  44: 'Beehive Cluster',
  45: 'Pleiades (Seven Sisters)',
  51: 'Whirlpool Galaxy',
  57: 'Ring Nebula',
  63: 'Sunflower Galaxy',
  64: 'Black Eye Galaxy',
  81: "Bode's Galaxy",
  82: 'Cigar Galaxy',
  87: 'Virgo A (M87)',
  97: 'Owl Nebula',
  101: 'Pinwheel Galaxy',
  104: 'Sombrero Galaxy',
};

/** Famous non-Messier objects: [display label, resolver query]. */
const FAMOUS: Array<[string, string]> = [
  ['NGC 6543 — Cat’s Eye Nebula', 'NGC 6543'],
  ['NGC 5128 — Centaurus A', 'NGC 5128'],
  ['NGC 2070 — Tarantula Nebula', 'NGC 2070'],
  ['NGC 7000 — North America Nebula', 'NGC 7000'],
  ['NGC 869 — Double Cluster', 'NGC 869'],
  ['NGC 253 — Sculptor Galaxy', 'NGC 253'],
  ['NGC 1499 — California Nebula', 'NGC 1499'],
  ['NGC 7293 — Helix Nebula', 'NGC 7293'],
  ['NGC 6960 — Veil Nebula', 'NGC 6960'],
  ['NGC 3372 — Carina Nebula', 'NGC 3372'],
  ['IC 434 — Horsehead Nebula', 'IC 434'],
  ['IC 1396 — Elephant’s Trunk', 'IC 1396'],
  ['47 Tucanae (globular cluster)', '47 Tuc'],
  ['Omega Centauri (globular cluster)', 'Omega Cen'],
  ['Large Magellanic Cloud', 'LMC'],
  ['Small Magellanic Cloud', 'SMC'],
  ['Galactic Center / Sgr A*', 'Sgr A*'],
];

export const SUGGEST_INDEX: Suggestion[] = [
  ...PLANETS.map((p) => ({ label: `${p} (solar system)`, query: p })),
  ...STARS.map((s) => ({ label: `${s.name} (star)`, query: s.name })),
  ...Array.from({ length: 110 }, (_, i) => {
    const m = i + 1;
    const nm = MESSIER_NAMES[m];
    return { label: nm ? `M${m} — ${nm}` : `M${m}`, query: `M${m}` };
  }),
  ...FAMOUS.map(([label, query]) => ({ label, query })),
];

// The full NGC/IC catalogues for the long tail — generated, not stored (no bundle cost). Skip the
// numbers already given a common name in FAMOUS so they aren't duplicated.
const namedQueries = new Set(FAMOUS.map(([, q]) => q));
for (let n = 1; n <= 7840; n++) {
  const q = `NGC ${n}`;
  if (!namedQueries.has(q)) SUGGEST_INDEX.push({ label: q, query: q });
}
for (let n = 1; n <= 5386; n++) {
  const q = `IC ${n}`;
  if (!namedQueries.has(q)) SUGGEST_INDEX.push({ label: q, query: q });
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
// Precompute normalised keys + a "named" flag (has a description beyond the bare id) once, so each
// keystroke scans the ~13k-entry index in well under a millisecond.
const NORM: Array<{ s: Suggestion; ln: string; qy: string; named: boolean }> = SUGGEST_INDEX.map(
  (s) => ({ s, ln: norm(s.label), qy: norm(s.query), named: s.label !== s.query }),
);

/** Rank suggestions for a partial query: exact id → named prefix → bare prefix → substring. */
export function searchSuggest(raw: string, limit = 8): Suggestion[] {
  const q = raw.trim();
  if (!q) return [];
  const qn = norm(q);
  const scored: Array<{ s: Suggestion; score: number }> = [];
  for (const e of NORM) {
    let score = -1;
    if (e.qy === qn) score = 0; // exact id (e.g. "M31", "NGC 6543")
    else if (e.qy.startsWith(qn) || e.ln.startsWith(qn)) score = e.named ? 1 : 2; // prefix, named first
    else if (e.ln.includes(qn)) score = e.named ? 3 : 4; // substring (named first)
    if (score >= 0) scored.push({ s: e.s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.label.length - b.s.label.length);
  return scored.slice(0, limit).map((x) => x.s);
}
