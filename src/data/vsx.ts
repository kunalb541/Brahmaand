/**
 * AAVSO VSX (International Variable Star Index) — the authoritative catalogue of known variable
 * stars. CORS-open JSON API (vsx.aavso.org), so it runs browser-direct. For a transient/alert this
 * answers "is this a known variable, and what's its published period/type/range?" — and lets us
 * cross-check our own measured Lomb–Scargle period against the literature value.
 */

const VSX_URL = 'https://vsx.aavso.org/index.php';

export interface VsxMatch {
  name: string;
  type: string; // VariabilityType, e.g. "RRAB", "EW", "M"
  periodDays: number | null;
  maxMag: string; // e.g. "7.17 V"
  minMag: string; // e.g. "8.14 V" (or an amplitude like "(0.33) g")
  sepArcsec: number;
  oid: string;
}

function sepArcsec(ra1: number, d1: number, ra2: number, d2: number): number {
  const R = Math.PI / 180;
  const s =
    Math.sin(((d2 - d1) * R) / 2) ** 2 +
    Math.cos(d1 * R) * Math.cos(d2 * R) * Math.sin(((ra2 - ra1) * R) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s))) * 180) / Math.PI * 3600;
}

/** Nearest VSX variable within `radiusDeg` of the position, or null. */
export async function vsxConeSearch(
  raDeg: number,
  decDeg: number,
  radiusDeg: number,
  signal?: AbortSignal,
): Promise<VsxMatch | null> {
  const url =
    `${VSX_URL}?view=api.list&ra=${raDeg.toFixed(6)}&dec=${decDeg.toFixed(6)}` +
    `&radius=${radiusDeg.toFixed(5)}&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const j = (await res.json()) as { VSXObjects?: { VSXObject?: unknown } };
  const raw = j?.VSXObjects?.VSXObject;
  if (!raw) return null;
  const arr = (Array.isArray(raw) ? raw : [raw]) as Record<string, string>[];

  let best: VsxMatch | null = null;
  for (const o of arr) {
    const ra = Number(o['RA2000']);
    const dec = Number(o['Declination2000']);
    if (!isFinite(ra) || !isFinite(dec)) continue;
    const pStr = o['Period'];
    const p = pStr != null && String(pStr).trim() !== '' ? Number(pStr) : NaN;
    const m: VsxMatch = {
      name: String(o['Name'] ?? ''),
      type: String(o['VariabilityType'] ?? ''),
      periodDays: isFinite(p) ? p : null,
      maxMag: String(o['MaxMag'] ?? ''),
      minMag: String(o['MinMag'] ?? ''),
      sepArcsec: sepArcsec(raDeg, decDeg, ra, dec),
      oid: String(o['OID'] ?? ''),
    };
    if (!best || m.sepArcsec < best.sepArcsec) best = m;
  }
  return best;
}

export function vsxLink(oid: string): string {
  return `${VSX_URL}?view=detail.top&oid=${encodeURIComponent(oid)}`;
}
