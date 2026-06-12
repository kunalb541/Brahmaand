import { describe, it, expect } from 'vitest';
import { parseFits, pixelValue, pixelToWorld } from './fits';

/** Build a valid single-HDU 2-D FITS buffer (BITPIX -32) with a TAN WCS and data[i] = i. */
function makeFits(): ArrayBuffer {
  const W = 4, H = 3;
  const cards: string[] = [];
  const card = (k: string, v: string) => cards.push((k.padEnd(8) + '= ' + v).padEnd(80).slice(0, 80));
  card('SIMPLE', 'T');
  card('BITPIX', '-32');
  card('NAXIS', '2');
  card('NAXIS1', String(W));
  card('NAXIS2', String(H));
  card('CRPIX1', '2.0');
  card('CRPIX2', '2.0');
  card('CRVAL1', '150.0');
  card('CRVAL2', '2.0');
  card('CD1_1', '-0.0002777777778'); // 1 arcsec/pixel
  card('CD1_2', '0.0');
  card('CD2_1', '0.0');
  card('CD2_2', '0.0002777777778');
  card('CTYPE1', "'RA---TAN'");
  card('CTYPE2', "'DEC--TAN'");
  cards.push('END'.padEnd(80));

  const headerBlocks = Math.ceil(cards.length / 36);
  const headerBytes = headerBlocks * 2880;
  const dataBytes = W * H * 4;
  const totalBlocks = headerBlocks + Math.ceil(dataBytes / 2880);
  const buf = new ArrayBuffer(totalBlocks * 2880);
  const bytes = new Uint8Array(buf);
  // write header (space-padded)
  bytes.fill(0x20, 0, headerBytes);
  let o = 0;
  for (const c of cards) {
    for (let k = 0; k < 80; k++) bytes[o + k] = c.charCodeAt(k);
    o += 80;
  }
  // write data: big-endian float32, data[i] = i
  const dv = new DataView(buf, headerBytes);
  for (let i = 0; i < W * H; i++) dv.setFloat32(i * 4, i, false);
  return buf;
}

describe('FITS reader', () => {
  const img = parseFits(makeFits());

  it('parses dimensions and physical range', () => {
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.min).toBe(0);
    expect(img.max).toBe(11);
  });

  it('reads true pixel values (FITS bottom-origin → top-origin flip)', () => {
    // data[i] = i, row-major from bottom row. top-left (y=0) is the last (top) row.
    expect(pixelValue(img, 0, 2)).toBe(0); // bottom-left
    expect(pixelValue(img, 0, 0)).toBe(8); // top-left
    expect(pixelValue(img, 3, 0)).toBe(11); // top-right
    expect(pixelValue(img, 99, 0)).toBeNaN(); // out of bounds
  });

  it('maps the reference pixel to CRVAL via TAN WCS', () => {
    // CRPIX (2,2) 1-based → top-origin (x=1, y=H-2=1)
    const w = pixelToWorld(img, 1, 1)!;
    expect(w.ra).toBeCloseTo(150.0, 6);
    expect(w.dec).toBeCloseTo(2.0, 6);
  });

  it('moves ~1 arcsec/pixel in Dec', () => {
    const a = pixelToWorld(img, 1, 1)!;
    const b = pixelToWorld(img, 1, 0)!; // one pixel up (north)
    expect(Math.abs((b.dec - a.dec) * 3600)).toBeCloseTo(1.0, 2); // ~1 arcsec
  });
});
