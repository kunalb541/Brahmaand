/** HiPS tile URL construction (IVOA HiPS 1.0 §6, doc 03 §4). */

export const EXT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

/** `{base}/Norder{K}/Dir{D}/Npix{N}.{ext}` with D = floor(N/10000)*10000. */
export function tileUrl(base: string, order: number, npix: number, fmt: string): string {
  const dir = Math.floor(npix / 10000) * 10000; // Math.floor, never >> (32-bit overflow)
  return `${base}/Norder${order}/Dir${dir}/Npix${npix}.${EXT[fmt] ?? 'jpg'}`;
}
