import { describe, it, expect } from 'vitest';
import { abMagToMicroJy, abMagToNanoJy, nanoJyToAbMag } from './photometry';

describe('AB photometry conversions', () => {
  it('AB zero-points: 23.9 mag = 1 µJy, 31.4 mag = 1 nJy', () => {
    expect(abMagToMicroJy(23.9)).toBeCloseTo(1, 6);
    expect(abMagToNanoJy(31.4)).toBeCloseTo(1, 6);
  });

  it('a 5-mag (100×) step is a 100× flux ratio', () => {
    expect(abMagToMicroJy(18.9) / abMagToMicroJy(23.9)).toBeCloseTo(100, 4);
  });

  it('mag ↔ nJy round-trips', () => {
    for (const m of [16, 18.5, 20.3, 22]) {
      expect(nanoJyToAbMag(abMagToNanoJy(m))).toBeCloseTo(m, 8);
    }
  });

  it('a 0 AB mag source is ≈3631 Jy', () => {
    expect(abMagToMicroJy(0) / 3631e6).toBeCloseTo(1, 2); // within the 23.9 zero-point rounding
  });
});
