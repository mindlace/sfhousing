import { describe, expect, it } from 'vitest';
import { MONTH_DAYS } from '../../timelapse/time';
import type { LessCarsPlan, PlanProject } from './plan';
import { TINY_PLAN, tinyPlan } from './fixtures/tiny-plan';
import {
  LESSCARS_HORIZON,
  LESSCARS_START,
  checkPlan,
  inProgress,
  schedulePlan,
  yearStart
} from './schedule';

const byId = (p: LessCarsPlan, id: string): PlanProject => p.projects.find((x) => x.id === id)!;
const codes = (p: LessCarsPlan) =>
  checkPlan(p, schedulePlan(p)).map(({ code, project }) => ({ code, project }));

describe('schedulePlan', () => {
  it('schedules TINY_PLAN: open = start + round(months x MONTH_DAYS)', () => {
    const t = schedulePlan(TINY_PLAN).times.get('subway')!;
    expect(t.startDay).toBe(yearStart(TINY_PLAN.projects[0].startYear));
    expect(t.openDay).toBe(
      t.startDay + Math.round(TINY_PLAN.projects[0].durationMonths.value * MONTH_DAYS)
    );
    expect(t.closeDay).toBeNull();
    expect(t.availableDay).toBeNull();
  });

  it('sets closeDay, availableDay and build times', () => {
    const s = schedulePlan(TINY_PLAN).times;
    const removal = s.get('removal')!;
    expect(removal.closeDay).toBe(removal.startDay);
    expect(removal.availableDay).toBe(removal.openDay);
    expect(removal.build!.startDay).toBe(yearStart(2033));
    expect(s.get('parking')!.availableDay).toBe(s.get('parking')!.openDay);
    expect(s.get('garage')!.availableDay).toBeNull();
  });

  it('has the window constants', () => {
    expect(LESSCARS_START).toBe(yearStart(2028));
    expect(LESSCARS_HORIZON).toBe(yearStart(2069) - 1);
  });
});

describe('checkPlan', () => {
  it('TINY_PLAN has no problems', () => {
    expect(checkPlan(TINY_PLAN, schedulePlan(TINY_PLAN))).toEqual([]);
  });

  const planWithDisplays = (ds: { id: string; from: string }[]): LessCarsPlan =>
    tinyPlan((q) => {
      q.displays = ds.map((d) => ({ ...d, label: d.id, segments: [{ cnn: ['2000'] }] }));
    });

  it('a display naming no project is unknown-dependency; a reused id is duplicate-id', () => {
    const p = planWithDisplays([
      { id: 'x', from: 'nope' },
      { id: 'subway', from: 'subway' },
      { id: 'y', from: 'subway' },
      { id: 'y', from: 'subway' }
    ]);
    const found = checkPlan(p, schedulePlan(p)).map((q) => `${q.project}:${q.code}`);
    expect(found).toContain('x:unknown-dependency');
    expect(found).toContain('subway:duplicate-id');
    expect(found).toContain('y:duplicate-id');
    expect(codes(planWithDisplays([{ id: 'underpass', from: 'subway' }]))).toEqual([]);
  });

  it('fillmore: a removal starting before its transit opens', () => {
    const p = tinyPlan((q) => (byId(q, 'hwy').startYear = byId(q, 'subway').startYear));
    expect(codes(p)).toContainEqual({ code: 'fillmore', project: 'hwy' });
  });

  it('no-transit-dependency: a pedestrian street depending only on a street change', () => {
    const p = tinyPlan((q) => (byId(q, 'ped').dependsOn = ['removal']));
    expect(codes(p)).toContainEqual({ code: 'no-transit-dependency', project: 'ped' });
  });

  it('parking-no-transit: a parking conversion depending only on a street removal', () => {
    const p = tinyPlan((q) => {
      byId(q, 'parking').dependsOn = ['removal'];
      byId(q, 'parking').startYear = 2033;
      (byId(q, 'parking') as Extract<PlanProject, { kind: 'parking-conversion' }>).build.startYear =
        2034;
    });
    expect(codes(p)).toContainEqual({ code: 'parking-no-transit', project: 'parking' });
  });

  it('starts-before-dependency', () => {
    const p = tinyPlan((q) => (byId(q, 'ped').startYear = 2028));
    expect(codes(p)).toContainEqual({ code: 'starts-before-dependency', project: 'ped' });
  });

  it('cycle', () => {
    const p = tinyPlan((q) => (byId(q, 'subway').dependsOn = ['hwy']));
    const c = codes(p);
    expect(c).toContainEqual({ code: 'cycle', project: 'subway' });
    expect(c).toContainEqual({ code: 'cycle', project: 'hwy' });
  });

  it('unknown-dependency, including a shuttle garage', () => {
    const p = tinyPlan((q) => {
      byId(q, 'ped').dependsOn.push('nope');
      (byId(q, 'shuttle') as Extract<PlanProject, { kind: 'car-shuttle' }>).garages = ['nogarage'];
    });
    const c = codes(p);
    expect(c).toContainEqual({ code: 'unknown-dependency', project: 'ped' });
    expect(c).toContainEqual({ code: 'unknown-dependency', project: 'shuttle' });
  });

  it('duplicate-id', () => {
    const p = tinyPlan((q) => (byId(q, 'ped').id = 'tram'));
    expect(codes(p)).toContainEqual({ code: 'duplicate-id', project: 'tram' });
  });

  it('duplicate-stop', () => {
    const p = tinyPlan((q) => {
      const s = byId(q, 'subway') as Extract<PlanProject, { kind: 'transit-line' }>;
      s.stops[1].id = 'lc:a';
    });
    expect(codes(p)).toContainEqual({ code: 'duplicate-stop', project: 'subway' });
  });

  it('site-reused: two garages on one freed project', () => {
    const p = tinyPlan((q) => {
      const g = structuredClone(byId(q, 'garage'));
      g.id = 'garage2';
      q.projects.push(g);
    });
    expect(codes(p)).toContainEqual({ code: 'site-reused', project: 'garage2' });
  });

  it('outside-window: a start in 2027 and a build completing in 2069', () => {
    const early = tinyPlan((q) => (byId(q, 'tram').startYear = 2027));
    expect(codes(early)).toContainEqual({ code: 'outside-window', project: 'tram' });
    const late = tinyPlan((q) => {
      (
        byId(q, 'removal') as Extract<
          PlanProject,
          { kind: 'highway-truncation' | 'street-removal' }
        >
      ).build = {
        startYear: 2068,
        durationMonths: { value: 24, provenance: TINY_PLAN.capacity[0].provenance }
      };
    });
    expect(codes(late)).toContainEqual({ code: 'outside-window', project: 'removal' });
  });

  it('build-before-available', () => {
    const p = tinyPlan((q) => {
      (
        byId(q, 'removal') as Extract<
          PlanProject,
          { kind: 'highway-truncation' | 'street-removal' }
        >
      ).build!.startYear = 2031;
    });
    expect(codes(p)).toContainEqual({ code: 'build-before-available', project: 'removal' });
  });

  it('garage-site: a garage on a freed project that has a build, and one starting too early', () => {
    const withBuild = tinyPlan(
      (q) =>
        ((byId(q, 'garage') as Extract<PlanProject, { kind: 'edge-garage' }>).site = {
          project: 'removal'
        })
    );
    expect(codes(withBuild)).toContainEqual({ code: 'garage-site', project: 'garage' });
    const early = tinyPlan((q) => (byId(q, 'garage').startYear = 2033));
    expect(codes(early)).toContainEqual({ code: 'garage-site', project: 'garage' });
  });

  it('capacity: three transit projects overlapping with maxConcurrent 2', () => {
    const p = tinyPlan((q) => (byId(q, 'tram').startYear = 2028));
    expect(codes(p)).toContainEqual({ code: 'capacity', project: expect.any(String) });
    const day = yearStart(2028);
    expect(inProgress(p, schedulePlan(p), 'transit', day)).toBe(3);
    expect(inProgress(p, schedulePlan(p), 'transit', yearStart(2040))).toBe(0);
  });

  it('sorts by project, then code', () => {
    const p = tinyPlan((q) => (byId(q, 'hwy').startYear = byId(q, 'subway').startYear));
    const c = codes(p);
    expect(c).toEqual(
      [...c].sort((a, b) => a.project.localeCompare(b.project) || (a.code < b.code ? -1 : 1))
    );
  });
});
