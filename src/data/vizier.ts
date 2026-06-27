/**
 * VizieR catalogue overlays — plot any of CDS's catalogues over the imagery for the current
 * field. Browser-direct via VizieR TAP (CORS `*`, JSON), verified 2026-06-12. Multiwavelength
 * preset set: Gaia (optical/astrometry), 2MASS (near-IR), AllWISE (mid-IR), Chandra CSC2 (X-ray).
 * Column names per catalogue are verified; the cone query uses each table's native position cols.
 */
import { cdsLimiter } from './cds';

export interface CatalogPreset {
  id: string;
  name: string;
  table: string;
  ra: string;
  dec: string;
  mag: string | null;
  color: number; // marker colour (hex)
  band: string;
}

export const CATALOGS: CatalogPreset[] = [
  { id: 'gaia', name: 'Gaia DR3', table: 'I/355/gaiadr3', ra: 'RA_ICRS', dec: 'DE_ICRS', mag: 'Gmag', color: 0x66ccff, band: 'optical' },
  { id: '2mass', name: '2MASS', table: 'II/246/out', ra: 'RAJ2000', dec: 'DEJ2000', mag: 'Kmag', color: 0xff5533, band: 'near-IR' },
  { id: 'allwise', name: 'AllWISE', table: 'II/328/allwise', ra: 'RAJ2000', dec: 'DEJ2000', mag: 'W1mag', color: 0xffaa33, band: 'mid-IR' },
  { id: 'chandra', name: 'Chandra (X-ray)', table: 'IX/57/csc2master', ra: 'RAICRS', dec: 'DEICRS', mag: null, color: 0xcc66ff, band: 'X-ray' },
  // wider multiwavelength spread (columns verified against the VizieR TAP schema 2026-06-27):
  { id: 'tycho2', name: 'Tycho-2', table: 'I/259/tyc2', ra: 'RAmdeg', dec: 'DEmdeg', mag: 'VTmag', color: 0xbcd0ff, band: 'optical (bright)' },
  { id: 'galexsrc', name: 'GALEX UV', table: 'II/335/galex_ais', ra: 'RAJ2000', dec: 'DEJ2000', mag: 'NUVmag', color: 0xc488ff, band: 'UV' },
  { id: 'nvss', name: 'NVSS (radio)', table: 'VIII/65/nvss', ra: 'RAJ2000', dec: 'DEJ2000', mag: null, color: 0xff7fb0, band: 'radio 1.4 GHz' },
];

export interface CatalogSource {
  raDeg: number;
  decDeg: number;
  mag: number | null;
}

const VIZIER_TAP = 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync';

// VizieR is a CDS service → share the SINGLE CDS token bucket (not a second one) so the combined
// rate to CDS stays under their ~5–6 req/s etiquette.
const acquire = (signal?: AbortSignal) => cdsLimiter.acquire(signal);

const cache = new Map<string, CatalogSource[]>();
const CACHE_CAP = 200; // bound long-session memory; evict oldest (Map preserves insertion order)

/** Cone-query a catalogue around (ra,dec); returns up to `limit` sources. */
export async function fetchCatalog(
  preset: CatalogPreset,
  raDeg: number,
  decDeg: number,
  radiusDeg: number,
  signal?: AbortSignal,
  limit = 1500,
): Promise<CatalogSource[]> {
  const r = Math.min(radiusDeg, 5.0);
  const key = `${preset.id}:${raDeg.toFixed(3)}:${decDeg.toFixed(3)}:${r.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cols = `${preset.ra},${preset.dec}${preset.mag ? ',' + preset.mag : ''}`;
  // Order by magnitude (brightest first) so the TOP-N cap returns the brightest sources spread
  // across the cone — not an arbitrary, spatially-clustered slice of the table (which over a wide
  // field looked like a tight blob). Chandra has no magnitude column, so it stays unordered.
  const order = preset.mag ? ` ORDER BY ${preset.mag} ASC` : '';
  const adql =
    `SELECT TOP ${limit} ${cols} FROM "${preset.table}" ` +
    `WHERE 1=CONTAINS(POINT('ICRS',${preset.ra},${preset.dec}),CIRCLE('ICRS',${raDeg},${decDeg},${r}))` +
    order;
  await acquire(signal);
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql });
  const resp = await fetch(VIZIER_TAP, { method: 'POST', body, ...(signal ? { signal } : {}) });
  if (!resp.ok) throw new Error(`VizieR ${resp.status}`);
  const json = (await resp.json()) as { metadata: { name: string }[]; data: unknown[][] };
  const names = json.metadata.map((m) => m.name);
  const iRa = names.indexOf(preset.ra);
  const iDec = names.indexOf(preset.dec);
  const iMag = preset.mag ? names.indexOf(preset.mag) : -1;
  const out: CatalogSource[] = [];
  for (const row of json.data) {
    const ra = Number(row[iRa]);
    const dec = Number(row[iDec]);
    if (!isFinite(ra) || !isFinite(dec)) continue;
    out.push({ raDeg: ra, decDeg: dec, mag: iMag >= 0 && row[iMag] != null ? Number(row[iMag]) : null });
  }
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}
