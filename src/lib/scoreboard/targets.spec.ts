import { describe, expect, it } from 'vitest';
import { M1_TARGETS } from './targets';

const PRIMER =
  'https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/RHNA-Primer.pdf';

describe('M1_TARGETS', () => {
  it('registers rhna then rhna-buffer, in that order', () => {
    expect(M1_TARGETS.map((t) => t.id)).toEqual(['rhna', 'rhna-buffer']);
  });

  it('has the spec §4.2 labels, units and sources', () => {
    expect(M1_TARGETS[0]).toEqual({
      id: 'rhna',
      label: 'RHNA 2023–2031',
      units: 82069,
      source: { label: 'SF Planning, RHNA Primer', url: PRIMER }
    });
    expect(M1_TARGETS[1]).toEqual({
      id: 'rhna-buffer',
      label: 'RHNA + 15% buffer',
      units: 94379,
      source: { label: 'SF Planning, RHNA Primer', url: PRIMER }
    });
  });

  it('buffer units equal floor(82069 × 1.15)', () => {
    expect(M1_TARGETS[1].units).toBe(Math.floor(82069 * 1.15));
  });

  it('never sets range in M1', () => {
    for (const t of M1_TARGETS) expect(t.range).toBeUndefined();
  });

  it('is deep-frozen so no consumer can mutate the registry', () => {
    expect(Object.isFrozen(M1_TARGETS)).toBe(true);
    for (const t of M1_TARGETS) {
      expect(Object.isFrozen(t)).toBe(true);
      expect(Object.isFrozen(t.source)).toBe(true);
    }
  });
});
