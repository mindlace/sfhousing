// deriveProjects with the stale-open rulings (spec 4.6; Rulings C2, E2, C3): T4d histories only,
// T3 unchanged, each rule's T14 row, and the in-flight report counts.
import { describe, expect, it, vi } from 'vitest';
import type { ConstructionVerdict } from '../../enrichment/construction-schema';
import { deriveProjects, serializeProjects, type DeriveResult } from '../../project-records/derive';
import type { ProjectRecordsInput, RawRow } from '../../project-records/types';
import { baseInput, baseMultiphase, baseRaw, day } from './derive-input';

const ts = (iso: string) => `${iso}T00:00:00.000`;

type Row = { fired: number; of: number; sample: string[] };
const calls = vi.hoisted(() => [] as { counts: object; id: string; row: Row }[]);

// Wraps the real recordQuality to log each rule's row against its counts object.
vi.mock('../../lib/quality', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/quality')>();
  return {
    ...actual,
    recordQuality: (counts: Record<string, number>, id: string, c: Row) => {
      actual.recordQuality(counts, id, c);
      calls.push({ counts, id, row: { fired: c.fired, of: c.of, sample: [...c.sample].sort() } });
    }
  };
});

function reportRowsOf(counts: object): Map<string, Row> {
  return new Map(calls.filter((c) => c.counts === counts).map((c) => [c.id, c.row]));
}

function history(r: DeriveResult, id: string) {
  const h = r.histories.find((x) => x.id === id);
  if (!h) throw new Error(`no history ${id}`);
  return h;
}

/** A type 1 site permit on lot 008 (no units in the base roll), with no PRJ or pipeline row. */
function stalePermit(o: {
  number: string;
  lot?: string;
  issued: string;
  filed: string;
  fcd?: string;
  estimated?: number;
  revised?: number;
  lastActivity?: string;
  status?: string;
}): RawRow {
  const r: RawRow = {
    permit_number: o.number,
    permit_type: '1',
    block: '3512',
    lot: o.lot ?? '008',
    status: o.status ?? 'issued',
    status_date: ts(o.issued),
    filed_date: ts(o.filed),
    issued_date: ts(o.issued),
    proposed_units: '3',
    site_permit: 'Y',
    primary_address_flag: 'Y'
  };
  if (o.fcd) r.first_construction_document_date = ts(o.fcd);
  if (o.estimated !== undefined) r.estimated_cost = String(o.estimated);
  if (o.revised !== undefined) r.revised_cost = String(o.revised);
  if (o.lastActivity) r.last_permit_activity_date = ts(o.lastActivity);
  return r;
}

/** E0 $200k, issued 2005-03-01: deadline + extension = 450 days later. */
const EXPIRED = stalePermit({
  number: '200406010024',
  issued: '2005-03-01',
  filed: '2004-06-01',
  estimated: 200_000
});
/** E2, $1.1M after review: at construction 2015-06-01, an xdht completion in 2018. */
const FINISHED = stalePermit({
  number: '201409010025',
  lot: '009',
  issued: '2015-03-02',
  filed: '2014-09-01',
  fcd: '2015-06-01',
  estimated: 900_000,
  revised: 1_100_000
});
/** E1, no valuation (middle bracket, 1,260 days), activity in 2016 after the 2015 deadline. */
const ACTIVE = stalePermit({
  number: '201203010026',
  lot: '009',
  issued: '2012-03-01',
  filed: '2011-12-01',
  lastActivity: '2016-01-04'
});

function staleInput(verdicts: ConstructionVerdict[] = []): ProjectRecordsInput {
  const raw = baseRaw();
  raw['datasf-permits-newcon'].push(EXPIRED, FINISHED, ACTIVE);
  raw['datasf-housing-production'].push({
    bpa: '201409010025',
    blocklot: '3512009',
    form_no: '1',
    net_units_completed: '3',
    first_completion_date: ts('2018-03-01')
  });
  return baseInput(raw, baseMultiphase(), { schema: 1, projects: verdicts });
}

const verdict = (o: Partial<ConstructionVerdict>): ConstructionVerdict => ({
  id: 'BP:1',
  verdict: 'unknown',
  checked: '2026-09-01',
  source: 'test imagery check',
  ...o
});

describe('stale open histories (deriveProjects)', () => {
  it('statutory expiry: exits at permitIssued, dated deadline + extension, with the rule id', () => {
    const r = deriveProjects(staleInput());
    const h = history(r, 'BP:200406010024');
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'permitIssued',
      reason: 'expired',
      day: day('2005-03-01') + 360 + 90
    });
    expect(h.quality).toContain('pr.stages.statutory-expiry');
    expect(h.quality).not.toContain('pr.stages.last-observed-clamp');
  });

  it('complete-from-evidence runs before expiry: complete at the xdht day, no unitsAt.complete', () => {
    const r = deriveProjects(staleInput());
    const h = history(r, 'BP:201409010025');
    expect(h.end).toEqual({ kind: 'complete', day: day('2018-03-01') });
    expect(h.entered.complete).toBe(day('2018-03-01'));
    expect(h.unitsAt.complete).toBeUndefined();
    expect(h.quality).toContain('pr.stages.complete-from-evidence');
    expect(h.quality).not.toContain('pr.stages.statutory-expiry');
    // The dating xdht row is a source, sorted among the others.
    expect(h.sources).toEqual([
      { dataset: 'i98e-djp9', id: '201409010025', key: 'permit_number' },
      { dataset: 'xdht-4php', id: '201409010025', key: 'bpa' }
    ]);
    // Histories not completed from xdht evidence list no xdht row.
    for (const x of r.histories.filter((y) => y.id !== h.id)) {
      expect(
        x.sources.some((s) => s.dataset === 'xdht-4php'),
        x.id
      ).toBe(false);
    }
  });

  it('activity after the deadline keeps the history open', () => {
    const r = deriveProjects(staleInput());
    expect(history(r, 'BP:201203010026').end.kind).toBe('open');
  });

  it('T3 is unchanged by the history-only rules', () => {
    const r = deriveProjects(staleInput());
    const raw = baseRaw();
    raw['datasf-permits-newcon'].push(EXPIRED, FINISHED, ACTIVE);
    const base = deriveProjects(baseInput(raw));
    expect(serializeProjects(r.file)).toBe(serializeProjects(base.file));
    // A: in flight, $3M site permit issued 2021-02-01, due 2028: it stays in flight.
    expect(r.file.projects.map((p) => p.id)).toContain('PRJ:2019-000001PRJ');
    expect(r.counts['projects.excludedStatutory']).toBe(0);
    expect(r.counts['projects.excludedSuspended']).toBe(0);
  });

  /** The base raw with A's permit valued `estimated` (none when undefined) or given `status`. */
  function withA(o: { estimated?: number; status?: string }): ProjectRecordsInput {
    const raw = baseRaw();
    for (const p of raw['datasf-permits-newcon']) {
      if (p.permit_number !== '201906010001') continue;
      if (o.estimated === undefined) delete p.estimated_cost;
      else p.estimated_cost = String(o.estimated);
      if (o.status) p.status = o.status;
    }
    return baseInput(raw);
  }

  it('an in-flight project past its deadline exits expired and leaves flight (Ruling I4)', () => {
    // No valuation: the middle bracket, 1,080 + 720 days from 2021-02-01, past by 2026-01-06.
    const r = deriveProjects(withA({}));
    const h = history(r, 'PRJ:2019-000001PRJ');
    expect(h.end).toEqual({
      kind: 'exit',
      stage: 'construction',
      reason: 'expired',
      day: day('2021-02-01') + 1080 + 720
    });
    expect(h.quality).toContain('pr.stages.statutory-expiry');
    expect(r.file.projects.map((p) => p.id)).not.toContain('PRJ:2019-000001PRJ');
    expect(r.counts['projects.excludedStatutory']).toBe(1);
    expect(r.counts['projects.excludedStatutoryUnits']).toBe(24);
    expect(r.counts['projects.status.ended']).toBe(
      deriveProjects(baseInput()).counts['projects.status.ended'] + 1
    );
    expect(r.warnings).toContain(
      'PRJ:2019-000001PRJ: past statutory completion deadline; expired, left flight'
    );
    // Its pipeline row leaves V21 with it (the records show it ended).
    expect(r.checks.coverage.rows).toBe(deriveProjects(baseInput()).checks.coverage.rows - 1);
  });

  it('an in-flight project whose permits are all suspended leaves flight; its history stays open', () => {
    // Valued $3M, so within its statutory time (a suspended permit past it would still expire).
    const r = deriveProjects(withA({ estimated: 3_000_000, status: 'suspend' }));
    expect(r.file.projects.map((p) => p.id)).not.toContain('PRJ:2019-000001PRJ');
    expect(history(r, 'PRJ:2019-000001PRJ').end.kind).toBe('open');
    expect(r.counts['projects.status.suspended']).toBe(1);
    expect(r.counts['projects.excludedSuspended']).toBe(1);
    expect(r.counts['projects.excludedSuspendedUnits']).toBe(24);
    expect(r.counts['projects.excludedStatutory']).toBe(0);
    expect(r.warnings).toContain('PRJ:2019-000001PRJ: every permit suspended; left flight');
  });

  it('a history with a completed unit-bearing permit is excluded from expiry (I3 rejected)', () => {
    const raw = staleInput().raw;
    // A second, completed building, joined to EXPIRED by one Planning record.
    raw['datasf-permits-newcon'].push({
      ...EXPIRED,
      permit_number: '200407010024',
      filed_date: ts('2004-07-01'),
      status: 'complete',
      completed_date: ts('2007-01-10')
    });
    raw['datasf-planning-projects'].push({
      record_id: '2004-000024PRJ',
      record_status: 'Closed',
      block: '3512',
      lot: '008',
      open_date: ts('2004-04-01'),
      building_permits: '200406010024,200407010024',
      number_of_units_prop: '6',
      new_construction: 'CHECKED'
    });
    const r = deriveProjects({ ...staleInput(), raw });
    const id = r.histories.find((h) => h.sources.some((s) => s.id === '200406010024'))
      ?.id as string;
    expect(history(r, id).end.kind).toBe('open');
    expect(r.counts['histories.statutoryExpiry.excludedCompletePermit']).toBe(1);
  });

  it('records each rule once: of, fired and the sample', () => {
    const r = deriveProjects(staleInput());
    const rows = reportRowsOf(r.counts);
    // Of the histories that entered construction (A, C and FINISHED): FINISHED.
    expect(rows.get('pr.stages.complete-from-evidence')).toMatchObject({
      fired: 1,
      of: 3,
      sample: ['BP:201409010025']
    });
    // Of the histories that entered permitIssued (A, C, EXPIRED, FINISHED, ACTIVE): EXPIRED.
    expect(rows.get('pr.stages.statutory-expiry')).toMatchObject({
      fired: 1,
      of: 5,
      sample: ['BP:200406010024']
    });
    // The bracketed permits of the histories examined (A in flight, EXPIRED, ACTIVE): ACTIVE.
    expect(rows.get('pr.stages.expiry-no-valuation')).toMatchObject({
      fired: 1,
      of: 3,
      sample: ['BP:201203010026']
    });
    expect(rows.get('pr.stages.verified-construction')).toMatchObject({ fired: 0, of: 0 });
  });

  it('curated verdicts: complete, dead and unknown on open histories; others warn', () => {
    const r = deriveProjects(
      staleInput([
        verdict({ id: 'BP:201203010026', verdict: 'complete', completeDay: '2017-05-01' }),
        verdict({ id: 'BP:201410070008', verdict: 'dead' }),
        verdict({ id: 'BP:209901010099', verdict: 'dead' }),
        verdict({ id: 'PRJ:2019-000001PRJ', verdict: 'dead' }),
        verdict({ id: 'PRJ:2016-000006PRJ', verdict: 'unknown' })
      ])
    );
    const done = history(r, 'BP:201203010026');
    expect(done.end).toEqual({ kind: 'complete', day: day('2017-05-01') });
    expect(done.unitsAt.complete).toBeUndefined();
    expect(done.quality).toContain('pr.stages.verified-construction');
    expect(history(r, 'BP:201410070008').end).toEqual({
      kind: 'exit',
      stage: 'permitFiled',
      reason: 'withdrawn',
      day: day('2026-09-01')
    });
    // In flight: unchanged, and warned.
    expect(history(r, 'PRJ:2019-000001PRJ').end.kind).toBe('open');
    expect(r.warnings).toContain(
      'construction-verified.json: BP:209901010099 names no open history; not applied'
    );
    expect(r.warnings).toContain(
      'construction-verified.json: PRJ:2019-000001PRJ is in flight; not applied (T3 is unchanged)'
    );
    expect(r.warnings).toContain(
      'construction-verified.json: PRJ:2016-000006PRJ names no open history; not applied'
    );
    expect(reportRowsOf(r.counts).get('pr.stages.verified-construction')).toMatchObject({
      fired: 2,
      of: 5,
      sample: ['BP:201203010026', 'BP:201410070008']
    });
  });

  it('a verdict before the last entered stage is forward-clamped and marks the clamp', () => {
    const r = deriveProjects(
      staleInput([
        verdict({ id: 'BP:201203010026', verdict: 'complete', completeDay: '2010-01-01' })
      ])
    );
    const h = history(r, 'BP:201203010026');
    expect(h.end).toEqual({ kind: 'complete', day: day('2012-03-01') });
    expect(h.quality).toEqual(
      expect.arrayContaining(['pr.stages.forward-clamp', 'pr.stages.verified-construction'])
    );
  });
});
