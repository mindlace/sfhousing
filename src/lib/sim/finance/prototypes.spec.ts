import { describe, expect, it } from 'vitest';
import type { ProjectKind } from '../../timelapse/types';
import {
  AFFORDABLE,
  LAND_PER_HOME,
  PROTOTYPES,
  PROTOTYPE_BINNING,
  costPerHome,
  prototypeFor,
  uncoveredPerHome
} from './prototypes';

const TABLE = [
  ['A', 5, 45, 729_700, 177_000],
  ['B', 8, 130, 736_700, 152_000],
  ['C', 13, 227, 857_700, 206_000],
  ['D', 24, 341, 918_700, 292_000],
  ['E', 4, 13, 929_700, 353_000]
] as const;
const UNCOVERED = [242_000, 217_000, 271_000, 357_000, 418_000];

describe('PROTOTYPES', () => {
  it('equals the spec table', () => {
    expect(
      PROTOTYPES.map((p) => [p.id, p.stories, p.homes, p.costPerHome, p.shortfallPerHome])
    ).toEqual(TABLE.map((r) => [...r]));
  });
  it('is frozen, entry by entry', () => {
    expect(Object.isFrozen(PROTOTYPES)).toBe(true);
    for (const p of PROTOTYPES) expect(Object.isFrozen(p)).toBe(true);
  });
  it('has tier 1 provenance naming the pages and the binning', () => {
    for (const p of PROTOTYPES) {
      expect(p.provenance.tier).toBe(1);
      expect(p.provenance.label).toBe(`Controller feasibility prototype ${p.id}`);
      expect(p.provenance.method).toContain('p. 4');
      expect(p.provenance.method).toContain('p. 11');
      expect(p.provenance.method.endsWith('(PROTOTYPE_BINNING).')).toBe(true);
      expect(p.provenance.method).toContain('accessed 2026-11-09');
      expect(p.provenance.sources.length).toBeGreaterThan(0);
    }
  });
  it('has a tier 4 binning', () => {
    expect(PROTOTYPE_BINNING.value).toBeNull();
    expect(PROTOTYPE_BINNING.provenance.tier).toBe(4);
  });
});

describe('prototypeFor', () => {
  const [A, B, C, D, E] = PROTOTYPES;
  it.each([
    [5, 45, A],
    [6, 25, A],
    [0, 25, A],
    [7, 25, B],
    [10, 100, B],
    [11, 100, C],
    [18, 300, C],
    [19, 300, D],
    [40, 24, E],
    [0, 0, E],
    [1, 1, E],
    [-3, 100, A],
    [30, -5, E]
  ])('(%s, %s)', (s, h, want) => {
    expect(prototypeFor(s, h)).toBe(want);
  });
  it('returns the same object', () => {
    expect(prototypeFor(8, 130)).toBe(PROTOTYPES[1]);
    expect(B).toBe(PROTOTYPES[1]);
    expect(C.id).toBe('C');
    expect(D.id).toBe('D');
  });
  it('throws on non-finite input', () => {
    expect(() => prototypeFor(NaN, 30)).toThrow(
      new RangeError('prototypeFor needs finite stories and homes; got NaN, 30')
    );
    expect(() => prototypeFor(5, Infinity)).toThrow(
      new RangeError('prototypeFor needs finite stories and homes; got 5, Infinity')
    );
  });
});

describe('costs', () => {
  it('matches the results table for both kinds', () => {
    PROTOTYPES.forEach((p, i) => {
      expect(uncoveredPerHome('market', p)).toBe(UNCOVERED[i]);
      expect(uncoveredPerHome('affordable', p)).toBe(861_525);
      expect(costPerHome('market', p)).toBe(p.costPerHome);
      expect(costPerHome('affordable', p)).toBe(954_127);
    });
  });
  it('has sourced land and affordable constants', () => {
    expect(LAND_PER_HOME.value).toBe(65_000);
    expect(LAND_PER_HOME.provenance.tier).toBe(2);
    expect(AFFORDABLE.value).toEqual({ costPerHome: 954_127, ownPerHome: 92_602 });
    expect(AFFORDABLE.provenance.tier).toBe(1);
  });
  it('throws on an unknown kind', () => {
    const B = PROTOTYPES[1];
    expect(() => uncoveredPerHome('rent' as ProjectKind, B)).toThrow(
      new RangeError('unknown project kind: rent')
    );
    expect(() => costPerHome('rent' as ProjectKind, B)).toThrow(
      new RangeError('unknown project kind: rent')
    );
  });
});
