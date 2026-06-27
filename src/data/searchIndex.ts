/**
 * Search autocomplete index — instant, offline "recommendations while typing". Covers the objects
 * people actually search for: the planets, the brightest named stars, the full Messier catalogue
 * (with common names) and a curated set of famous non-Messier deep-sky objects. Anything not here
 * still resolves on Enter via the full Sesame/SIMBAD name service (objectPanel.onSearch), so the
 * index only needs to be *helpful*, not exhaustive.
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

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');

/** Rank suggestions for a partial query: prefix matches first, then substring, shorter labels win. */
export function searchSuggest(raw: string, limit = 8): Suggestion[] {
  const q = raw.trim();
  if (!q) return [];
  const qn = norm(q);
  const scored: Array<{ s: Suggestion; score: number }> = [];
  for (const s of SUGGEST_INDEX) {
    const ln = norm(s.label);
    const qy = norm(s.query);
    let score = -1;
    if (qy === qn) score = 0; // exact id (e.g. "M31")
    else if (qy.startsWith(qn) || ln.startsWith(qn)) score = 1; // prefix
    else if (ln.includes(qn)) score = 2; // substring anywhere in the label
    if (score >= 0) scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.label.length - b.s.label.length);
  return scored.slice(0, limit).map((x) => x.s);
}
