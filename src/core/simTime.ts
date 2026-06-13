/**
 * Simulation clock — the "time machine". The whole solar-system/observability pipeline reads
 * THIS clock, not Date.now(), so the user can scrub to any date and animate time forward or
 * backward at planetarium rates (Stellarium-style).
 *
 * Model: sim(t) = baseSim + (realNow − baseReal) · rate. rate = 1 → real time; 0 → paused;
 * negative → backwards. Re-based on every rate/time change so there is no drift.
 */

let baseSim = Date.now();
let baseReal = Date.now();
let rate = 1;

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

/** Current simulation time, Unix ms (UTC). */
export function getSimMs(): number {
  return baseSim + (Date.now() - baseReal) * rate;
}

export function getRate(): number {
  return rate;
}

export function setRate(r: number): void {
  baseSim = getSimMs();
  baseReal = Date.now();
  rate = r;
  emit();
}

export function setSimMs(ms: number): void {
  baseSim = ms;
  baseReal = Date.now();
  emit();
}

/** Jump back to live real time (rate 1, now). */
export function resetToNow(): void {
  baseSim = Date.now();
  baseReal = Date.now();
  rate = 1;
  emit();
}

/** True when tracking real time (rate 1 and within 2 s of the wall clock). */
export function isLive(): boolean {
  return rate === 1 && Math.abs(getSimMs() - Date.now()) < 2000;
}

/** Subscribe to rate/jump changes (not every tick). Returns an unsubscribe. */
export function onTimeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
