import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMultiphase, type MultiphaseFile } from '../../enrichment/schema';

const LIVE = fileURLToPath(new URL('../../enrichment/multiphase.json', import.meta.url));

/** The 24 PRX rows in 6jgi-cpb4 minus the three 2025-0094xx rows with 0 units (curation, 2026-10-16). */
const PRX_WITH_UNITS = [
  '2006.1308PRX',
  '2007.0168PRX',
  '2007.0903PRX',
  '2007.0946PRX',
  '2010.0305PRX',
  '2010.0515PRX',
  '2013.0196PRX',
  '2013.0208PRX',
  '2014-001272PRX',
  '2014.1370PRX',
  '2017-011878PRX',
  '2018-007883PRX',
  '2018-011363PRX',
  '2023-007809PRX',
  '2023-007906PRX',
  '2023-007909PRX',
  '2023-007911PRX',
  '2023-007912PRX',
  '2023-010914PRX',
  '2023-010956PRX',
  '2026-000246PRX'
];

/** Latest day a fact may claim to be retrieved: the last day of curation (round 2). */
const CURATED_BY = '2026-10-17';

function live(): MultiphaseFile {
  return parseMultiphase(JSON.parse(readFileSync(LIVE, 'utf8')));
}

describe('pipeline/enrichment/multiphase.json (curated)', () => {
  it('parses', () => {
    expect(live().projects.length).toBeGreaterThan(0);
  });

  it('names exactly the PRX case numbers that have units', () => {
    const caseNos = live()
      .projects.map((p) => p.caseNo)
      .sort();
    expect(caseNos).toEqual([...PRX_WITH_UNITS].sort());
  });

  it('enriches Treasure Island, Candlestick and Parkmerced with a schedule and a remaining phase', () => {
    const f = live();
    for (const caseNo of ['2007.0946PRX', '2007.0903PRX', '2014.1370PRX']) {
      const e = f.projects.find((p) => p.caseNo === caseNo);
      expect(e?.schedule, caseNo).not.toBeNull();
      expect(
        e?.phases.filter((p) => p.status === 'remaining').length,
        caseNo
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('records the searched URLs for every entry without a schedule', () => {
    const nulls = live().projects.filter((p) => p.schedule === null);
    expect(nulls.length).toBeGreaterThan(0);
    for (const e of nulls) {
      expect(e.searched.length, e.caseNo).toBeGreaterThan(0);
      expect(e.phases, e.caseNo).toEqual([]);
    }
  });

  it('has no retrieved date after the curation date', () => {
    const dates: string[] = [];
    for (const e of live().projects) {
      if (e.schedule) dates.push(e.schedule.retrieved);
      dates.push(...e.searched.map((s) => s.retrieved));
      for (const ph of e.phases) {
        for (const fact of Object.values(ph.facts)) if (fact) dates.push(fact.retrieved);
      }
    }
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.filter((d) => d > CURATED_BY)).toEqual([]);
  });
});
