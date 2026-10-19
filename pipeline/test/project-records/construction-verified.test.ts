// pipeline/enrichment/construction-verified.json schema (spec 4.6, Ruling C3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ConstructionVerifiedFormatError,
  parseConstructionVerified
} from '../../enrichment/construction-schema';

const LIVE = fileURLToPath(new URL('../../enrichment/construction-verified.json', import.meta.url));
const MINI = fileURLToPath(
  new URL('../fixtures/mini/enrichment/construction-verified.json', import.meta.url)
);

const ok = {
  schema: 1,
  projects: [
    {
      id: 'BP:8203602',
      verdict: 'dead',
      checked: '2026-10-01',
      source: 'partner imagery check'
    },
    {
      id: 'PRJ:2014.1246',
      verdict: 'complete',
      checked: '2026-10-01',
      source: 'partner imagery check',
      completeDay: '2019-01-01',
      note: 'building stands'
    },
    { id: 'PRJ:2016-012218PRJ', verdict: 'unknown', checked: '2026-10-01', source: 'x' }
  ]
};

const bad = (over: (f: typeof ok) => unknown) => () =>
  parseConstructionVerified(over(structuredClone(ok)));

describe('parseConstructionVerified', () => {
  it('accepts a valid file', () => {
    expect(parseConstructionVerified(ok)).toEqual(ok);
  });

  it('the committed live file and the fixture copy parse (sorted, unique ids)', () => {
    const live = parseConstructionVerified(JSON.parse(readFileSync(LIVE, 'utf8')));
    expect(live.schema).toBe(1);
    const ids = live.projects.map((p) => p.id);
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(parseConstructionVerified(JSON.parse(readFileSync(MINI, 'utf8'))).schema).toBe(1);
  });

  it('rejects a wrong schema, an unknown verdict, a bad date and an unknown key', () => {
    expect(bad((f) => ({ ...f, schema: 2 }))).toThrow(ConstructionVerifiedFormatError);
    expect(
      bad((f) => {
        f.projects[0].verdict = 'gone';
        return f;
      })
    ).toThrow(/verdict/);
    expect(
      bad((f) => {
        f.projects[0].checked = '2026-02-30';
        return f;
      })
    ).toThrow(/real calendar date/);
    expect(
      bad((f) => {
        (f.projects[0] as Record<string, unknown>).extra = 1;
        return f;
      })
    ).toThrow(ConstructionVerifiedFormatError);
  });

  it('completeDay is required for complete, only allowed for complete, not after checked', () => {
    expect(
      bad((f) => {
        delete f.projects[1].completeDay;
        return f;
      })
    ).toThrow(/completeDay is required/);
    expect(
      bad((f) => {
        (f.projects[0] as Record<string, unknown>).completeDay = '2020-01-01';
        return f;
      })
    ).toThrow(/only allowed/);
    expect(
      bad((f) => {
        f.projects[1].completeDay = '2026-10-02';
        return f;
      })
    ).toThrow(/after checked/);
  });

  it('ids are unique and sorted', () => {
    expect(
      bad((f) => {
        f.projects[1].id = 'BP:8203602';
        return f;
      })
    ).toThrow(/duplicate id/);
    expect(
      bad((f) => {
        f.projects.reverse();
        return f;
      })
    ).toThrow(/not sorted/);
  });
});
