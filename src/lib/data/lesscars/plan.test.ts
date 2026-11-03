import { describe, expect, it } from 'vitest';
import {
  capacityKindOf,
  closesToCars,
  parseLessCarsPlan,
  type LaneUse,
  type LessCarsPlan,
  type PlanProject,
  type ProjectKind
} from './plan';
import { tinyPlan, TINY_PLAN } from './fixtures/tiny-plan';

function project(kind: ProjectKind): PlanProject {
  const p = TINY_PLAN.projects.find((x) => x.kind === kind);
  if (!p) throw new Error(`no ${kind} in TINY_PLAN`);
  return p;
}

function streetChange(lanes: LaneUse[]): PlanProject {
  return { ...(project('street-change') as PlanProject & { kind: 'street-change' }), lanes };
}

// The edit callback is loose on purpose: tests break the plan in ways the types forbid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { projects: any[]; capacity: any[] };
function failure(edit: (p: Loose) => void) {
  const plan = tinyPlan((p) => edit(p as unknown as Loose));
  try {
    parseLessCarsPlan(plan);
  } catch (e) {
    return e as { path: string; message: string };
  }
  return { path: '(no error)', message: '' };
}

describe('parseLessCarsPlan', () => {
  it('opensAfter parses when present and is absent from the object when omitted', () => {
    const withOpensAfter = tinyPlan((p) => (p.projects[1].opensAfter = ['subway']));
    expect(parseLessCarsPlan(withOpensAfter).projects[1].opensAfter).toEqual(['subway']);
    expect('opensAfter' in parseLessCarsPlan(TINY_PLAN).projects[0]).toBe(false);
  });

  it('rejects a point outside lng/lat range, naming its path', () => {
    expect(failure((p) => (p.projects[0].stops[0].lngLat = [37.77, -122.43])).path).toBe(
      'projects.0.stops.0.lngLat'
    );
    expect(failure((p) => (p.projects[0].alignment[1] = [-122.4, 137])).path).toBe(
      'projects.0.alignment.1'
    );
    expect(failure((p) => (p.projects[2].segments[0].line[0] = [200, 37])).path).toBe(
      'projects.2.segments.0.line.0'
    );
  });

  it('parses TINY_PLAN and round-trips through JSON', () => {
    expect(parseLessCarsPlan(JSON.parse(JSON.stringify(TINY_PLAN)))).toEqual(TINY_PLAN);
  });

  it('holds one project of every kind', () => {
    expect(new Set(TINY_PLAN.projects.map((p) => p.kind)).size).toBe(9);
  });

  it('tinyPlan edits a copy, not the fixture', () => {
    const copy: LessCarsPlan = tinyPlan((p) => (p.label = 'changed'));
    expect(copy.label).toBe('changed');
    expect(TINY_PLAN.label).toBe('Tiny plan');
  });

  it('rejects schema 2, an unknown kind and an unknown key with the path', () => {
    expect(() => parseLessCarsPlan({ ...TINY_PLAN, schema: 2 })).toThrow(/schema/);
    const bad = tinyPlan((p) => ((p.projects[0] as { kind: string }).kind = 'tunnel'));
    expect(() => parseLessCarsPlan(bad)).toThrowError(
      expect.objectContaining({ path: 'projects.0.kind' })
    );
    expect(() => parseLessCarsPlan({ ...TINY_PLAN, extra: 1 })).toThrow(/extra/);
    expect(failure((p) => (p.projects[3].extra = 1)).path).toBe('projects.3.extra');
  });

  it('rejects a Param without provenance, a non-integer startYear and a new stop without lngLat', () => {
    expect(failure((p) => delete p.projects[0].peakTph.provenance).path).toBe(
      'projects.0.peakTph.provenance'
    );
    expect(failure((p) => (p.projects[0].startYear = 2028.5)).path).toBe('projects.0.startYear');
    expect(failure((p) => (p.projects[0].stops[0].lngLat = null)).path).toBe(
      'projects.0.stops.0.lngLat'
    );
  });

  it('rejects a new stop id without the lc: prefix and an existing stop with lngLat', () => {
    expect(failure((p) => (p.projects[0].stops[0].id = 'a')).path).toBe('projects.0.stops.0.id');
    expect(failure((p) => (p.projects[0].stops[2].lngLat = [0, 0])).message).toMatch(/existing/);
  });

  it('rejects a bad capacity rule and a short alignment', () => {
    expect(failure((p) => (p.capacity[1].maxConcurrent = -1)).path).toBe(
      'capacity.1.maxConcurrent'
    );
    expect(failure((p) => (p.projects[0].alignment = [[0, 0]])).path).toBe('projects.0.alignment');
  });
});

describe('plan displays', () => {
  const display = {
    id: 'underpass',
    label: 'Underpass filled',
    segments: [{ cnn: ['2000'] }],
    from: 'subway'
  };
  const displayWith = (edit: Partial<typeof display> | Record<string, unknown>) =>
    JSON.parse(JSON.stringify({ ...TINY_PLAN, displays: [{ ...display, ...edit }] }));
  const withDisplays = displayWith({});
  const miniPlan = JSON.parse(JSON.stringify(TINY_PLAN));

  it('parses displays; a plan without them has no displays key', () => {
    expect(parseLessCarsPlan(withDisplays).displays).toEqual([
      { id: 'underpass', label: 'Underpass filled', segments: [{ cnn: ['2000'] }], from: 'subway' }
    ]);
    expect('displays' in parseLessCarsPlan(miniPlan)).toBe(false);
  });

  it('rejects a display with no segments, a missing from and an unknown key', () => {
    expect(() => parseLessCarsPlan(displayWith({ segments: [] }))).toThrow(/displays\.0\.segments/);
    const noFrom = displayWith({});
    delete noFrom.displays[0].from;
    expect(() => parseLessCarsPlan(noFrom)).toThrow(/displays\.0\.from/);
    expect(() => parseLessCarsPlan(displayWith({ extra: 1 }))).toThrow(/displays\.0\.extra/);
  });
});

describe('closesToCars', () => {
  it('is true for removals, truncations and street changes without a car lane', () => {
    expect(closesToCars(project('street-removal'))).toBe(true);
    expect(closesToCars(project('highway-truncation'))).toBe(true);
    expect(closesToCars(streetChange(['bus', 'bike', 'sidewalk']))).toBe(true);
    expect(closesToCars(streetChange(['car', 'bus']))).toBe(false);
    expect(closesToCars(project('bus-lane'))).toBe(false);
  });
});

describe('capacityKindOf', () => {
  it('maps each kind to the capacity it draws on', () => {
    expect(capacityKindOf(project('transit-line'))).toBe('transit');
    expect(capacityKindOf(project('street-removal'))).toBe('street');
    expect(capacityKindOf(project('edge-garage'))).toBe('garage');
    expect(capacityKindOf(project('car-shuttle'))).toBe('transit');
    expect(capacityKindOf(project('parking-conversion'))).toBe('street'); // clearance; its build counts as housing in checkPlan
  });
});
