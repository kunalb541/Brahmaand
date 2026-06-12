export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

/** Format RA (radians) as `HHh MMm` (hours/minutes). */
export function formatRa(raRad: number): string {
  let h = (raRad / TAU) * 24;
  h = ((h % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m`;
}

/** Format Dec (radians) as `±DD° MM′`. */
export function formatDec(decRad: number): string {
  const d = decRad * RAD2DEG;
  const sign = d < 0 ? '-' : '+';
  const ad = Math.abs(d);
  const dd = Math.floor(ad);
  const mm = Math.floor((ad - dd) * 60);
  return `${sign}${String(dd).padStart(2, '0')}° ${String(mm).padStart(2, '0')}′`;
}
