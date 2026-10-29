import { describe, expect, it } from 'vitest';
import {
  BAND_MAX_M,
  CURRENT_LAW_RULE,
  HF_TPD,
  MIN_UNITS,
  MUNI_TIER2_CITE,
  MUNI_TIER2_STOP_IDS,
  S207,
  STANDARDS,
  STANDARDS_CITE,
  UNITS_ROUNDING,
  UNSOURCED,
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

  it('reads §207.11(b)(8) as half the band density (Planning memo), not 30 du/ac', () => {
    expect(S207.minDensityDuPerAcre(1, 1)).toBe(80);
    expect(S207.minDensityDuPerAcre(1, 3)).toBe(50);
    expect(S207.minDensityDuPerAcre(2, 2)).toBe(50);
    expect(S207.minDensityDuPerAcre(2, 3)).toBe(40);
    expect(S207.minDensityCite.tier).toBe(1);
    expect(S207.minDensityCite.url).toContain('legistar');
    expect(UNSOURCED.some((u) => u.includes('30 du/ac'))).toBe(true);
  });

  it('rounds SB 79 up and the §207.11 cap half up', () => {
    expect(UNITS_ROUNDING).toBe('ceil');
    expect(S207.rounding).toBe('round');
    expect(S207.roundingCite.tier).toBe(1);
  });

  it("lists MTC's current Muni Tier 2 stops as GTFS ids, without planned stops", () => {
    expect(MUNI_TIER2_STOP_IDS.size).toBe(438);
    for (const id of MUNI_TIER2_STOP_IDS) expect(id).toMatch(/^muni:\d+$/);
    // MTC stop_code 18088 / 14263 / 15552 -> GTFS stop_id 8088 (Van Ness BRT), 4263 (Geary 38),
    // 5552 (Mission 14).
    for (const id of ['muni:8088', 'muni:8105', 'muni:4263', 'muni:5552'])
      expect(MUNI_TIER2_STOP_IDS.has(id)).toBe(true);
    // Not the stop_code form, and not MTC's tod_tier "0" row (stop_code 13885).
    expect(MUNI_TIER2_STOP_IDS.has('muni:18088')).toBe(false);
    expect(MUNI_TIER2_STOP_IDS.has('muni:3885')).toBe(false);
    expect(MUNI_TIER2_CITE.url).toContain('mtc_sb79_tod_stops');
    expect(MUNI_TIER2_CITE.asOf).toBe('2026-07');
  });

  it('notes the accepted tier 2–3 principallyResidential values', () => {
    expect(UNSOURCED.some((u) => u.includes('principallyResidential'))).toBe(true);
  });
});
