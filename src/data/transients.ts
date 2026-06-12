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

const ADAPTERS = {
  ztf: {
    label: 'ZTF (LSST precursor)',
    objects: 'https://api.alerce.online/ztf/v1/objects/',
    page: (oid: string) => `https://alerce.online/object/${oid}`,
  },
  // lsst: ready to enable when api-lsst.alerce.online/list_objects stabilises.
} as const;

const SURVEY: keyof typeof ADAPTERS = 'ztf';
const A = ADAPTERS[SURVEY];

export interface Transient {
  oid: string;
  raDeg: number;
  decDeg: number;
  firstMjd: number;
  lastMjd: number;
  ndet: number;
  cls: string | null;
}

export interface LcPoint {
  mjd: number;
  mag: number;
  fid: number; // 1=g, 2=r, 3=i
}

export const surveyLabel = A.label;
export const objectPageUrl = (oid: string): string => A.page(oid);

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

const coneCache = new Map<string, Transient[]>();

/** Recent transients within `radiusDeg` of an ICRS position, newest first. */
export async function fetchNear(
  raDeg: number,
  decDeg: number,
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<Transient[]> {
  const key = `${raDeg.toFixed(2)}:${decDeg.toFixed(2)}:${radiusDeg.toFixed(2)}`;
  const cached = coneCache.get(key);
  if (cached) return cached;

  await acquire();
  const radiusArcsec = Math.min(radiusDeg * 3600, 36000); // cap 10°
  const url =
    `${A.objects}?ra=${raDeg}&dec=${decDeg}&radius=${radiusArcsec}` +
    `&page=1&page_size=40&order_by=lastmjd&order_mode=DESC&count=false`;
  const r = await fetch(url, signal ? { signal } : {});
  if (!r.ok) throw new Error(`broker ${r.status}`);
  const j = (await r.json()) as { items?: Record<string, unknown>[] };
  const out: Transient[] = (j.items ?? []).map((o) => ({
    oid: String(o['oid']),
    raDeg: Number(o['meanra']),
    decDeg: Number(o['meandec']),
    firstMjd: Number(o['firstmjd']),
    lastMjd: Number(o['lastmjd']),
    ndet: Number(o['ndet'] ?? 0),
    cls: (o['class'] as string) ?? null,
  }));
  coneCache.set(key, out);
  return out;
}

const lcCache = new Map<string, LcPoint[]>();

/** Light-curve detections (magnitude vs MJD) for one object. */
export async function fetchLightcurve(oid: string, signal?: AbortSignal): Promise<LcPoint[]> {
  const cached = lcCache.get(oid);
  if (cached) return cached;
  await acquire();
  const r = await fetch(`${A.objects}${encodeURIComponent(oid)}/lightcurve`, signal ? { signal } : {});
  if (!r.ok) throw new Error(`lightcurve ${r.status}`);
  const j = (await r.json()) as { detections?: Record<string, unknown>[] };
  const pts: LcPoint[] = (j.detections ?? [])
    .map((d) => ({ mjd: Number(d['mjd']), mag: Number(d['magpsf']), fid: Number(d['fid']) }))
    .filter((p) => isFinite(p.mjd) && isFinite(p.mag))
    .sort((a, b) => a.mjd - b.mjd);
  lcCache.set(oid, pts);
  return pts;
}

/** Static fallback snapshot (bundled, real data) when the live broker is slow/unreachable. */
export async function loadSnapshot(): Promise<Transient[]> {
  try {
    const j = (await (await fetch('transients/tonight.json')).json()) as {
      transients: { oid: string; ra: number; dec: number; firstmjd: number; lastmjd: number; ndet: number; cls: string | null }[];
    };
    return j.transients.map((t) => ({
      oid: t.oid,
      raDeg: t.ra,
      decDeg: t.dec,
      firstMjd: t.firstmjd,
      lastMjd: t.lastmjd,
      ndet: t.ndet,
      cls: t.cls,
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
