/**
 * Minimal, accurate FITS reader for the quantitative ("pro") cutout mode.
 *
 * Built for the cutouts CDS hips2fits returns (single-HDU 2-D image, TAN WCS). It reports the
 * TRUE pixel values in the file's physical units (physical = BZERO + BSCALE · raw), the image
 * min/max, an IRAF-style **zscale** display range, and a WCS mapping from pixel → (RA, Dec) so the
 * cursor readout is scientifically correct — no resampling, no guessed numbers.
 *
 * FITS standard: 80-char header cards packed into 2880-byte blocks; data is big-endian and begins
 * at the next 2880-byte boundary after END. We handle BITPIX 8 / 16 / 32 / -32 / -64.
 * Refs: FITS Standard 4.0 (https://fits.gsfc.nasa.gov/fits_standard.html);
 *       Greisen & Calabretta 2002 (WCS, gnomonic TAN); IRAF zscale (cdl zsc_zlimits).
 */

export interface FitsWcs {
  crpix1: number; crpix2: number; // reference pixel (1-based)
  crval1: number; crval2: number; // reference world coords (deg) — RA, Dec for TAN
  cd11: number; cd12: number; cd21: number; cd22: number; // pixel→intermediate-world (deg)
  ctype1: string; ctype2: string;
}

export interface FitsImage {
  width: number;
  height: number;
  /** Physical values (BZERO + BSCALE·raw), row-major, FITS order (first row = bottom). */
  data: Float32Array;
  bunit: string; // physical unit, if declared
  min: number;
  max: number;
  /** IRAF zscale display limits (good default contrast for astronomical images). */
  z1: number;
  z2: number;
  wcs: FitsWcs | null;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function parseHeader(buf: ArrayBuffer): { cards: Map<string, string>; dataStart: number } {
  const bytes = new Uint8Array(buf);
  const cards = new Map<string, string>();
  let offset = 0;
  let end = false;
  while (!end && offset < bytes.length) {
    // one 2880-byte block = 36 cards of 80 chars
    for (let c = 0; c < 36; c++) {
      const start = offset + c * 80;
      let s = '';
      for (let k = 0; k < 80; k++) s += String.fromCharCode(bytes[start + k]!);
      const key = s.slice(0, 8).trim();
      if (key === 'END') {
        end = true;
        break;
      }
      if (key && s[8] === '=') {
        let val = s.slice(10).trim();
        const slash = val.indexOf('/'); // strip inline comment (not inside a string)
        if (val[0] === "'") {
          const close = val.indexOf("'", 1);
          val = val.slice(1, close < 0 ? undefined : close).trim();
        } else if (slash >= 0) {
          val = val.slice(0, slash).trim();
        }
        cards.set(key, val);
      }
    }
    offset += 2880;
  }
  return { cards, dataStart: offset };
}

function num(cards: Map<string, string>, key: string, dflt: number): number {
  const v = cards.get(key);
  if (v == null) return dflt;
  const n = parseFloat(v);
  return isFinite(n) ? n : dflt;
}

/** IRAF zscale: sample, fit a robust line to the sorted samples, derive contrast-limited z1/z2. */
function zscale(data: Float32Array, contrast = 0.25, nSamples = 600): { z1: number; z2: number } {
  const n = data.length;
  const step = Math.max(1, Math.floor(n / nSamples));
  const samples: number[] = [];
  for (let i = 0; i < n; i += step) {
    const v = data[i]!;
    if (isFinite(v)) samples.push(v);
  }
  if (samples.length < 5) {
    let mn = Infinity, mx = -Infinity;
    for (const v of samples) { if (v < mn) mn = v; if (v > mx) mx = v; }
    return { z1: mn, z2: mx };
  }
  samples.sort((a, b) => a - b);
  const npix = samples.length;
  const median = samples[npix >> 1]!;
  // iterative least-squares line fit (value vs normalized index) with 2.5σ rejection
  const x = samples.map((_, i) => i - (npix - 1) / 2);
  let good = new Array(npix).fill(true);
  let slope = 0, intercept = median;
  for (let iter = 0; iter < 5; iter++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, cnt = 0;
    for (let i = 0; i < npix; i++) {
      if (!good[i]) continue;
      sx += x[i]!; sy += samples[i]!; sxx += x[i]! * x[i]!; sxy += x[i]! * samples[i]!; cnt++;
    }
    const denom = cnt * sxx - sx * sx;
    if (denom === 0) break;
    slope = (cnt * sxy - sx * sy) / denom;
    intercept = (sy - slope * sx) / cnt;
    let ss = 0, m = 0;
    for (let i = 0; i < npix; i++) {
      if (!good[i]) continue;
      const r = samples[i]! - (intercept + slope * x[i]!);
      ss += r * r; m++;
    }
    const sigma = Math.sqrt(ss / Math.max(1, m));
    let changed = false;
    for (let i = 0; i < npix; i++) {
      const r = Math.abs(samples[i]! - (intercept + slope * x[i]!));
      const g = r < 2.5 * sigma;
      if (g !== good[i]) changed = true;
      good[i] = g;
    }
    if (!changed) break;
  }
  const slopePer = contrast > 0 ? slope / contrast : slope;
  let z1 = median + slopePer * (0 - (npix - 1) / 2);
  let z2 = median + slopePer * (npix - 1 - (npix - 1) / 2);
  // never invert or exceed the real data range
  z1 = Math.max(z1, samples[0]!);
  z2 = Math.min(z2, samples[npix - 1]!);
  if (z2 <= z1) { z1 = samples[0]!; z2 = samples[npix - 1]!; }
  return { z1, z2 };
}

/** Parse a single-HDU 2-D FITS image. Throws on unsupported/empty input. */
export function parseFits(buf: ArrayBuffer): FitsImage {
  const { cards, dataStart } = parseHeader(buf);
  const bitpix = num(cards, 'BITPIX', 0);
  const naxis = num(cards, 'NAXIS', 0);
  if (naxis < 2) throw new Error('FITS: not a 2-D image');
  const width = num(cards, 'NAXIS1', 0);
  const height = num(cards, 'NAXIS2', 0);
  const bzero = num(cards, 'BZERO', 0);
  const bscale = num(cards, 'BSCALE', 1);
  const blank = cards.has('BLANK') ? num(cards, 'BLANK', NaN) : NaN;
  const bunit = cards.get('BUNIT') ?? '';
  const npix = width * height;
  if (!npix) throw new Error('FITS: empty image');

  const view = new DataView(buf, dataStart);
  const out = new Float32Array(npix);
  let min = Infinity, max = -Infinity;
  const bytesPer = Math.abs(bitpix) / 8;

  for (let i = 0; i < npix; i++) {
    const o = i * bytesPer;
    let raw: number;
    switch (bitpix) {
      case 8: raw = view.getUint8(o); break;
      case 16: raw = view.getInt16(o, false); break;
      case 32: raw = view.getInt32(o, false); break;
      case -32: raw = view.getFloat32(o, false); break;
      case -64: raw = view.getFloat64(o, false); break;
      default: throw new Error(`FITS: unsupported BITPIX ${bitpix}`);
    }
    let val: number;
    if ((bitpix > 0 && raw === blank) || (bitpix < 0 && !isFinite(raw))) {
      val = NaN;
    } else {
      val = bzero + bscale * raw;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    out[i] = val;
  }
  if (!isFinite(min)) { min = 0; max = 1; }

  const { z1, z2 } = zscale(out);

  // WCS (only if a recognizable celestial system is present)
  let wcs: FitsWcs | null = null;
  const ctype1 = cards.get('CTYPE1') ?? '';
  const ctype2 = cards.get('CTYPE2') ?? '';
  if (cards.has('CRVAL1') && cards.has('CRPIX1')) {
    let cd11 = num(cards, 'CD1_1', NaN);
    let cd12 = num(cards, 'CD1_2', NaN);
    let cd21 = num(cards, 'CD2_1', NaN);
    let cd22 = num(cards, 'CD2_2', NaN);
    if (!isFinite(cd11)) {
      // fall back to CDELT + CROTA2
      const cdelt1 = num(cards, 'CDELT1', 1);
      const cdelt2 = num(cards, 'CDELT2', 1);
      const crota2 = num(cards, 'CROTA2', 0) * DEG2RAD;
      cd11 = cdelt1 * Math.cos(crota2);
      cd12 = -cdelt2 * Math.sin(crota2);
      cd21 = cdelt1 * Math.sin(crota2);
      cd22 = cdelt2 * Math.cos(crota2);
    }
    wcs = {
      crpix1: num(cards, 'CRPIX1', 0), crpix2: num(cards, 'CRPIX2', 0),
      crval1: num(cards, 'CRVAL1', 0), crval2: num(cards, 'CRVAL2', 0),
      cd11, cd12, cd21, cd22, ctype1, ctype2,
    };
  }

  return { width, height, data: out, bunit, min, max, z1, z2, wcs };
}

/** Sample the physical value at integer pixel (x,y), 0-based with y measured from the TOP. */
export function pixelValue(img: FitsImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return NaN;
  // FITS rows run bottom→top; flip y so callers can use top-left image coords.
  const fy = img.height - 1 - y;
  return img.data[fy * img.width + x]!;
}

/**
 * Pixel (x,y) → world (RA, Dec) in degrees, via the TAN (gnomonic) projection.
 * x,y are 0-based with y from the TOP (screen order); converted to FITS 1-based internally.
 */
export function pixelToWorld(img: FitsImage, x: number, y: number): { ra: number; dec: number } | null {
  const w = img.wcs;
  if (!w) return null;
  const fi = x + 1; // FITS 1-based
  const fj = img.height - y; // flip to FITS bottom-origin, 1-based
  const dx = fi - w.crpix1;
  const dy = fj - w.crpix2;
  // intermediate world coords (degrees → radians)
  const xi = (w.cd11 * dx + w.cd12 * dy) * DEG2RAD;
  const eta = (w.cd21 * dx + w.cd22 * dy) * DEG2RAD;
  const ra0 = w.crval1 * DEG2RAD;
  const dec0 = w.crval2 * DEG2RAD;
  const r = Math.hypot(xi, eta);
  if (r === 0) return { ra: w.crval1, dec: w.crval2 };
  const c = Math.atan(r);
  const sinc = Math.sin(c), cosc = Math.cos(c);
  const dec = Math.asin(cosc * Math.sin(dec0) + (eta * sinc * Math.cos(dec0)) / r);
  const ra = ra0 + Math.atan2(xi * sinc, r * Math.cos(dec0) * cosc - eta * Math.sin(dec0) * sinc);
  let raDeg = ra * RAD2DEG;
  raDeg = ((raDeg % 360) + 360) % 360;
  return { ra: raDeg, dec: dec * RAD2DEG };
}

export type Stretch = 'linear' | 'log' | 'asinh' | 'sqrt';

/** Map a physical value to 0..255 for display, given limits and a scientific stretch. */
export function applyStretch(v: number, lo: number, hi: number, stretch: Stretch): number {
  if (!isFinite(v)) return 0;
  let t = (v - lo) / (hi - lo || 1);
  t = Math.min(1, Math.max(0, t));
  switch (stretch) {
    case 'log': t = Math.log10(1 + 9 * t); break; // log over [lo,hi]
    case 'sqrt': t = Math.sqrt(t); break;
    case 'asinh': t = Math.asinh(10 * t) / Math.asinh(10); break; // Lupton-style
    case 'linear': default: break;
  }
  return Math.round(t * 255);
}

/** Render a FITS image to an RGBA grayscale ImageData using zscale + the chosen stretch. */
export function renderToImageData(
  img: FitsImage,
  stretch: Stretch = 'asinh',
  lo = img.z1,
  hi = img.z2,
): ImageData {
  const { width, height } = img;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const fy = height - 1 - y; // flip to top-origin for display
    for (let x = 0; x < width; x++) {
      const v = img.data[fy * width + x]!;
      const g = applyStretch(v, lo, hi, stretch);
      const o = (y * width + x) * 4;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}
