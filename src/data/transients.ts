/**
 * Live transient ("what changed in the sky") provider. Browser-direct, CORS-verified
 * 2026-06-12 against the ALeRCE broker (ZTF alert stream — the LSST precursor survey).
 *
 * Design note (see docs/DECISIONS.md): the Rubin/LSST broker endpoints
 * (api-lsst.alerce.online) are live but their /list_objects 500s and the full-table
 * lastmjd sort times out. The CONE search is fast (spatially indexed) and reliable, so the
 * app queries transients *near the current view*. The provider is abstracted by `SURVEY`
 * so the LSST host drops in once its API stabilises. A static `tonight.json` snapshot is the
 * offline fallback. IDs are kept as STRINGS (ZTF oid; LSST diaObjectId is int64 > 2^53).
 */

// Broker. ANTARES (NOIRLab) is the primary: it carries the REAL Rubin/LSST alert stream (plus
// ZTF), community-filter TAGS, catalogue cross-matches and thumbnails — fuller than ALeRCE-ZTF,
// CORS-open, and its recent-all-sky + cone queries are fast (no burst throttle). ALeRCE-ZTF is
// kept as an alternate. IDs are strings (LSST diaObjectId is int64 > 2^53).
type Broker = 'antares' | 'ztf';
const BROKER: Broker = 'antares';

const ANTARES = 'https://api.antares.noirlab.edu/v1';
const ALERCE = 'https://api.alerce.online/ztf/v1/objects/';

export interface Transient {
  oid: string;
  raDeg: number;
  decDeg: number;
  firstMjd: number;
  lastMjd: number;
  ndet: number;
  cls: string | null;
  /** ANTARES community-filter tags (classification/quality), if any. */
  tags?: string[];
}

export interface LcPoint {
  mjd: number;
  mag: number;
  fid: number; // 1=g, 2=r, 3=i
}

// ---- classification groups (for all-sky marker colouring + filtering) ----
export type TransientGroup = 'transient' | 'agn' | 'periodic' | 'stochastic' | 'other';

export const GROUP_COLOR: Record<TransientGroup, [number, number, number]> = {
  transient: [1.0, 0.36, 0.24], // red-orange — supernovae / transients
  agn: [0.8, 0.36, 1.0], // purple — AGN / QSO / blazar
  periodic: [0.34, 0.7, 1.0], // blue — pulsating / eclipsing variables
  stochastic: [0.28, 0.92, 0.62], // green — YSO / CV / nova
  other: [0.62, 0.68, 0.8], // grey-blue — unclassified / other
};

export const GROUP_LABEL: Record<TransientGroup, string> = {
  transient: 'Supernovae / transients',
  agn: 'AGN / QSO / blazar',
  periodic: 'Pulsating / eclipsing',
  stochastic: 'YSO / CV / nova',
  other: 'Unclassified / other',
};

export const GROUP_LIST: TransientGroup[] = ['transient', 'agn', 'periodic', 'stochastic', 'other'];

/** Map an ALeRCE class label to one of our display groups. */
export function classGroup(cls: string | null): TransientGroup {
  if (!cls) return 'other';
  const c = cls.toUpperCase();
  if (c.startsWith('SN') || c.includes('SLSN') || c.includes('TRANSIENT')) return 'transient';
  if (c === 'AGN' || c === 'QSO' || c === 'BLAZAR') return 'agn';
  if (c === 'YSO' || c === 'CV/NOVA' || c === 'CV' || c === 'NOVA') return 'stochastic';
  if (
    c.includes('PERIODIC') ||
    ['RRL', 'CEP', 'CEPH', 'DSCT', 'E', 'EA', 'EB', 'LPV'].includes(c)
  )
    return 'periodic';
  return 'other';
}

export const brokerName = BROKER === 'antares' ? 'ANTARES' : 'ALeRCE';
export const surveyLabel =
  BROKER === 'antares' ? 'ANTARES · Rubin/LSST + ZTF' : 'ALeRCE · ZTF (LSST precursor)';
export const objectPageUrl = (oid: string): string =>
  BROKER === 'antares' ? `https://antares.noirlab.edu/loci/${oid}` : `https://alerce.online/object/${oid}`;

/** ANTARES tags → a coarse class label for marker colouring (tags drive the panel detail). */
function antaresCls(tags: string[]): string | null {
  for (const t of tags) {
    const x = t.toLowerCase();
    if (x.includes('transient') || x.includes('supernova') || x.includes('sn_')) return 'Transient';
  }
  return null;
}
const PB_FID: Record<string, number> = { u: 1, g: 1, r: 2, R: 2, i: 3, z: 3, y: 3 };

// ---- tiny rate limiter (3/s; ALeRCE is a separate host from CDS) ----
let tokens = 3;
const waiters: Array<() => void> = [];
setInterval(() => {
  tokens = 3;
  while (tokens > 0 && waiters.length) {
    tokens--;
    waiters.shift()!();
  }
}, 1000);
function acquire(): Promise<void> {
  if (tokens > 0) {
    tokens--;
    return Promise.resolve();
  }
  return new Promise((r) => waiters.push(r));
}

const CONE_TTL_MS = 30000; // live: cone results expire so polling fetches fresh alerts
const coneCache = new Map<string, { data: Transient[]; t: number }>();

/** Recent transients within `radiusDeg` of an ICRS position, newest first. */
export async function fetchNear(
  raDeg: number,
  decDeg: number,
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<Transient[]> {
  const key = `${raDeg.toFixed(2)}:${decDeg.toFixed(2)}:${radiusDeg.toFixed(2)}`;
  const cached = coneCache.get(key);
  if (cached && Date.now() - cached.t < CONE_TTL_MS) return cached.data;

  await acquire();
  let out: Transient[];
  if (BROKER === 'antares') {
    const rad = Math.min(radiusDeg, 10);
    const url =
      `${ANTARES}/loci?filter%5Bcone%5D=${raDeg},${decDeg},${rad}` +
      `&page%5Bsize%5D=100&sort=-properties.newest_alert_observation_time`;
    const r = await fetch(url, signal ? { signal } : {});
    if (!r.ok) throw new Error(`ANTARES ${r.status}`);
    const j = (await r.json()) as { data?: { id: string; attributes: Record<string, unknown> }[] };
    out = (j.data ?? [])
      .map((o) => {
        const a = o.attributes;
        const p = (a['properties'] ?? {}) as Record<string, number>;
        const tags = (a['tags'] as string[]) ?? [];
        return {
          oid: o.id,
          raDeg: Number(a['ra']),
          decDeg: Number(a['dec']),
          firstMjd: Number(p['oldest_alert_observation_time'] ?? p['newest_alert_observation_time']),
          lastMjd: Number(p['newest_alert_observation_time']),
          ndet: Number(p['num_alerts'] ?? 1),
          cls: antaresCls(tags),
          tags,
        };
      })
      .filter((t) => isFinite(t.raDeg) && isFinite(t.decDeg));
  } else {
    const radiusArcsec = Math.min(radiusDeg * 3600, 36000);
    const url =
      `${ALERCE}?ra=${raDeg}&dec=${decDeg}&radius=${radiusArcsec}` +
      `&page=1&page_size=40&order_by=lastmjd&order_mode=DESC&count=false`;
    const r = await fetch(url, signal ? { signal } : {});
    if (!r.ok) throw new Error(`broker ${r.status}`);
    const j = (await r.json()) as { items?: Record<string, unknown>[] };
    out = (j.items ?? []).map((o) => ({
      oid: String(o['oid']),
      raDeg: Number(o['meanra']),
      decDeg: Number(o['meandec']),
      firstMjd: Number(o['firstmjd']),
      lastMjd: Number(o['lastmjd']),
      ndet: Number(o['ndet'] ?? 0),
      cls: (o['class'] as string) ?? null,
    }));
  }
  coneCache.set(key, { data: out, t: Date.now() });
  return out;
}

export interface Lightcurve {
  points: LcPoint[];
  /** Deep-learning real-bogus score (max over detections), 0..1; null if absent. */
  drb: number | null;
  /** Random-forest real-bogus (fallback when drb is absent). */
  rb: number | null;
}

const lcCache = new Map<string, Lightcurve>();

/** Light-curve detections (magnitude vs MJD) + real-bogus quality scores for one object. */
export async function fetchLightcurve(oid: string, signal?: AbortSignal): Promise<Lightcurve> {
  const cached = lcCache.get(oid);
  if (cached) return cached;
  await acquire();

  if (BROKER === 'antares') {
    const r = await fetch(`${ANTARES}/loci/${encodeURIComponent(oid)}`, signal ? { signal } : {});
    if (!r.ok) throw new Error(`ANTARES locus ${r.status}`);
    const j = (await r.json()) as { data?: { attributes?: { lightcurve?: string } } };
    const csv = j.data?.attributes?.lightcurve ?? '';
    const lines = csv.split('\n');
    const hdr = lines[0]?.split(',') ?? [];
    const iMjd = hdr.indexOf('ant_mjd');
    const iMag = hdr.indexOf('ant_mag');
    const iPb = hdr.indexOf('ant_passband');
    const points: LcPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i]!.split(',');
      const mjd = parseFloat(f[iMjd]!);
      const mag = parseFloat(f[iMag]!); // empty = upper limit (non-detection) → skipped
      if (!isFinite(mjd) || !isFinite(mag)) continue;
      points.push({ mjd, mag, fid: PB_FID[f[iPb]!] ?? 2 });
    }
    points.sort((a, b) => a.mjd - b.mjd);
    const lc: Lightcurve = { points, drb: null, rb: null };
    lcCache.set(oid, lc);
    return lc;
  }

  const r = await fetch(`${ALERCE}${encodeURIComponent(oid)}/lightcurve`, signal ? { signal } : {});
  if (!r.ok) throw new Error(`lightcurve ${r.status}`);
  const j = (await r.json()) as { detections?: Record<string, unknown>[] };
  const dets = j.detections ?? [];
  const points: LcPoint[] = dets
    .map((d) => ({ mjd: Number(d['mjd']), mag: Number(d['magpsf']), fid: Number(d['fid']) }))
    .filter((p) => isFinite(p.mjd) && isFinite(p.mag))
    .sort((a, b) => a.mjd - b.mjd);
  const max = (k: string): number | null => {
    let m: number | null = null;
    for (const d of dets) {
      const v = Number(d[k]);
      if (isFinite(v)) m = m === null ? v : Math.max(m, v);
    }
    return m;
  };
  const lc: Lightcurve = { points, drb: max('drb'), rb: max('rb') };
  lcCache.set(oid, lc);
  return lc;
}

// ---- ML classifications (the broker's classifiers, e.g. ALeRCE lc_classifier) ----
export interface ClassProb {
  classifier: string;
  version: string;
  cls: string;
  prob: number;
  ranking: number;
}

const probCache = new Map<string, ClassProb[]>();

/** The broker's ML classifier outputs for one object (all classifiers, ranked). */
export async function fetchProbabilities(oid: string, signal?: AbortSignal): Promise<ClassProb[]> {
  if (BROKER === 'antares') return []; // ANTARES classification is tag-based (shown in the panel)
  const cached = probCache.get(oid);
  if (cached) return cached;
  await acquire();
  const r = await fetch(`${ALERCE}${encodeURIComponent(oid)}/probabilities`, signal ? { signal } : {});
  if (!r.ok) throw new Error(`probabilities ${r.status}`);
  const j = (await r.json()) as Record<string, unknown>[];
  const out: ClassProb[] = j
    .map((p) => ({
      classifier: String(p['classifier_name'] ?? ''),
      version: String(p['classifier_version'] ?? ''),
      cls: String(p['class_name'] ?? ''),
      prob: Number(p['probability'] ?? 0),
      ranking: Number(p['ranking'] ?? 99),
    }))
    .filter((p) => isFinite(p.prob));
  probCache.set(oid, out);
  return out;
}

/** Best current classification: the ranking-1 entry of the main light-curve classifier. */
export function bestClass(probs: ClassProb[]): ClassProb | null {
  const main = probs.filter((p) => p.classifier === 'lc_classifier' && p.ranking === 1);
  if (main.length) return main.sort((a, b) => b.prob - a.prob)[0]!;
  const any = probs.filter((p) => p.ranking === 1).sort((a, b) => b.prob - a.prob);
  return any[0] ?? null;
}

/** Top-N classes of the main classifier (for the pro ranking table). */
export function topClasses(probs: ClassProb[], n = 3): ClassProb[] {
  return probs
    .filter((p) => p.classifier === 'lc_classifier')
    .sort((a, b) => a.ranking - b.ranking)
    .slice(0, n);
}

/** Static fallback snapshot (bundled, real data) when the live broker is slow/unreachable. */
export async function loadSnapshot(): Promise<Transient[]> {
  try {
    const j = (await (await fetch('transients/tonight.json')).json()) as {
      transients: { oid: string; ra: number; dec: number; firstmjd: number; lastmjd: number; ndet: number; cls: string | null; tags?: string[] }[];
    };
    return j.transients.map((t) => ({
      oid: t.oid,
      raDeg: t.ra,
      decDeg: t.dec,
      firstMjd: t.firstmjd,
      lastMjd: t.lastmjd,
      ndet: t.ndet,
      cls: t.cls,
      tags: t.tags,
    }));
  } catch {
    return [];
  }
}

// ---- helpers ----
const MJD_UNIX_EPOCH = 40587; // MJD at 1970-01-01

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - MJD_UNIX_EPOCH) * 86400000);
}

/** Whole days since a detection (for recency styling). */
export function ageDays(lastMjd: number, nowMs: number): number {
  return (nowMs - mjdToDate(lastMjd).getTime()) / 86400000;
}

export const FID_BAND = ['', 'g', 'r', 'i'];
