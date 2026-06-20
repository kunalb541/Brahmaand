/**
 * Photometric unit conversions. Survey light curves come as magnitudes, but flux space is what
 * difference-imaging photometry (ZTF, Rubin/LSST) actually measures — it's linear, handles faint
 * sources near the limit, and is the natural space for amplitudes. Rubin alerts report flux in
 * nanojansky directly. Standard AB zero-points: AB mag = 23.9 − 2.5·log10(f / µJy) = 31.4 −
 * 2.5·log10(f / nJy).
 */

/** AB magnitude → flux density in microjansky. */
export function abMagToMicroJy(mag: number): number {
  return Math.pow(10, (23.9 - mag) / 2.5);
}

/** AB magnitude → flux density in nanojansky (the Rubin/LSST alert unit). */
export function abMagToNanoJy(mag: number): number {
  return Math.pow(10, (31.4 - mag) / 2.5);
}

/** Flux density (nanojansky) → AB magnitude. */
export function nanoJyToAbMag(fluxNanoJy: number): number {
  return 31.4 - 2.5 * Math.log10(fluxNanoJy);
}

/** A compact human flux string (auto µJy / mJy / Jy). */
export function formatFlux(microJy: number): string {
  if (microJy >= 1e6) return `${(microJy / 1e6).toFixed(2)} Jy`;
  if (microJy >= 1e3) return `${(microJy / 1e3).toFixed(2)} mJy`;
  if (microJy >= 10) return `${microJy.toFixed(0)} µJy`;
  return `${microJy.toFixed(1)} µJy`;
}
