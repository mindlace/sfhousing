// Current law per lot (pipeline/lib/current-law.ts): §207.11 (Ord. 082-26 §5) over FZP.
import { describe, expect, it } from 'vitest';
import { FILL_LEVELS, fillStories } from '../../src/lib/data/scenario-codec';
import { currentLawRow, envelopeRow, s207Row } from '../lib/current-law';
import { unitsFor } from '../lib/sb79';

const ACRE = 4046.86;
const grossAt = (stories: number) => stories * 10;
type Input = Parameters<typeof s207Row>[0];
/** An RH lot at 30 ft with cap 2 on 1 acre, tier 1 half band: every condition holds. */
const BASE: Input = {
  best: { tier: 1, band: 3 },
  eligible: true,
  principallyResidential: true,
  r4: false,
  historic: 'C',
  exempt: false,
  fzpStories: 3,
  fzpHeightFt: 30,
  fzpCap: 2,
  lotAreaM2: ACRE,
  existingUnits: 0,
  grossAt
};
const fzpOf = (a: Input) =>
  envelopeRow({
    stories: a.fzpStories,
    cap: a.fzpCap,
    eligible: a.eligible,
    existingUnits: a.existingUnits,
    grossAt: a.grossAt
  });

describe('s207Row', () => {
  it('applies to an RH lot at 30 ft: 40 ft (4 stories) and half the SB 79 density', () => {
    const r = s207Row(BASE);
    expect(unitsFor(100, ACRE, 0.5, 'round')).toBe(50);
    expect(r.status).toBe('applies');
    expect(r.stories).toBe(4);
    expect(r.cap).toBe(50);
    expect(r.yield).toEqual(FILL_LEVELS.map((f) => Math.min(50, fillStories(f, 4) * 10)));
    expect(r.hostable).toBe(true);
  });

  it('keeps FZP stories at or above 40 ft and a larger FZP cap', () => {
    const tall = s207Row({ ...BASE, fzpStories: 6, fzpHeightFt: 65, fzpCap: 10 });
    expect(tall.status).toBe('applies');
    expect(tall.stories).toBe(6);
    expect(tall.cap).toBe(50);
  });

  it('a null cap never qualifies (b)(8)', () => {
    expect(s207Row({ ...BASE, fzpCap: null, fzpHeightFt: 30 }).status).toBe('meets-minimum');
    expect(s207Row({ ...BASE, fzpCap: null, fzpHeightFt: 40 }).status).toBe('no-limit');
  });
  it('reads the Local Program height on a Local Program lot', () => {
    // base 30 ft, LP 65 ft, uncapped: (b)(3) fails on the LP height
    expect(s207Row({ ...BASE, fzpCap: null, fzpHeightFt: 65 }).status).toBe('no-limit');
  });

  const cases: [string, Partial<Input>][] = [
    ['outside', { best: null }],
    ['not-eligible', { eligible: false }],
    ['exempt', { exempt: true }],
    ['not-residential', { principallyResidential: false }],
    ['no-limit', { fzpCap: null, fzpHeightFt: 40, fzpStories: 4 }],
    ['r4', { r4: true }],
    ['historic', { historic: 'A*' }],
    ['meets-minimum', { fzpCap: 50 }]
  ];
  for (const [status, change] of cases)
    it(`is ${status} when only that condition fails, and returns the FZP row`, () => {
      const a = { ...BASE, ...change };
      const r = s207Row(a);
      expect(r.status).toBe(status);
      expect(r).toEqual({ status, ...fzpOf(a) });
    });

  it('needs the full Planning minimum for (b)(8): one unit short applies', () => {
    expect(s207Row({ ...BASE, fzpCap: 49 }).status).toBe('applies');
    // Historic A (not A*) is not a (b)(7) designation.
    expect(s207Row({ ...BASE, historic: 'A' }).status).toBe('applies');
  });

  it('is exempt inside the TOD zone, with the FZP row', () => {
    const r = s207Row({ ...BASE, best: { tier: 1, band: 1 }, exempt: true });
    expect(r.status).toBe('exempt');
    expect(r.stories).toBe(3);
    expect(r.cap).toBe(2);
    expect(r.yield).toEqual(fzpOf(BASE).yield);
    expect(r.hostable).toBe(true);
  });
});

describe('currentLawRow', () => {
  const fzp = { stories: 3, cap: 2, yield: [1, 2, 2, 2, 2], hostable: true };
  const s207 = (top: number, hostable = true) => ({
    status: 'applies' as const,
    stories: 4,
    cap: 50,
    yield: [1, 2, 3, 4, top],
    hostable
  });
  it('takes §207.11 only with a larger hostable top', () => {
    expect(currentLawRow(fzp, s207(3))).toEqual({
      stories: 4,
      cap: 50,
      yield: [1, 2, 3, 4, 3],
      hostable: true,
      fromS207: true
    });
    expect(currentLawRow(fzp, s207(2))).toEqual({ ...fzp, fromS207: false });
    expect(currentLawRow(fzp, s207(9, false))).toEqual({ ...fzp, fromS207: false });
  });
  it('keeps FZP when §207.11 does not apply', () => {
    const exempt = { ...s207(9), status: 'exempt' as const };
    expect(currentLawRow(fzp, exempt)).toEqual({ ...fzp, fromS207: false });
  });
});
