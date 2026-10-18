import { describe, expect, it } from 'vitest';
import type { Day } from '../../src/lib/timelapse/time';
import {
  BULLETIN_11_URL,
  DENSITY_CAP_CHANGE_DAY,
  DENSITY_CAP_TABLE,
  FZP_EFFECTIVE_DAY,
  UNVERIFIED_DISTRICTS,
  densityCap,
  densityCapRule,
  isSpecNamedNoCap
} from '../lib/density-caps';

/** Square feet to square metres (international foot). */
const m2 = (sf: number): number => sf * 0.09290304;
const BEFORE: Day = DENSITY_CAP_CHANGE_DAY - 1;
const AFTER: Day = DENSITY_CAP_CHANGE_DAY;
const TODAY: Day = Date.UTC(2026, 9, 16) / 86400000;
const day = (y: number, m: number, d: number): Day => Date.UTC(y, m - 1, d) / 86400000;

describe('DENSITY_CAP_CHANGE_DAY', () => {
  it('is 2022-11-27 as a Day', () => {
    expect(DENSITY_CAP_CHANGE_DAY).toBe(Date.UTC(2022, 10, 27) / 86400000);
  });
});

describe('FZP_EFFECTIVE_DAY', () => {
  it('is 2026-01-12 as a Day', () => {
    expect(FZP_EFFECTIVE_DAY).toBe(Date.UTC(2026, 0, 12) / 86400000);
  });
});

describe('densityCap: spec §4.4 known answers', () => {
  it('RH-2 on 1,000 sf → 2 before and 4 after 2022-11-27', () => {
    expect(densityCap('RH-2', m2(1000), false, BEFORE)).toBe(2);
    expect(densityCap('RH-2', m2(1000), false, AFTER)).toBe(4);
  });

  it('RH-3 on 8,000 sf → 8 (3 as of right before 2022-11-27)', () => {
    expect(densityCap('RH-3', m2(8000), false, TODAY)).toBe(8);
    expect(densityCap('RH-3', m2(8000), false, AFTER)).toBe(8);
    expect(densityCap('RH-3', m2(8000), false, BEFORE)).toBe(3);
  });

  it('RM-1 on 3,229 sf → 4', () => {
    expect(densityCap('RM-1', m2(3229), false, TODAY)).toBe(4);
  });

  it('NC-3 on 6,000 sf outside R-4 → 10, inside R-4 → null', () => {
    expect(densityCap('NC-3', m2(6000), false, TODAY)).toBe(10);
    expect(densityCap('NC-3', m2(6000), true, TODAY)).toBeNull();
  });
});

describe('densityCap: one case per district', () => {
  it('RH-1(D): 1 per lot before (2021-010762PCA), at least 4 after', () => {
    expect(densityCap('RH-1(D)', m2(12000), false, BEFORE)).toBe(1);
    expect(densityCap('RH-1(D)', m2(2000), false, BEFORE)).toBe(1);
    expect(densityCap('RH-1(D)', m2(12000), false, AFTER)).toBe(4);
    expect(densityCap('RH-1(D)', m2(15000), false, TODAY)).toBe(4);
  });

  it('RH-1: 1 per lot as of right before, one per 3,000 sf and at least 4 after', () => {
    expect(densityCap('RH-1', m2(9000), false, BEFORE)).toBe(1);
    expect(densityCap('RH-1', m2(9000), false, AFTER)).toBe(4);
    expect(densityCap('RH-1', m2(15000), false, AFTER)).toBe(5);
    expect(densityCap('RH-1', m2(15000), false, day(2024, 6, 1))).toBe(5);
  });

  it('RH-1(S): 2 per lot before (with a small second unit), at least 4 after', () => {
    expect(densityCap('RH-1(S)', m2(3000), false, BEFORE)).toBe(2);
    expect(densityCap('RH-1(S)', m2(12000), false, BEFORE)).toBe(2);
    expect(densityCap('RH-1(S)', m2(3000), false, AFTER)).toBe(4);
  });

  it('RH-2 before 2022-11-27 is 2 as of right on any lot', () => {
    expect(densityCap('RH-2', m2(9000), false, BEFORE)).toBe(2);
    expect(densityCap('RH-2', m2(9000), false, AFTER)).toBe(6);
  });

  it('RM-2, RM-3, RM-4: one per 600, 400, 200 sf', () => {
    expect(densityCap('RM-2', m2(6000), false, TODAY)).toBe(10);
    expect(densityCap('RM-3', m2(4000), false, TODAY)).toBe(10);
    expect(densityCap('RM-4', m2(2000), false, TODAY)).toBe(10);
  });

  it('RM caps are the same before and after the change day', () => {
    expect(densityCap('RM-2', m2(6000), false, BEFORE)).toBe(10);
  });

  it('NC-1, NC-2, NC-S: one per 800 sf outside R-4', () => {
    expect(densityCap('NC-1', m2(2400), false, TODAY)).toBe(3);
    expect(densityCap('NC-2', m2(4000), false, TODAY)).toBe(5);
    expect(densityCap('NC-S', m2(8000), false, TODAY)).toBe(10);
  });

  it('NC-1, NC-2, NC-S inside R-4 → null', () => {
    for (const z of ['NC-1', 'NC-2', 'NC-S']) {
      expect(densityCap(z, m2(8000), true, TODAY)).toBeNull();
    }
  });

  it('an NC district inside R-4 before the change day takes the outside formula', () => {
    expect(densityCap('NC-3', m2(6000), true, BEFORE)).toBe(10);
  });

  it('the R-4 NC rule starts on FZP_EFFECTIVE_DAY (ruling C2)', () => {
    expect(densityCap('NC-3', m2(6000), true, day(2025, 6, 1))).toBe(10);
    // The panel's base cap day, min(lien_day, 2026-01-11), is the last day of the old rule.
    expect(densityCap('NC-3', m2(6000), true, FZP_EFFECTIVE_DAY - 1)).toBe(10);
    expect(densityCap('NC-3', m2(6000), true, day(2026, 1, 12))).toBeNull();
    expect(densityCap('NC-1', m2(3226), true, day(2026, 1, 11))).toBe(4);
    expect(densityCap('NC-1', m2(3226), true, day(2026, 10, 10))).toBeNull();
    expect(densityCap('NC-1', m2(3226), false, day(2026, 10, 10))).toBe(4);
  });

  it('R-4 does not lift RH or RM caps', () => {
    expect(densityCap('RH-2', m2(1000), true, TODAY)).toBe(4);
    expect(densityCap('RM-1', m2(3229), true, TODAY)).toBe(4);
  });

  it('a lot smaller than one per-area unit still gets the per-lot minimum', () => {
    expect(densityCap('RM-1', m2(500), false, TODAY)).toBe(1);
    expect(densityCap('NC-3', m2(100), false, TODAY)).toBe(1);
  });

  it('a degenerate lot area reads as 1 sf and stays total', () => {
    expect(densityCap('RM-1', Number.NaN, false, TODAY)).toBe(1);
    expect(densityCap('RH-2', -5, false, BEFORE)).toBe(2);
    expect(densityCap('RM-4', 0, false, TODAY)).toBe(1);
  });
});

describe('densityCap: uncapped and unknown codes', () => {
  it('NCT, NCT-3, NCD, UMU, C-3-G, P and null → null', () => {
    for (const z of ['NCT', 'NCT-1', 'NCT-2', 'NCT-3', 'NCD', 'UMU', 'C-3-G', 'P', null, '']) {
      expect(densityCap(z, m2(10000), false, TODAY)).toBeNull();
      expect(densityCap(z, m2(10000), false, BEFORE)).toBeNull();
    }
  });

  it('trims surrounding whitespace', () => {
    expect(densityCap(' RM-1 ', m2(3229), false, TODAY)).toBe(4);
  });
});

describe('densityCap: researched additions (partner rulings 2026-10-18, F9 research)', () => {
  const PERIODS: Day[] = [BEFORE, AFTER, day(2025, 6, 1), FZP_EFFECTIVE_DAY - 1, TODAY];

  it('C-2: the 1 per 800 sf floor in every period outside R-4 (sd.zoning.c2-floor-approx)', () => {
    for (const d of PERIODS) {
      expect(densityCap('C-2', m2(8000), false, d)).toBe(10);
      expect(densityCap('C-2', m2(500), false, d)).toBe(1);
    }
  });

  it('C-2 inside R-4: the floor up to 2026-01-11, no limit from FZP_EFFECTIVE_DAY', () => {
    expect(densityCap('C-2', m2(8000), true, BEFORE)).toBe(10);
    expect(densityCap('C-2', m2(8000), true, FZP_EFFECTIVE_DAY - 1)).toBe(10);
    expect(densityCap('C-2', m2(8000), true, FZP_EFFECTIVE_DAY)).toBeNull();
    expect(densityCap('C-2', m2(8000), true, TODAY)).toBeNull();
  });

  it('M-1: the 1 per 800 sf floor in every period, R-4 or not (sd.zoning.m1-floor-approx)', () => {
    for (const d of PERIODS) {
      for (const r4 of [false, true]) expect(densityCap('M-1', m2(4000), r4, d)).toBe(5);
    }
  });

  it('SALI: 0 in every period (residential not permitted)', () => {
    for (const d of PERIODS) {
      for (const r4 of [false, true]) expect(densityCap('SALI', m2(20000), r4, d)).toBe(0);
    }
  });

  it('the eight no-limit codes are explicit null table entries in every period', () => {
    for (const z of ['CMUO', 'MUG', 'MUO', 'MUR', 'RED', 'RED-MX', 'WMUG', 'RCD']) {
      expect(densityCapRule(z), z).toBe('table');
      for (const d of PERIODS) {
        for (const r4 of [false, true]) expect(densityCap(z, m2(8000), r4, d), z).toBeNull();
      }
    }
  });

  it('split codes now see the new entries', () => {
    // C-2 floor on 8,000 sf: 10; RH-3 after the change day: max(4, 3, 8) = 8.
    expect(densityCap('C-2|RH-3', m2(8000), false, AFTER)).toBe(10);
    expect(densityCap('C-2|M-1', m2(8000), false, AFTER)).toBe(10);
    // A no-limit component makes the split null; SALI's 0 loses to any positive component.
    expect(densityCap('MUR|RH-2', m2(8000), false, AFTER)).toBeNull();
    expect(densityCap('C-2|P', m2(8000), false, AFTER)).toBeNull();
  });
});

describe('densityCap: split codes (tier 4, most permissive)', () => {
  it('split RH-2|RM-1 takes the larger cap', () => {
    // RH-2 on 6,000 sf: max(4, 4) = 4; RM-1: floor(6000 / 800) = 7.
    expect(densityCap('RH-2|RM-1', m2(6000), false, TODAY)).toBe(7);
    // RH-2 on 1,000 sf after the change day: 4; RM-1: 1.
    expect(densityCap('RH-2|RM-1', m2(1000), false, TODAY)).toBe(4);
  });

  it('split RH-2|UMU is null', () => {
    expect(densityCap('RH-2|UMU', m2(6000), false, TODAY)).toBeNull();
  });

  it('split with a generic NC or empty component is null', () => {
    expect(densityCap('NC-3|NCD', m2(6000), false, TODAY)).toBeNull();
    expect(densityCap('RH-2|', m2(6000), false, TODAY)).toBeNull();
  });

  it('split NC-3|RC-4 is null (RC is uncapped in the table)', () => {
    expect(densityCap('NC-3|RC-4', m2(6000), false, TODAY)).toBeNull();
  });

  it('split components each see the R-4 flag', () => {
    expect(densityCap('NC-3|RM-1', m2(6000), true, TODAY)).toBeNull();
    expect(densityCap('NC-3|RM-1', m2(6000), false, TODAY)).toBe(10);
  });
});

describe('densityCapRule', () => {
  it('classifies every live code shape', () => {
    expect(densityCapRule(null)).toBe('none');
    expect(densityCapRule('')).toBe('none');
    expect(densityCapRule('  ')).toBe('none');
    expect(densityCapRule('RH-2')).toBe('table');
    expect(densityCapRule('NCT-3')).toBe('table');
    expect(densityCapRule('RH-2|RM-1')).toBe('split');
    expect(densityCapRule('NC-3|RC-4')).toBe('split');
    expect(densityCapRule('NCD')).toBe('generic-nc');
    expect(densityCapRule('NCT')).toBe('generic-nc');
    expect(densityCapRule('UMU')).toBe('unlisted');
    expect(densityCapRule('C-3-G')).toBe('unlisted');
  });
});

describe('isSpecNamedNoCap', () => {
  it('matches exactly the families spec 4.4 names as no cap', () => {
    const named = ['RTO-C', 'RTO-1', 'RTO-M', 'UMU', 'C-3-G', 'C-3-O(SD)', 'C-3-O', 'PDR-2'];
    for (const z of [...named, 'PDR-1-B', 'P', ' P ']) expect(isSpecNamedNoCap(z), z).toBe(true);
    const other = ['RC-4', 'C-2', 'P70-MU', 'PM-R', 'PPS-MU', 'M-1', 'MUG', 'RH-2', 'NCD', ''];
    for (const z of [...other, 'RH-2|RM-1']) expect(isSpecNamedNoCap(z), z).toBe(false);
    expect(isSpecNamedNoCap(null)).toBe(false);
  });
});

describe('DENSITY_CAP_TABLE provenance', () => {
  it('every entry has a section and an https url', () => {
    expect(DENSITY_CAP_TABLE.length).toBeGreaterThan(0);
    for (const e of DENSITY_CAP_TABLE) {
      expect(e.codes.length).toBeGreaterThan(0);
      expect(e.section).toMatch(/§/);
      expect(e.url).toMatch(/^https:\/\//);
      expect(['official', 'mirror']).toContain(e.verified);
    }
  });

  it('covers every spec §4.4 district and the researched additions exactly once', () => {
    const codes = DENSITY_CAP_TABLE.flatMap((e) => e.codes).sort();
    expect(codes).toEqual(
      [
        'RH-1(D)',
        'RH-1',
        'RH-1(S)',
        'RH-2',
        'RH-3',
        'RM-1',
        'RM-2',
        'RM-3',
        'RM-4',
        'NC-1',
        'NC-2',
        'NC-3',
        'NC-S',
        'NCT-1',
        'NCT-2',
        'NCT-3',
        // Partner rulings 2026-10-18 (F9 research): C-2, M-1, SALI and the explicit no-limit codes.
        'C-2',
        'M-1',
        'SALI',
        'CMUO',
        'MUG',
        'MUO',
        'MUR',
        'RED',
        'RED-MX',
        'WMUG',
        'RCD'
      ].sort()
    );
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('UNVERIFIED_DISTRICTS is exactly the mirror entries plus generic NCD and NCT', () => {
    const mirror = DENSITY_CAP_TABLE.filter((x) => x.verified === 'mirror').flatMap((e) => e.codes);
    expect([...UNVERIFIED_DISTRICTS].sort()).toEqual([...mirror, 'NCD', 'NCT'].sort());
    expect(new Set(UNVERIFIED_DISTRICTS).size).toBe(UNVERIFIED_DISTRICTS.length);
    // After the 2026-10-16 re-verification no table entry is mirror-only.
    expect(mirror).toEqual([]);
  });

  it('every table code resolves by rule table', () => {
    for (const c of DENSITY_CAP_TABLE.flatMap((e) => e.codes)) {
      expect(densityCapRule(c)).toBe('table');
    }
  });

  it('every entry cites a page-anchored official PDF or the code summary', () => {
    for (const e of DENSITY_CAP_TABLE) {
      expect(e.url, e.codes.join()).toMatch(
        /^https:\/\/sfbos\.archive\.sf\.gov\/.+\.pdf#page=\d+$/
      );
    }
  });

  it('BULLETIN_11_URL is the official sfplanning.org page', () => {
    expect(BULLETIN_11_URL).toMatch(/^https:\/\/sfplanning\.org\//);
  });
});
