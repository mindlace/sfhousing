import { describe, expect, it } from 'vitest';
import { DATASF } from '../../sources/datasf';
import type { Lock } from '../../lib/lock';
import {
  AS_OF_SOURCE_IDS,
  asOfFromLock,
  dayOf,
  docKind,
  isoOf,
  num,
  parseAll,
  splitPermits
} from '../../project-records/parse';
import {
  DATASET,
  PROJECT_SOURCE_IDS,
  type ProjectSourceId,
  type RawRow
} from '../../project-records/types';

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 864e5;
const ASOF = day(2026, 10, 16);

function raw(over: Partial<Record<ProjectSourceId, RawRow[]>> = {}) {
  const out = {} as Record<ProjectSourceId, RawRow[]>;
  for (const id of PROJECT_SOURCE_IDS) out[id] = over[id] ?? [];
  return out;
}

describe('source ids', () => {
  it('lists the eight ids in order and maps them to the locked DataSF datasets', () => {
    expect([...PROJECT_SOURCE_IDS]).toEqual([
      'datasf-permits-newcon',
      'datasf-permits-named',
      'datasf-planning-projects',
      'datasf-planning-records',
      'datasf-planning-review',
      'datasf-unit-completions',
      'datasf-housing-production',
      'datasf-dev-pipeline'
    ]);
    for (const id of PROJECT_SOURCE_IDS) expect(DATASET[id]).toBe(DATASF[id].dataset);
  });
});

describe('named unit-adding permits (Ruling L1)', () => {
  const named = (n: string, extra: RawRow = {}): RawRow => ({
    permit_number: n,
    permit_type: '3',
    block: '3512',
    lot: '001',
    status: 'issued',
    proposed_units: '4.0',
    existing_units: '1.0',
    ...extra
  });

  it('keeps a type 3/8 permit only when a PRJ names it; the newcon row wins on overlap', () => {
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [
          { permit_number: 'N1', permit_type: '2', status: 'filed', proposed_units: '20.0' }
        ],
        'datasf-permits-named': [
          named('A1'),
          named('A2', { permit_type: '8' }),
          named('ADU'),
          named('N1', { proposed_units: '99.0' })
        ],
        'datasf-planning-projects': [
          { record_id: '2019-000001PRJ', building_permits: 'A1, N1' },
          { record_id: '2020-000002PRJ', building_permits: 'A2' }
        ]
      }),
      ASOF
    );
    expect([...p.permits.keys()]).toEqual(['A1', 'A2', 'N1']);
    expect(p.permits.get('A1')).toMatchObject({ type: '3', proposedUnits: 4, existingUnits: 1 });
    expect(p.permits.get('A2')?.type).toBe('8');
    // N1 is in both sources: the new-construction row is used.
    expect(p.permits.get('N1')).toMatchObject({ type: '2', proposedUnits: 20 });
    expect(p.counts['parse.named.kept']).toBe(2);
    expect(p.counts['parse.named.unnamed']).toBe(1);
    expect(p.counts['parse.named.inNewcon']).toBe(1);
  });

  it('reads no date of a dropped named permit (pr.date.valid-range counts only kept ones)', () => {
    const p = parseAll(
      raw({
        'datasf-permits-named': [named('ADU', { filed_date: '1909-06-02T00:00:00.000' })]
      }),
      ASOF
    );
    expect(p.permits.size).toBe(0);
    expect(p.dates).toEqual({ of: 0, fired: 0, sample: [] });
  });
});

describe('dayOf', () => {
  it('takes the leading date of a floating timestamp', () => {
    expect(dayOf('2019-06-01T10:37:18.000', ASOF)).toBe(18048);
    expect(dayOf('2019-06-01', ASOF)).toBe(day(2019, 6, 1));
  });
  it('clips junk dates and values outside [0, asOf]', () => {
    expect(dayOf('1909-06-02T00:00:00.000', ASOF)).toBeNull();
    expect(dayOf('2205-03-13T00:00:00.000', ASOF)).toBeNull();
    expect(dayOf('2026-10-17T00:00:00.000', ASOF)).toBeNull();
    expect(dayOf('2026-10-16T00:00:00.000', ASOF)).toBe(ASOF);
    expect(dayOf('1970-01-01', ASOF)).toBe(0);
  });
  it('rejects non-dates', () => {
    expect(dayOf(undefined, ASOF)).toBeNull();
    expect(dayOf(null, ASOF)).toBeNull();
    expect(dayOf('', ASOF)).toBeNull();
    expect(dayOf('soon', ASOF)).toBeNull();
    expect(dayOf('2019-02-31', ASOF)).toBeNull();
    expect(dayOf(20190601, ASOF)).toBeNull();
  });
  it('isoOf inverts dayOf', () => {
    expect(isoOf(18048)).toBe('2019-06-01');
    expect(isoOf(ASOF)).toBe('2026-10-16');
  });
});

describe('scalars', () => {
  it('splitPermits splits on commas, semicolons and whitespace', () => {
    expect(splitPermits('202604229887, 202610139344;201906010001 x')).toEqual([
      '202604229887',
      '202610139344',
      '201906010001',
      'x'
    ]);
    expect(splitPermits(undefined)).toEqual([]);
    expect(splitPermits(' , ;')).toEqual([]);
  });
  it('docKind is case-insensitive', () => {
    expect(docKind('CFc')).toBe('CFC');
    expect(docKind('CFC')).toBe('CFC');
    expect(docKind('Initial TCO')).toBe('TCO');
    expect(docKind('Amended TCO')).toBe('TCO');
    expect(docKind('other')).toBeNull();
    expect(docKind(undefined)).toBeNull();
  });
  it('num parses SODA number strings', () => {
    expect(num('12')).toBe(12);
    expect(num('-3.5')).toBe(-3.5);
    expect(num(7)).toBe(7);
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(null)).toBeNull();
    expect(num('Infinity')).toBeNull();
  });
});

describe('asOfFromLock', () => {
  const e = (id: string, retrievedAt: string) => ({
    id,
    files: [],
    retrievedAt,
    upstreamVersion: 'v',
    rowCount: 0,
    license: 'L',
    homepage: 'h'
  });
  it('is the UTC day of the newest retrievedAt among the as-of sources', () => {
    const lock: Lock = {
      sources: [
        e('datasf-permits-newcon', '2026-10-09T23:00:00.000Z'),
        e('datasf-planning-projects', '2026-10-10T00:00:00.000Z')
      ]
    };
    expect(asOfFromLock(lock)).toBe(day(2026, 10, 10));
  });
  it('the as-of sources are exactly the project-record event sources', () => {
    expect([...AS_OF_SOURCE_IDS]).toEqual([...PROJECT_SOURCE_IDS]);
  });
  it('ignores a newer policy-only or frontage-only entry', () => {
    const lock: Lock = {
      sources: [
        e('datasf-planning-projects', '2026-10-19T01:34:20.056Z'),
        e('datasf-streets', '2026-10-29T09:09:24.450Z'),
        e('datasf-historic-status', '2026-10-29T09:09:29.984Z'),
        e('sfbos-sb79-exemptions', '2026-10-29T09:09:29.985Z'),
        e('some-future-policy-source', '2027-01-01T00:00:00.000Z')
      ]
    };
    expect(asOfFromLock(lock)).toBe(day(2026, 10, 19));
  });
  it('throws on an empty lock', () => {
    expect(() => asOfFromLock({ sources: [] })).toThrow();
  });
  it('throws when the lock has no as-of source', () => {
    expect(() =>
      asOfFromLock({ sources: [e('datasf-streets', '2026-10-29T00:00:00.000Z')] })
    ).toThrow();
  });
});

describe('parseAll', () => {
  it('survives rows that carry only their id field', () => {
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [{ permit_number: 'P1' }],
        'datasf-planning-projects': [{ record_id: '2019-000001PRJ' }],
        'datasf-planning-records': [{ record_id: '2019-000002PPA' }],
        'datasf-planning-review': [{ b1_alt_id: '2019-000001PRJ' }],
        'datasf-unit-completions': [{ building_permit_application: 'P1' }],
        'datasf-housing-production': [{}],
        'datasf-dev-pipeline': [{}]
      }),
      ASOF
    );
    expect(p.asOf).toBe(ASOF);
    expect(p.permits.get('P1')).toEqual({
      number: 'P1',
      type: '',
      named: false,
      sitePermit: false,
      status: '',
      statusDay: null,
      filedDay: null,
      issuedDay: null,
      fcdDay: null,
      completedDateDay: null,
      lastActivityDay: null,
      stories: null,
      existingUnits: null,
      proposedUnits: null,
      valuation: null,
      rows: [
        { blklot: null, streetNumber: null, streetName: null, streetSuffix: null, primary: false }
      ]
    });
    expect(p.prjs.get('2019-000001PRJ')).toEqual({
      recordId: '2019-000001PRJ',
      status: null,
      address: null,
      blklot: null,
      openDay: null,
      closeDay: null,
      permits: [],
      decision: null,
      decisionDay: null,
      unitsProp: null,
      unitsExist: null,
      affordableProp: null,
      newConstruction: false,
      sb35: false,
      hsd: false,
      ab2162: false,
      description: null
    });
    expect(p.children).toEqual([
      {
        recordId: '2019-000002PPA',
        type: '',
        status: null,
        blklot: null,
        parentId: null,
        openDay: null,
        closeDay: null
      }
    ]);
    expect(p.reviews).toEqual([
      { recordId: '2019-000001PRJ', startType: null, startDay: null, endType: null, endDay: null }
    ]);
    expect(p.completions).toEqual([{ permit: 'P1', day: null, kind: null, units: null }]);
    expect(p.housing).toEqual([
      { bpa: null, blklot: null, form: null, netUnits: null, firstCompletionDay: null }
    ]);
    expect(p.pipeline).toEqual([
      {
        idx: 0,
        blklot: null,
        nameaddr: null,
        status: null,
        statusDay: null,
        approvedDay: null,
        caseNo: null,
        bpaNo: null,
        newUnits: null,
        existingUnits: null,
        proposedUnits: null,
        completedNewUnits: null,
        netUnits: null,
        description: null,
        da: null,
        prx: false
      }
    ]);
    expect(p.counts).toEqual({});
  });

  it('maps every raw field', () => {
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [
          {
            permit_number: '201906010001',
            permit_type: '1',
            block: ' 3512 ',
            lot: '008',
            street_number: '10',
            street_name: 'MAIN',
            street_suffix: 'ST',
            status: ' Issued ',
            status_date: '2020-01-02T00:00:00.000',
            filed_date: '2019-06-01T10:37:18.000',
            permit_creation_date: '2019-05-30T00:00:00.000',
            issued_date: '2019-12-01T00:00:00.000',
            first_construction_document_date: '2019-11-14T00:00:00.000',
            completed_date: '1909-06-02T00:00:00.000',
            last_permit_activity_date: '2021-03-04T00:00:00.000',
            number_of_proposed_stories: '5',
            existing_units: '0',
            proposed_units: '24',
            estimated_cost: '900000.0',
            revised_cost: '1100000.0',
            site_permit: 'Y',
            primary_address_flag: 'Y'
          },
          {
            permit_number: '201906010002',
            permit_creation_date: '2019-05-30T00:00:00.000',
            estimated_cost: '250000.0'
          }
        ],
        'datasf-planning-projects': [
          {
            record_id: '2019-000001PRJ',
            record_status: ' Closed ',
            project_address: '10 MAIN ST',
            block: '3512',
            lot: '008',
            open_date: '2019-01-01T00:00:00.000',
            close_date: '2020-01-01T00:00:00.000',
            building_permits: '201906010001, 201906010002',
            project_decision: ' Approved ',
            project_decision_date: '2019-04-01T00:00:00.000',
            number_of_units_prop: '24',
            number_of_units_exist: '0',
            number_affordable_units_prop: '6',
            new_construction: 'CHECKED',
            sb35: 'CHECKED',
            housing_sustainability_dist: 'CHECKED',
            ab2162: 'no',
            description: 'A building'
          }
        ],
        'datasf-planning-records': [
          {
            record_id: '2019-000002PPA',
            record_type: 'PPA',
            record_status: 'Open',
            block: '3512',
            lot: '008',
            parent_id: '2019-000001PRJ',
            open_date: '2018-12-01T00:00:00.000',
            close_date: '2018-12-20T00:00:00.000'
          }
        ],
        'datasf-planning-review': [
          {
            b1_alt_id: '2019-000001PRJ',
            start_event_type: 'Accepted',
            start_event_date: '2019-01-05T00:00:00.000',
            end_event_type: 'Approved',
            end_event_date: '2205-03-13T00:00:00.000'
          }
        ],
        'datasf-unit-completions': [
          {
            building_permit_application: '201906010001',
            date_issued: '2021-05-05T00:00:00.000',
            document_type: 'Initial TCO',
            number_of_units_certified: '12'
          }
        ],
        'datasf-housing-production': [
          {
            bpa: '201906010001',
            blocklot: '3512008',
            form_no: 'F1',
            net_units_completed: '24',
            first_completion_date: '2021-06-01T00:00:00.000'
          }
        ],
        'datasf-dev-pipeline': [
          {
            blklot: '3512008',
            nameaddr: '10 MAIN ST',
            current_status: ' BP ISSUED ',
            current_status_date: '2020-02-02T00:00:00.000',
            approved_date_planning: '2019-04-01T00:00:00.000',
            case_no: '2007.0946PRX',
            bpa_no: '201906010001',
            new_pipeline_units: '24',
            existing_units: '0',
            proposed_units: '24',
            completed_new_units: '0',
            net_pipeline_units: '24',
            description_planning: 'desc',
            da: 'Y'
          }
        ]
      }),
      ASOF
    );
    const permit = p.permits.get('201906010001')!;
    expect(permit).toMatchObject({
      number: '201906010001',
      sitePermit: true,
      status: 'issued',
      statusDay: day(2020, 1, 2),
      filedDay: day(2019, 6, 1),
      issuedDay: day(2019, 12, 1),
      fcdDay: day(2019, 11, 14),
      completedDateDay: null,
      lastActivityDay: day(2021, 3, 4),
      stories: 5,
      existingUnits: 0,
      proposedUnits: 24,
      valuation: 1_100_000
    });
    expect(permit.rows).toEqual([
      {
        blklot: '3512008',
        streetNumber: '10',
        streetName: 'MAIN',
        streetSuffix: 'ST',
        primary: true
      }
    ]);
    expect(p.permits.get('201906010002')!.filedDay).toBe(day(2019, 5, 30));
    // Ruling E2: revised_cost ?? estimated_cost.
    expect(p.permits.get('201906010002')!.valuation).toBe(250_000);
    expect(p.prjs.get('2019-000001PRJ')).toEqual({
      recordId: '2019-000001PRJ',
      status: 'Closed',
      address: '10 MAIN ST',
      blklot: '3512008',
      openDay: day(2019, 1, 1),
      closeDay: day(2020, 1, 1),
      permits: ['201906010001', '201906010002'],
      decision: 'Approved',
      decisionDay: day(2019, 4, 1),
      unitsProp: 24,
      unitsExist: 0,
      affordableProp: 6,
      newConstruction: true,
      sb35: true,
      hsd: true,
      ab2162: false,
      description: 'A building'
    });
    expect(p.children[0]).toEqual({
      recordId: '2019-000002PPA',
      type: 'PPA',
      status: 'Open',
      blklot: '3512008',
      parentId: '2019-000001PRJ',
      openDay: day(2018, 12, 1),
      closeDay: day(2018, 12, 20)
    });
    expect(p.reviews[0]).toEqual({
      recordId: '2019-000001PRJ',
      startType: 'Accepted',
      startDay: day(2019, 1, 5),
      endType: 'Approved',
      endDay: null
    });
    expect(p.completions[0]).toEqual({
      permit: '201906010001',
      day: day(2021, 5, 5),
      kind: 'TCO',
      units: 12
    });
    expect(p.housing[0]).toEqual({
      bpa: '201906010001',
      blklot: '3512008',
      form: 'F1',
      netUnits: 24,
      firstCompletionDay: day(2021, 6, 1)
    });
    expect(p.pipeline[0]).toEqual({
      idx: 0,
      blklot: '3512008',
      nameaddr: '10 MAIN ST',
      status: 'BP ISSUED',
      statusDay: day(2020, 2, 2),
      approvedDay: day(2019, 4, 1),
      caseNo: '2007.0946PRX',
      bpaNo: '201906010001',
      newUnits: 24,
      existingUnits: 0,
      proposedUnits: 24,
      completedNewUnits: 0,
      netUnits: 24,
      description: 'desc',
      da: 'Y',
      prx: true
    });
  });

  it('a revised_cost under $1,000 is a placeholder: the valuation falls back to estimated_cost', () => {
    const v = (row: Record<string, string>) =>
      parseAll(
        raw({ 'datasf-permits-newcon': [{ permit_number: 'P1', ...row }] }),
        ASOF
      ).permits.get('P1')!.valuation;
    expect(v({ revised_cost: '1.0', estimated_cost: '510000.0' })).toBe(510_000);
    expect(v({ revised_cost: '999.99', estimated_cost: '200000.0' })).toBe(200_000);
    expect(v({ revised_cost: '1000.0', estimated_cost: '200000.0' })).toBe(1000);
    expect(v({ revised_cost: '0.0' })).toBeNull();
    expect(v({ estimated_cost: '75000.0' })).toBe(75_000);
    // The pr.permits.placeholder-valuation tally: of = permits with a revised_cost.
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [
          { permit_number: 'P1', revised_cost: '1.0', estimated_cost: '510000.0' },
          { permit_number: 'P2', revised_cost: '250000.0' },
          { permit_number: 'P3', estimated_cost: '90000.0' },
          { permit_number: 'P4', revised_cost: '0.0' }
        ]
      }),
      ASOF
    );
    expect(p.placeholderValuation).toEqual({ of: 3, fired: 2, sample: ['P1', 'P4'] });
    expect([...p.placeholderPermits].sort()).toEqual(['P1', 'P4']);
  });

  it('takes permit-level fields from the primary row, in either input order', () => {
    const primary = {
      permit_number: 'P1',
      block: '1',
      lot: '1',
      status: 'issued',
      primary_address_flag: 'Y'
    };
    const other = { permit_number: 'P1', block: '1', lot: '2', status: 'filed' };
    for (const rows of [
      [primary, other],
      [other, primary]
    ]) {
      const p = parseAll(raw({ 'datasf-permits-newcon': rows }), ASOF);
      const permit = p.permits.get('P1')!;
      expect(permit.status).toBe('issued');
      expect(permit.rows).toHaveLength(2);
      expect(permit.rows.map((r) => r.blklot)).toEqual(['11', '12']);
    }
  });

  it('falls back to the first row in sorted order when none is primary', () => {
    const a = { permit_number: 'P1', block: '1', lot: '1', status: 'filed' };
    const b = { permit_number: 'P1', block: '1', lot: '2', status: 'issued' };
    const s1 = parseAll(raw({ 'datasf-permits-newcon': [a, b] }), ASOF);
    const s2 = parseAll(raw({ 'datasf-permits-newcon': [b, a] }), ASOF);
    expect(s1.permits.get('P1')).toEqual(s2.permits.get('P1'));
    expect(s1.permits.get('P1')!.status).toBe('filed');
  });

  it('is row-order invariant and orders maps and pipeline idx canonically', () => {
    const rows = {
      'datasf-permits-newcon': [{ permit_number: 'B' }, { permit_number: 'A' }],
      'datasf-planning-projects': [{ record_id: 'Z' }, { record_id: 'Y' }],
      'datasf-dev-pipeline': [{ blklot: '2' }, { blklot: '1' }]
    };
    const flip = {
      'datasf-permits-newcon': [...rows['datasf-permits-newcon']].reverse(),
      'datasf-planning-projects': [...rows['datasf-planning-projects']].reverse(),
      'datasf-dev-pipeline': [...rows['datasf-dev-pipeline']].reverse()
    };
    const p = parseAll(raw(rows), ASOF);
    const q = parseAll(raw(flip), ASOF);
    expect([...p.permits.keys()]).toEqual(['A', 'B']);
    expect([...p.prjs.keys()]).toEqual(['Y', 'Z']);
    expect([...q.permits.keys()]).toEqual(['A', 'B']);
    expect(p.pipeline.map((r) => [r.idx, r.blklot])).toEqual([
      [0, '1'],
      [1, '2']
    ]);
    expect(q.pipeline).toEqual(p.pipeline);
  });

  it('drops rows with no id and counts them', () => {
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [{ permit_number: 'A' }, { status: 'x' }, { permit_number: ' ' }],
        'datasf-planning-projects': [{ record_status: 'x' }],
        'datasf-planning-records': [{ record_type: 'PPA' }],
        'datasf-planning-review': [{ start_event_type: 'x' }],
        'datasf-unit-completions': [{ document_type: 'CFC' }]
      }),
      ASOF
    );
    expect(p.permits.size).toBe(1);
    expect(p.prjs.size).toBe(0);
    expect(p.children).toEqual([]);
    expect(p.reviews).toEqual([]);
    expect(p.completions).toEqual([]);
    expect(p.counts).toEqual({
      'parse.dropped.datasf-permits-newcon': 2,
      'parse.dropped.datasf-planning-projects': 1,
      'parse.dropped.datasf-planning-records': 1,
      'parse.dropped.datasf-planning-review': 1,
      'parse.dropped.datasf-unit-completions': 1
    });
  });

  it('keeps an address row with a missing block or lot, with blklot null', () => {
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [
          { permit_number: 'P1', block: '1', street_name: 'MAIN' },
          { permit_number: 'P1', lot: '2' }
        ]
      }),
      ASOF
    );
    const rows = p.permits.get('P1')!.rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.blklot)).toEqual([null, null]);
    expect(rows.map((r) => r.streetName).sort()).toEqual(['MAIN', null]);
  });

  it('falls back to permit_creation_date when filed_date is present but clipped', () => {
    const p = parseAll(
      raw({
        'datasf-permits-newcon': [
          {
            permit_number: 'P1',
            filed_date: '1909-06-02T00:00:00.000',
            permit_creation_date: '2019-05-30T00:00:00.000'
          }
        ]
      }),
      ASOF
    );
    expect(p.permits.get('P1')!.filedDay).toBe(day(2019, 5, 30));
  });

  it('counts every extra duplicate of a PRJ record_id', () => {
    const rows = ['A', 'B', 'C'].map((s) => ({ record_id: 'R1', record_status: s }));
    const p = parseAll(raw({ 'datasf-planning-projects': rows }), ASOF);
    expect(p.prjs.get('R1')!.status).toBe('A');
    expect(p.counts).toEqual({ 'parse.duplicate.datasf-planning-projects': 2 });
  });

  it('keeps the first of a duplicated PRJ record_id in canonical order', () => {
    const a = { record_id: 'R1', record_status: 'A' };
    const b = { record_id: 'R1', record_status: 'B' };
    for (const rows of [
      [a, b],
      [b, a]
    ]) {
      const p = parseAll(raw({ 'datasf-planning-projects': rows }), ASOF);
      expect(p.prjs.size).toBe(1);
      expect(p.prjs.get('R1')!.status).toBe('A');
      expect(p.counts).toEqual({ 'parse.duplicate.datasf-planning-projects': 1 });
    }
  });
});
