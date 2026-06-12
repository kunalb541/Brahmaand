/**
 * CDS data client — all browser-direct, no backend. Every endpoint live-verified CORS-open
 * (Access-Control-Allow-Origin: *) on 2026-06-12:
 *   SIMBAD TAP  https://simbad.cds.unistra.fr/simbad/sim-tap/sync   (cone + detail, FORMAT=json)
 *   Sesame      https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV  (name → coords, XML)
 *   hips2fits   https://alasky.cds.unistra.fr/hips-image-services/hips2fits (cutout)
 *
 * Cone search + object detail go through SIMBAD TAP (ADQL CONTAINS/DISTANCE) rather than the
 * /cone REST endpoint, which returned HTML not JSON when probed (see docs/DECISIONS.md). One
 * shared token-bucket limiter fronts every CDS call (CDS blacklists ~5–6 req/s abusers).
 */

// ---------- rate limiter (≤ 4 req/s, headroom under CDS's ~5–6 limit) ----------
class RateLimiter {
  private queue: Array<() => void> = [];
  private tokens: number;
  constructor(private maxPerSecond = 4) {
    this.tokens = maxPerSecond;
    setInterval(() => {
      this.tokens = this.maxPerSecond;
      while (this.tokens > 0 && this.queue.length) {
        this.tokens--;
        this.queue.shift()!();
      }
    }, 1000);
  }
  acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    }
    return new Promise((res) => this.queue.push(res));
  }
}
const cdsLimiter = new RateLimiter(4);

// ---------- generic LRU ----------
class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private maxEntries = 400) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value!);
  }
}

// ---------- TAP ----------
interface TapResult {
  metadata: { name: string }[];
  data: unknown[][];
}
const SIMBAD_TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const tapCache = new LruCache<TapResult>(300);

async function tapQuery(adql: string, signal?: AbortSignal): Promise<TapResult> {
  const cached = tapCache.get(adql);
  if (cached) return cached;
  await cdsLimiter.acquire();
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql });
  const r = await fetch(SIMBAD_TAP, { method: 'POST', body, ...(signal ? { signal } : {}) });
  if (!r.ok) throw new Error(`SIMBAD TAP ${r.status}`);
  const json = (await r.json()) as TapResult;
  if (!Array.isArray(json.metadata) || !Array.isArray(json.data)) throw new Error('bad TAP JSON');
  tapCache.set(adql, json);
  return json;
}

/** Map rows to objects keyed by column name — never hardcode indexes. */
function rows(res: TapResult): Record<string, unknown>[] {
  const names = res.metadata.map((m) => m.name);
  return res.data.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])));
}

const esc = (s: string) => s.replace(/'/g, "''");

// ---------- cone search (distance-sorted) ----------
export interface ConeHit {
  mainId: string;
  raDeg: number;
  decDeg: number;
  otype: string;
  distArcsec: number;
}

export async function coneSearch(
  raDeg: number,
  decDeg: number,
  srDeg: number,
  signal?: AbortSignal,
  maxRec = 12,
): Promise<ConeHit[]> {
  const adql =
    `SELECT TOP ${maxRec} main_id, ra, dec, otype, ` +
    `DISTANCE(POINT('ICRS',ra,dec),POINT('ICRS',${raDeg},${decDeg})) AS d ` +
    `FROM basic WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${raDeg},${decDeg},${srDeg}))=1 ` +
    `ORDER BY d`;
  const res = await tapQuery(adql, signal);
  return rows(res)
    .filter((o) => o['ra'] != null && o['dec'] != null)
    .map((o) => ({
      mainId: String(o['main_id']),
      raDeg: Number(o['ra']),
      decDeg: Number(o['dec']),
      otype: String(o['otype'] ?? ''),
      distArcsec: Number(o['d']) * 3600,
    }));
}

// ---------- object detail ----------
export interface ObjectDetail {
  mainId: string;
  otype: string;
  spType: string | null;
  plxMas: number | null;
  pmRa: number | null;
  pmDec: number | null;
  rv: number | null;
  fluxes: { band: string; mag: number }[];
}

const FLUX_BANDS = ['U', 'B', 'V', 'R', 'I', 'G', 'J', 'H', 'K'];

export async function objectDetail(mainId: string, signal?: AbortSignal): Promise<ObjectDetail | null> {
  const fcols = FLUX_BANDS.map((b) => `f.${b}`).join(',');
  const adql =
    `SELECT b.main_id,b.otype,b.sp_type,b.plx_value,b.pmra,b.pmdec,b.rvz_radvel,${fcols} ` +
    `FROM basic b LEFT JOIN allfluxes f ON f.oidref=b.oid WHERE b.main_id='${esc(mainId)}'`;
  const res = await tapQuery(adql, signal);
  const o = rows(res)[0];
  if (!o) return null;
  const fluxes: { band: string; mag: number }[] = [];
  for (const band of FLUX_BANDS) {
    const v = o[band];
    if (v != null && isFinite(Number(v))) fluxes.push({ band, mag: Number(v) });
  }
  const num = (k: string) => (o[k] != null && isFinite(Number(o[k])) ? Number(o[k]) : null);
  return {
    mainId: String(o['main_id']),
    otype: String(o['otype'] ?? ''),
    spType: (o['sp_type'] as string) || null,
    plxMas: num('plx_value'),
    pmRa: num('pmra'),
    pmDec: num('pmdec'),
    rv: num('rvz_radvel'),
    fluxes,
  };
}

// ---------- Sesame name resolver ----------
export interface ResolvedName {
  name: string;
  raDeg: number;
  decDeg: number;
  otype: string | undefined;
}
const sesameCache = new LruCache<ResolvedName | null>(200);

export async function resolveName(raw: string): Promise<ResolvedName | null> {
  const name = raw.trim();
  if (!name) return null;

  // direct coordinate entry: "10.68 41.27" or "10.68, +41.27"
  const m = name.match(/^(-?\d+(?:\.\d+)?)[ ,]+([+-]?\d+(?:\.\d+)?)$/);
  if (m) return { name, raDeg: parseFloat(m[1]!), decDeg: parseFloat(m[2]!), otype: undefined };

  const key = name.toLowerCase();
  const hit = sesameCache.get(key);
  if (hit !== undefined) return hit;

  await cdsLimiter.acquire();
  const url = `https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?${encodeURIComponent(name)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sesame ${r.status}`);
  const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const text = (sel: string, root: ParentNode = doc) => root.querySelector(sel)?.textContent ?? null;
  const ra = text('jradeg');
  const de = text('jdedeg');
  const result: ResolvedName | null =
    ra && de
      ? { name: text('oname') ?? name, raDeg: parseFloat(ra), decDeg: parseFloat(de), otype: text('otype') ?? undefined }
      : null;
  sesameCache.set(key, result);
  return result;
}

// ---------- hips2fits cutout ----------
const HIPS2FITS = [
  'https://alasky.cds.unistra.fr/hips-image-services/hips2fits',
  'https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits',
];

export function cutoutUrl(opts: {
  hipsId: string;
  raDeg: number;
  decDeg: number;
  fovDeg: number;
  size?: number;
  hostIndex?: 0 | 1;
}): string {
  const p = new URLSearchParams({
    hips: opts.hipsId,
    ra: String(opts.raDeg),
    dec: String(opts.decDeg),
    fov: String(opts.fovDeg),
    width: String(opts.size ?? 280),
    height: String(opts.size ?? 280),
    projection: 'TAN',
    coordsys: 'icrs',
    format: 'jpg',
  });
  return `${HIPS2FITS[opts.hostIndex ?? 0]}?${p}`;
}

// ---------- formatters ----------
export function formatRaHms(raDeg: number): string {
  let h = (((raDeg / 15) % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(1).padStart(4, '0')}s`;
}
export function formatDecDms(decDeg: number): string {
  const sign = decDeg < 0 ? '-' : '+';
  const a = Math.abs(decDeg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60);
  return `${sign}${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″`;
}

// ---------- otype decoding (common codes; raw shown if unknown) ----------
const OTYPE: Record<string, string> = {
  '*': 'Star',
  '**': 'Double/multiple star',
  'SB*': 'Spectroscopic binary',
  'EB*': 'Eclipsing binary',
  V: 'Variable star',
  'V*': 'Variable star',
  'Pe*': 'Peculiar star',
  'WD*': 'White dwarf',
  'PM*': 'High proper-motion star',
  'C*': 'Carbon star',
  'RG*': 'Red giant',
  's*r': 'Red supergiant',
  'Y*O': 'Young stellar object',
  'Em*': 'Emission-line star',
  'BD*': 'Brown dwarf',
  Pl: 'Planet',
  ISM: 'Interstellar matter',
  Cl: 'Cluster',
  'Cl*': 'Star cluster',
  'GlC': 'Globular cluster',
  'OpC': 'Open cluster',
  'As*': 'Association of stars',
  PN: 'Planetary nebula',
  SNR: 'Supernova remnant',
  HII: 'HII region',
  'Neb': 'Nebula',
  G: 'Galaxy',
  AGN: 'Active galactic nucleus',
  Sy: 'Seyfert galaxy',
  QSO: 'Quasar',
  GiG: 'Galaxy in group',
  GiC: 'Galaxy in cluster',
  GrG: 'Group of galaxies',
  ClG: 'Cluster of galaxies',
  rG: 'Radio galaxy',
  'SN*': 'Supernova',
  X: 'X-ray source',
  Rad: 'Radio source',
  IR: 'Infrared source',
  blu: 'Blue object',
  'mul': 'Composite object',
};

export function otypeLabel(code: string): string {
  return OTYPE[code] ?? code;
}

/** SIMBAD HTML object page (for an outbound link). */
export function simbadLink(mainId: string): string {
  return `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(mainId)}`;
}
