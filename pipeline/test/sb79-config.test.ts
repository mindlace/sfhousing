import { describe, expect, it } from 'vitest';
import {
  BAND_MAX_M,
  CURRENT_LAW_RULE,
  HF_TPD,
  MIN_UNITS,
  S207,
  STANDARDS,
  STANDARDS_CITE,
  VHF_TPD,
  ZONE_CLASS_RULES
} from '../sb79-config';

describe('sb79-config', () => {
  it('pins SB 79 Table 1', () => {
    expect(STANDARDS[1][1]).toEqual({ heightFt: 95, duPerAcre: 160, residentialFar: 4.5 });
    expect(STANDARDS[1][2]).toEqual({ heightFt: 75, duPerAcre: 120, residentialFar: 3.5 });
    expect(STANDARDS[1][3]).toEqual({ heightFt: 65, duPerAcre: 100, residentialFar: 3.0 });
    expect(STANDARDS[2][1]).toEqual({ heightFt: 85, duPerAcre: 140, residentialFar: 4.0 });
    expect(STANDARDS[2][2]).toEqual({ heightFt: 65, duPerAcre: 100, residentialFar: 3.0 });
    expect(STANDARDS[2][3]).toEqual({ heightFt: 55, duPerAcre: 80, residentialFar: 2.5 });
    expect(BAND_MAX_M).toEqual({ 1: 60.96, 2: 402.336, 3: 804.672 });
    expect([VHF_TPD, HF_TPD, MIN_UNITS]).toEqual([72, 48, 5]);
    expect(S207.heightFloorFt).toBe(40);
    expect(S207.densityShare).toBe(0.5);
    expect(CURRENT_LAW_RULE).toBe('fzp+s207.11');
  });

  it('cites every rule with a tier', () => {
    for (const r of ZONE_CLASS_RULES) expect(r.cite.source.length).toBeGreaterThan(0);
    expect(STANDARDS_CITE.tier).toBeLessThanOrEqual(1);
    expect(S207.cite.tier).toBeLessThanOrEqual(1);
  });

  it('maps each sample SF use district to exactly one rule', () => {
    for (const code of ['RH-1', 'RM-1', 'NCT', 'NC-1', 'C-3-O', 'PDR-1-G', 'P', 'SALI'])
      expect(ZONE_CLASS_RULES.filter((r) => r.pattern.test(code))).toHaveLength(1);
  });
});
