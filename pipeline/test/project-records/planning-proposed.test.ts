// ProjectHistory.planningProposed: the primary Planning record's proposed and affordable homes.
import { describe, expect, it } from 'vitest';
import {
  deriveProjects,
  serializeHistories,
  type DeriveResult
} from '../../project-records/derive';
import { ASOF, baseInput, baseRaw } from './derive-input';

function history(r: DeriveResult, id: string) {
  const h = r.histories.find((x) => x.id === id);
  if (!h) throw new Error(`no history ${id}`);
  return h;
}

const A = 'PRJ:2019-000001PRJ';

function withPrjA(over: Record<string, string>) {
  const raw = baseRaw();
  const prj = raw['datasf-planning-projects'].find((r) => r.record_id === '2019-000001PRJ')!;
  Object.assign(prj, over);
  return raw;
}

describe('planningProposed', () => {
  it('carries the primary units and affordable units', () => {
    const r = deriveProjects(baseInput(withPrjA({ number_affordable_units_prop: '23' })));
    expect(history(r, A).planningProposed).toEqual({ units: 24, affordable: 23 });
  });

  it('carries null affordable when the primary has no value', () => {
    const r = deriveProjects(baseInput());
    expect(history(r, A).planningProposed).toEqual({ units: 24, affordable: null });
  });

  it('is null for a permit-only history', () => {
    const r = deriveProjects(baseInput());
    expect(history(r, 'BP:202403150003').planningProposed).toBeNull();
  });

  it("carries the primary's counts, never a satellite's", () => {
    const raw = withPrjA({ number_affordable_units_prop: '23' });
    raw['datasf-planning-projects'].push({
      record_id: '2019-000002PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '001',
      open_date: '2018-12-01T00:00:00.000',
      building_permits: '201906010001',
      number_of_units_prop: '99',
      number_affordable_units_prop: '1',
      new_construction: 'CHECKED'
    });
    const r = deriveProjects(baseInput(raw));
    expect(history(r, A).planningProposed).toEqual({ units: 24, affordable: 23 });
  });

  it('serializes the field last, after quality', () => {
    const r = deriveProjects(baseInput());
    const out = JSON.parse(serializeHistories({ schema: 1, asOf: ASOF, histories: r.histories }));
    const keys = Object.keys(out.histories[0]);
    expect(keys.slice(-2)).toEqual(['quality', 'planningProposed']);
  });
});
