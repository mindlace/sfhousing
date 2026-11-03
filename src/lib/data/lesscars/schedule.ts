// Turns a fixed fewer-cars plan into dated project times and checks it against the plan rules
// (dependencies, the Fillmore rule, capacity). Pure; relative imports only.
//
// Builder's call: the Fillmore check is a hard failure on the start day, because closure must
// follow opening and construction is when the street closes.
import { MONTH_DAYS, type Day } from '../../timelapse/time';
import {
  TRANSIT_KINDS,
  capacityKindOf,
  closesToCars,
  type CapacityKind,
  type LessCarsPlan,
  type PlanProject
} from './plan';

export const LESSCARS_START: Day = Date.UTC(2028, 0, 1) / 86400000;
export const LESSCARS_HORIZON: Day = Date.UTC(2068, 11, 31) / 86400000;

export function yearStart(year: number): Day {
  return Date.UTC(year, 0, 1) / 86400000;
}

export interface ProjectTimes {
  id: string;
  startDay: Day;
  openDay: Day;
  /** Car closure: `startDay` when the project closes its street to cars, else null. */
  closeDay: Day | null;
  /** Site ready: `openDay` for removals, truncations and parking conversions, else null. */
  availableDay: Day | null;
  build: { startDay: Day; completeDay: Day } | null;
}
export interface PlanSchedule {
  times: Map<string, ProjectTimes>;
}

/**
 * `start` plus `months` calendar months (UTC), and a fractional remainder as rounded days. A
 * project of 36 months from 1 January 2029 opens on 1 January 2032. A day-of-month the target
 * month lacks overflows into the next month, as `Date.UTC` does; plan starts are always 1 January,
 * so this never happens in practice.
 */
export function monthsAfter(start: Day, months: number): Day {
  const whole = Math.floor(months);
  const d = new Date(start * 86400000);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + whole, d.getUTCDate()) / 86400000;
  return day + Math.round((months - whole) * MONTH_DAYS);
}

export function schedulePlan(plan: LessCarsPlan): PlanSchedule {
  const times = new Map<string, ProjectTimes>();
  for (const p of plan.projects) {
    const startDay = yearStart(p.startYear);
    const openDay = monthsAfter(startDay, p.durationMonths.value);
    const hasSite =
      p.kind === 'highway-truncation' ||
      p.kind === 'street-removal' ||
      p.kind === 'parking-conversion';
    const b = 'build' in p ? p.build : null;
    let build: ProjectTimes['build'] = null;
    if (b) {
      const bs = yearStart(b.startYear);
      build = { startDay: bs, completeDay: monthsAfter(bs, b.durationMonths.value) };
    }
    times.set(p.id, {
      id: p.id,
      startDay,
      openDay,
      closeDay: closesToCars(p) ? startDay : null,
      availableDay: hasSite ? openDay : null,
      build
    });
  }
  return { times };
}

export type PlanProblemCode =
  | 'duplicate-id'
  | 'unknown-dependency'
  | 'opens-before'
  | 'cycle'
  | 'outside-window'
  | 'starts-before-dependency'
  | 'no-transit-dependency'
  | 'fillmore'
  | 'build-before-available'
  | 'garage-site'
  | 'site-reused'
  | 'duplicate-stop'
  | 'capacity'
  | 'parking-no-transit';
export interface PlanProblem {
  code: PlanProblemCode;
  project: string;
  message: string;
}

interface Item {
  project: string;
  kind: CapacityKind;
  start: Day;
  end: Day;
}

function items(plan: LessCarsPlan, s: PlanSchedule): Item[] {
  const out: Item[] = [];
  for (const p of plan.projects) {
    const t = s.times.get(p.id);
    if (!t) continue;
    out.push({ project: p.id, kind: capacityKindOf(p), start: t.startDay, end: t.openDay });
    if (t.build)
      out.push({
        project: p.id,
        kind: 'housing',
        start: t.build.startDay,
        end: t.build.completeDay
      });
  }
  return out;
}

/** How many projects of `kind` are under way on `day` (a project is in progress on [start, end)). */
export function inProgress(
  plan: LessCarsPlan,
  s: PlanSchedule,
  kind: CapacityKind,
  day: Day
): number {
  return items(plan, s).filter((i) => i.kind === kind && i.start <= day && day < i.end).length;
}

type SiteUse = 'freed' | 'garage' | 'other';

/** The sites a project stands on, each with how it uses it. */
function siteKeys(p: PlanProject): { key: string; use: SiteUse }[] {
  if (p.kind === 'parking-conversion') return [{ key: `parcel:${p.parcel}`, use: 'other' }];
  if (p.kind === 'edge-garage')
    return [
      'project' in p.site
        ? { key: `project:${p.site.project}`, use: 'other' }
        : { key: `parcel:${p.site.parcel}`, use: 'garage' }
    ];
  if (p.kind === 'highway-truncation' && p.freewayLand)
    return p.freewayLand.parcels.map((id) => ({ key: `parcel:${id}`, use: 'freed' as const }));
  return [];
}

export function checkPlan(plan: LessCarsPlan, s: PlanSchedule): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const seen = new Set<string>();
  const add = (code: PlanProblemCode, project: string, message: string) => {
    const key = `${project}\u0000${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ code, project, message });
  };

  const byId = new Map<string, PlanProject>();
  for (const p of plan.projects) {
    if (byId.has(p.id)) add('duplicate-id', p.id, `id ${p.id} is used by more than one project`);
    else byId.set(p.id, p);
  }

  for (const p of plan.projects) {
    for (const d of [
      ...p.dependsOn,
      ...(p.opensAfter ?? []),
      ...(p.kind === 'car-shuttle' ? p.garages : [])
    ]) {
      if (!byId.has(d)) add('unknown-dependency', p.id, `${p.id} names unknown project ${d}`);
    }
  }

  // Displays share the id space with projects and show from their `from` project's open day.
  const displayIds = new Set<string>();
  for (const d of plan.displays ?? []) {
    if (byId.has(d.id) || displayIds.has(d.id))
      add('duplicate-id', d.id, `id ${d.id} is used by more than one project or display`);
    displayIds.add(d.id);
    if (!byId.has(d.from))
      add('unknown-dependency', d.id, `${d.id} names unknown project ${d.from}`);
  }

  // Cycles: depth-first search; every project on a cycle is reported.
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 1) {
        for (const c of stack.slice(stack.indexOf(d)))
          add('cycle', c, `${c} is on a dependency cycle through ${d}`);
      } else if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of byId.keys()) if (!state.has(id)) visit(id);

  for (const p of plan.projects) {
    const t = s.times.get(p.id);
    if (!t) continue;
    const days = [t.startDay, t.openDay];
    if (t.build) days.push(t.build.startDay, t.build.completeDay);
    if (days.some((d) => d < LESSCARS_START || d > LESSCARS_HORIZON))
      add('outside-window', p.id, `${p.id} has a date outside 2028-01-01 to 2068-12-31`);

    const deps = p.dependsOn.map((d) => byId.get(d)).filter((d): d is PlanProject => !!d);
    for (const d of deps) {
      const dt = s.times.get(d.id);
      if (dt && t.startDay < dt.openDay)
        add('starts-before-dependency', p.id, `${p.id} starts before ${d.id} opens`);
    }
    for (const q of p.opensAfter ?? []) {
      const qt = s.times.get(q);
      if (qt && t.openDay < qt.openDay)
        add('opens-before', p.id, `${p.id} opens before ${q} opens`);
    }
    const transitDeps = deps.filter((d) => TRANSIT_KINDS.includes(d.kind));
    if (p.kind === 'parking-conversion' && transitDeps.length === 0)
      add('parking-no-transit', p.id, `${p.id} depends on no transit project`);
    if (t.closeDay !== null) {
      if (transitDeps.length === 0)
        add('no-transit-dependency', p.id, `${p.id} closes to cars but depends on no transit`);
      for (const d of transitDeps) {
        const dt = s.times.get(d.id);
        if (dt && t.closeDay < dt.openDay)
          add('fillmore', p.id, `${p.id} closes to cars before ${d.id} opens`);
      }
    }
    if (t.build && t.availableDay !== null && t.build.startDay < t.availableDay)
      add('build-before-available', p.id, `${p.id} builds before its site is available`);

    if (p.kind === 'edge-garage' && 'project' in p.site) {
      const site = byId.get(p.site.project);
      const st = s.times.get(p.site.project);
      const ok =
        site &&
        st &&
        (site.kind === 'street-removal' || site.kind === 'highway-truncation') &&
        st.build === null &&
        st.availableDay !== null &&
        t.startDay >= st.availableDay;
      if (!ok)
        add(
          'garage-site',
          p.id,
          `${p.id} needs a removal or truncation with no build, and must start once it is available`
        );
    }
  }

  // A site is used once, except that one garage may stand on one truncation's freeway land.
  const sites = new Map<string, SiteUse[]>();
  for (const p of plan.projects) {
    for (const { key, use } of siteKeys(p)) {
      const seen = sites.get(key) ?? [];
      const pair = seen.length === 1 && [seen[0], use].sort().join() === 'freed,garage';
      if (seen.length > 0 && !pair) add('site-reused', p.id, `${p.id} reuses site ${key}`);
      sites.set(key, [...seen, use]);
    }
  }

  const stops = new Set<string>();
  for (const p of plan.projects) {
    if (p.kind !== 'transit-line') continue;
    for (const st of p.stops) {
      if (st.lngLat === null) continue;
      if (stops.has(st.id)) add('duplicate-stop', p.id, `stop ${st.id} is defined twice`);
      stops.add(st.id);
    }
  }

  const all = items(plan, s);
  for (const rule of plan.capacity) {
    const ofKind = all.filter((i) => i.kind === rule.kind);
    for (const i of ofKind) {
      const n = ofKind.filter((o) => o.start <= i.start && i.start < o.end).length;
      if (n > rule.maxConcurrent)
        add('capacity', i.project, `${rule.kind} has ${n} in progress, over ${rule.maxConcurrent}`);
    }
  }

  return problems.sort(
    (a, b) =>
      (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  );
}
