import { describe, it, expect } from 'vitest';
import { searchSuggest, SUGGEST_INDEX } from './searchIndex';

describe('searchSuggest', () => {
  it('ranks an exact Messier id first, with its common name', () => {
    const r = searchSuggest('M31');
    expect(r[0]!.query).toBe('M31');
    expect(r[0]!.label.toLowerCase()).toContain('andromeda');
  });

  it('matches a common name by substring', () => {
    expect(searchSuggest('andromeda').some((s) => s.query === 'M31')).toBe(true);
    expect(searchSuggest('whirlpool').some((s) => s.query === 'M51')).toBe(true);
  });

  it('matches a bright star and a planet by prefix', () => {
    expect(searchSuggest('veg').some((s) => s.query === 'Vega')).toBe(true);
    expect(searchSuggest('mar').some((s) => s.query === 'Mars')).toBe(true);
  });

  it('matches a famous non-Messier object by prefix', () => {
    expect(searchSuggest('NGC 65').some((s) => s.query === 'NGC 6543')).toBe(true);
  });

  it('returns nothing for empty input and respects the limit', () => {
    expect(searchSuggest('')).toHaveLength(0);
    expect(searchSuggest('   ')).toHaveLength(0);
    expect(searchSuggest('M', 5).length).toBeLessThanOrEqual(5);
  });

  it('indexes all 110 Messier objects', () => {
    expect(SUGGEST_INDEX.filter((s) => /^M\d+$/.test(s.query)).length).toBe(110);
  });

  it('covers the long tail: full NGC + IC catalogues', () => {
    expect(SUGGEST_INDEX.some((s) => s.query === 'NGC 7000')).toBe(true);
    expect(SUGGEST_INDEX.some((s) => s.query === 'NGC 7840')).toBe(true);
    expect(SUGGEST_INDEX.some((s) => s.query === 'IC 5386')).toBe(true);
    expect(searchSuggest('NGC 1300').some((s) => s.query === 'NGC 1300')).toBe(true);
  });

  it('ranks a named object above bare catalogue numbers on a (non-exact) prefix', () => {
    // For "NGC 65": "NGC 65" itself is the exact match, but the named "NGC 6543 — Cat's Eye" must
    // rank ahead of bare numeric entries like "NGC 650".
    const r = searchSuggest('NGC 65');
    const iNamed = r.findIndex((s) => s.query === 'NGC 6543');
    const iBare = r.findIndex((s) => s.query === 'NGC 650');
    expect(iNamed).toBeGreaterThanOrEqual(0);
    expect(iBare === -1 || iNamed < iBare).toBe(true);
  });

  it('does not duplicate a famous NGC across the named + generated lists', () => {
    expect(SUGGEST_INDEX.filter((s) => s.query === 'NGC 6543').length).toBe(1);
  });
});
