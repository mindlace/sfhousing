/**
 * Links PRJ records, permits, child records, reviews, completions and pipeline rows into projects
 * (spec 4.2). The graph is a union-find over node keys `R:<recordId>`, `P:<permit>` and
 * `L:<pipeline idx>`; children and reviews hang off their PRJ, completions off their permit.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';
import type { Child, LinkedProject, Parsed, Permit, PipelineRow, Prj, Review } from './types';
import { UnionFind } from './union-find';

export type { LinkedProject } from './types';

/** Permit statuses that end a permit (spec 4.2 Superseded permits). Lower-case. */
export const DEAD_STATUSES: ReadonlySet<string> = new Set([
  'withdrawn',
  'cancelled',
  'expired',
  'disapproved',
  'revoked'
]);

export interface LinkOptions {
  /** Candidate block-lots to current parcel ids (sorted unique). */
  resolve(blklots: string[]): ParcelId[];
  /** Task 5's `filedEvidenceDay`, injected so linking does not depend on stages. */
  filedDay(proj: LinkedProject): Day | null;
}

export interface LinkResult {
  /** Sorted by id. */
  projects: LinkedProject[];
  ppaLag: { days: number; n: number };
  excludedRows: PipelineRow[];
  counts: Record<string, number>;
}

const COUNT_KEYS = [
  'link.permitsMultiPrj',
  'link.satellites',
  'link.ppaAttached',
  'link.ppaOnly',
  'link.splitComponents',
  'link.pipelineOnly',
  'link.excludedRows',
  'link.orphanChildren',
  'link.pipelineNoIds'
];

interface Parts {
  anchors: Prj[];
  satellites: Prj[];
  children: Child[];
  sourceOnlyChildren: Child[];
  reviews: Review[];
  permits: Permit[];
  rows: PipelineRow[];
}

const emptyParts = (): Parts => ({
  anchors: [],
  satellites: [],
  children: [],
  sourceOnlyChildren: [],
  reviews: [],
  permits: [],
  rows: []
});

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ascending, null last. */
function cmpDay(a: Day | null, b: Day | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export function isDead(q: Permit): boolean {
  return DEAD_STATUSES.has(q.status);
}

/** Earliest `openDay` (null last); ties keep the first, i.e. the lowest id of an id-sorted list. */
function earliestOpen(prjs: readonly Prj[]): Prj | null {
  let best: Prj | null = null;
  for (const r of prjs) if (best === null || cmpDay(r.openDay, best.openDay) < 0) best = r;
  return best;
}

/**
 * PRJ a permit is assigned to: the latest opened on or before its filed day, else the earliest
 * opened. `named` is in ascending id, so ties go to the lowest id.
 */
function assignee(q: Permit, named: readonly Prj[]): Prj {
  const f = q.filedDay;
  let best: Prj | null = null;
  if (f !== null) {
    for (const r of named) {
      if (r.openDay === null || r.openDay > f) continue;
      if (best === null || r.openDay > best.openDay!) best = r;
    }
  }
  return best ?? earliestOpen(named)!;
}

/** Lead permit: site permit first, most proposed units, earliest filed, lowest number. */
function leadOf(permits: readonly Permit[]): Permit | null {
  const units = (a: number | null, b: number | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;
  const sorted = [...permits].sort(
    (a, b) =>
      Number(b.sitePermit) - Number(a.sitePermit) ||
      units(a.proposedUnits, b.proposedUnits) ||
      cmpDay(a.filedDay, b.filedDay) ||
      cmp(a.number, b.number)
  );
  return sorted[0] ?? null;
}

function sortedUnique(xs: Iterable<string | null>): string[] {
  const s = new Set<string>();
  for (const x of xs) if (x !== null) s.add(x);
  return [...s].sort(cmp);
}

/** A parcel id's block: its `^\d{4}[A-Z]?` prefix. */
function blockOf(id: ParcelId): string {
  return /^\d{4}[A-Z]?/.exec(id)?.[0] ?? id;
}

/** Builds a project (id left empty) from its parts; arrays are copied. */
function makeProject(
  kind: LinkedProject['kind'],
  parts: Parts,
  assignedTo: ReadonlyMap<string, Prj>,
  resolve: LinkOptions['resolve'],
  extraBlklots: (string | null)[] = []
): LinkedProject {
  const { anchors, permits, rows } = parts;
  const superseded = new Set<string>();
  for (const d of permits) {
    if (!isDead(d) || d.filedDay === null) continue;
    const filed = d.filedDay;
    if (permits.some((q) => q !== d && q.filedDay !== null && q.filedDay > filed)) {
      superseded.add(d.number);
    }
  }
  const live = permits.filter((q) => !isDead(q));
  const lead = leadOf(live.length > 0 ? live : permits);
  const leadPrj = lead ? assignedTo.get(lead.number) : undefined;
  const primary = anchors.find((a) => a === leadPrj) ?? earliestOpen(anchors);
  const permitLots = sortedUnique(permits.flatMap((q) => q.rows.map((r) => r.blklot)));
  const prjLots = sortedUnique([...anchors.map((a) => a.blklot), ...extraBlklots]);
  const blklots = sortedUnique([...permitLots, ...prjLots, ...rows.map((r) => r.blklot)]);
  // `pr.parcels.cross-block`: with a resolved permit address parcel, a parcel that only the PRJ's
  // (or PPA's) lot gives, on a block that holds no permit parcel, is dropped. Permit and pipeline
  // row parcels, and PRJ parcels on a permit block, stay.
  const permitParcels = resolve(permitLots);
  let parcelIds = resolve(blklots);
  const dropped: ParcelId[] = [];
  if (permitParcels.length > 0) {
    const permitBlocks = new Set(permitParcels.map(blockOf));
    const kept = new Set<ParcelId>([
      ...permitParcels,
      ...resolve(sortedUnique(rows.map((r) => r.blklot)))
    ]);
    for (const id of resolve(prjLots)) {
      if (!kept.has(id) && !permitBlocks.has(blockOf(id))) dropped.push(id);
    }
    if (dropped.length > 0) parcelIds = parcelIds.filter((id) => !dropped.includes(id));
  }
  return {
    id: '',
    kind,
    anchors: [...anchors],
    primary,
    satellites: [...parts.satellites],
    children: [...parts.children],
    sourceOnlyChildren: [...parts.sourceOnlyChildren],
    reviews: [...parts.reviews],
    permits: [...permits],
    live,
    superseded,
    lead,
    completions: [],
    pipelineRows: [...rows],
    blklots,
    parcelIds,
    crossBlock: { applies: permitParcels.length > 0, dropped }
  };
}

/**
 * A split part holding permits (spec 4.2 step 7): `graphId` gives it `PRJ:<primary>:BP:<lead>`,
 * and no other project id has that shape. A split remainder with no permits keeps `PRJ:<primary>`.
 */
export function isSplitPart(id: string): boolean {
  return /^PRJ:.+:BP:[^:]+$/.test(id);
}

/** `PRJ:<primary>`, `PRJ:<primary>:BP:<lead>` (split), else `BP:<lead>`. */
function graphId(proj: LinkedProject, split: boolean): string {
  const prj = proj.primary?.recordId;
  const lead = proj.lead?.number;
  if (prj !== undefined)
    return split && lead !== undefined ? `PRJ:${prj}:BP:${lead}` : `PRJ:${prj}`;
  if (lead !== undefined) return `BP:${lead}`;
  throw new Error('linked project has neither a PRJ nor a permit');
}

/**
 * Splits a component with two or more pipeline rows (spec 4.2 step 7): each permit a row names
 * becomes a project with its rows and the dead permits sharing a resolved parcel with it; the rest
 * stay with a remainder project, created only if it has permits or rows.
 */
function splitParts(c: Parts, resolve: LinkOptions['resolve']): Parts[] {
  if (c.rows.length < 2) return [c];
  const inComp = new Map(c.permits.map((q) => [q.number, q]));
  const groups = new Map<string, PipelineRow[]>();
  const rest: PipelineRow[] = [];
  for (const row of c.rows) {
    if (row.bpaNo !== null && inComp.has(row.bpaNo)) {
      const g = groups.get(row.bpaNo);
      if (g) g.push(row);
      else groups.set(row.bpaNo, [row]);
    } else {
      rest.push(row);
    }
  }
  if (groups.size === 0) return [c];
  const parcelMemo = new Map<string, Set<ParcelId>>();
  const parcelsOf = (q: Permit) => {
    let s = parcelMemo.get(q.number);
    if (!s) {
      s = new Set(resolve(sortedUnique(q.rows.map((r) => r.blklot))));
      parcelMemo.set(q.number, s);
    }
    return s;
  };
  const taken = new Set(groups.keys());
  const out: Parts[] = [];
  for (const n of [...groups.keys()].sort(cmp)) {
    const own = parcelsOf(inComp.get(n)!);
    const mine = new Set([n]);
    for (const q of c.permits) {
      if (taken.has(q.number) || !isDead(q)) continue;
      if ([...parcelsOf(q)].some((id) => own.has(id))) {
        taken.add(q.number);
        mine.add(q.number);
      }
    }
    out.push({ ...c, permits: c.permits.filter((q) => mine.has(q.number)), rows: groups.get(n)! });
  }
  const remaining = c.permits.filter((q) => !taken.has(q.number));
  if (remaining.length > 0 || rest.length > 0) out.push({ ...c, permits: remaining, rows: rest });
  return out;
}

/** Nearest-rank 90th percentile; `Infinity` when empty. */
function p90(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1];
}

export function linkProjects(p: Parsed, opts: LinkOptions): LinkResult {
  const counts: Record<string, number> = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
  const { resolve } = opts;

  // 1. PRJ <-> permit: candidate edges, assignment, anchors and satellites.
  const candidates = new Map<string, string[]>(); // recordId -> fetched permits it names
  const namedBy = new Map<string, Prj[]>(); // permit -> PRJs naming it, ascending id
  for (const prj of p.prjs.values()) {
    const named = sortedUnique(prj.permits).filter((n) => p.permits.has(n));
    candidates.set(prj.recordId, named);
    for (const n of named) {
      const list = namedBy.get(n);
      if (list) list.push(prj);
      else namedBy.set(n, [prj]);
    }
  }
  const assignedTo = new Map<string, Prj>();
  const anchorIds = new Set<string>();
  for (const [n, named] of namedBy) {
    if (named.length > 1) counts['link.permitsMultiPrj']++;
    const a = assignee(p.permits.get(n)!, named);
    assignedTo.set(n, a);
    anchorIds.add(a.recordId);
  }
  const satelliteIds = new Set<string>();
  for (const [id, named] of candidates) {
    if (named.length > 0 && !anchorIds.has(id)) satelliteIds.add(id);
  }
  counts['link.satellites'] = satelliteIds.size;

  // 2. Union-find graph. A satellite joins the component of the lowest permit it names.
  const uf = new UnionFind();
  for (const id of p.prjs.keys()) uf.add(`R:${id}`);
  for (const n of p.permits.keys()) uf.add(`P:${n}`);
  for (const [n, prj] of assignedTo) uf.union(`P:${n}`, `R:${prj.recordId}`);
  for (const id of satelliteIds) uf.union(`R:${id}`, `P:${candidates.get(id)![0]}`);

  const caseRows: PipelineRow[] = [];
  const graphRows: PipelineRow[] = [];
  const excludedRows: PipelineRow[] = [];
  for (const row of p.pipeline) {
    // A PRX case never names a PRJ (no base-case join). A PRX row whose bpa_no names a fetched
    // permit joins the graph like any row (spec 4.2 steps 4 and 9, Ruling F1); without one it is
    // a CASE:<caseNo> multi-phase master, even when its bpa_no resolves to nothing.
    const caseKey =
      !row.prx && row.caseNo !== null && p.prjs.has(row.caseNo) ? `R:${row.caseNo}` : null;
    const bpaKey = row.bpaNo !== null && p.permits.has(row.bpaNo) ? `P:${row.bpaNo}` : null;
    if (row.prx && bpaKey === null) {
      caseRows.push(row);
      continue;
    }
    if (caseKey !== null || bpaKey !== null) {
      const key = `L:${row.idx}`;
      uf.add(key);
      if (caseKey !== null) uf.union(key, caseKey);
      if (bpaKey !== null) uf.union(key, bpaKey);
      graphRows.push(row);
    } else if (row.bpaNo !== null) {
      excludedRows.push(row);
    } else if (row.caseNo !== null) {
      caseRows.push(row);
    } else {
      counts['link.pipelineNoIds']++;
    }
  }
  counts['link.excludedRows'] = excludedRows.length;

  // 3. Components, with children and reviews hung off their PRJ.
  const comps = new Map<string, Parts>();
  const comp = (key: string) => {
    const root = uf.find(key);
    let c = comps.get(root);
    if (!c) comps.set(root, (c = emptyParts()));
    return c;
  };
  for (const prj of p.prjs.values()) {
    const c = comp(`R:${prj.recordId}`);
    (satelliteIds.has(prj.recordId) ? c.satellites : c.anchors).push(prj);
  }
  for (const q of p.permits.values()) comp(`P:${q.number}`).permits.push(q);
  for (const row of graphRows) comp(`L:${row.idx}`).rows.push(row);
  const unparented: Child[] = [];
  for (const ch of p.children) {
    if (ch.parentId !== null && p.prjs.has(ch.parentId)) {
      const c = comp(`R:${ch.parentId}`);
      (satelliteIds.has(ch.parentId) ? c.sourceOnlyChildren : c.children).push(ch);
    } else if (ch.type === 'PPA') {
      unparented.push(ch);
    } else {
      counts['link.orphanChildren']++;
    }
  }
  for (const rv of p.reviews) {
    if (p.prjs.has(rv.recordId) && !satelliteIds.has(rv.recordId)) {
      comp(`R:${rv.recordId}`).reviews.push(rv);
    }
  }

  // 4. Graph projects (split where needed) and their ids.
  const graph: LinkedProject[] = [];
  for (const c of comps.values()) {
    const parts = splitParts(c, resolve);
    if (parts.length > 1) counts['link.splitComponents']++;
    for (const part of parts) {
      const proj = makeProject('graph', part, assignedTo, resolve);
      proj.id = graphId(proj, parts.length > 1);
      graph.push(proj);
    }
  }
  graph.sort((a, b) => cmp(a.id, b.id));

  // 5. ppaLag over parented PPAs (each counted once), then attach unparented PPAs.
  const filed = new Map<LinkedProject, Day | null>();
  for (const proj of graph) filed.set(proj, opts.filedDay(proj));
  const seen = new Set<Child>();
  const lags: number[] = [];
  for (const proj of graph) {
    const f = filed.get(proj)!;
    if (f === null) continue;
    for (const ch of proj.children) {
      if (ch.type !== 'PPA' || ch.openDay === null || seen.has(ch)) continue;
      seen.add(ch);
      lags.push(f - ch.openDay);
    }
  }
  const ppaLag = { days: p90(lags), n: lags.length };

  const byBlklot = new Map<string, LinkedProject[]>();
  const byParcel = new Map<ParcelId, LinkedProject[]>();
  const index = <K>(m: Map<K, LinkedProject[]>, k: K, proj: LinkedProject) => {
    const list = m.get(k);
    if (list) list.push(proj);
    else m.set(k, [proj]);
  };
  for (const proj of graph) {
    for (const b of proj.blklots) index(byBlklot, b, proj);
    for (const id of proj.parcelIds) index(byParcel, id, proj);
  }
  const childOrder = new Map<Child, number>(p.children.map((ch, i) => [ch, i]));
  const touched = new Set<LinkedProject>();
  const ppaOnly: LinkedProject[] = [];
  for (const ppa of unparented) {
    let best: LinkedProject | null = null;
    let bestDay = Infinity;
    if (ppa.openDay !== null && ppa.blklot !== null) {
      const open = ppa.openDay;
      const near = new Set([
        ...(byBlklot.get(ppa.blklot) ?? []),
        ...resolve([ppa.blklot]).flatMap((id) => byParcel.get(id) ?? [])
      ]);
      for (const proj of near) {
        const f = filed.get(proj)!;
        if (f === null || f < open || f > open + ppaLag.days) continue;
        if (best === null || f < bestDay || (f === bestDay && cmp(proj.id, best.id) < 0)) {
          best = proj;
          bestDay = f;
        }
      }
    }
    if (best !== null) {
      best.children.push(ppa);
      touched.add(best);
      counts['link.ppaAttached']++;
    } else {
      const proj = makeProject(
        'ppaOnly',
        { ...emptyParts(), children: [ppa] },
        assignedTo,
        resolve,
        [ppa.blklot]
      );
      proj.id = `PPA:${ppa.recordId}`;
      ppaOnly.push(proj);
      counts['link.ppaOnly']++;
    }
  }
  for (const proj of touched) {
    proj.children.sort((a, b) => childOrder.get(a)! - childOrder.get(b)!);
  }

  // 6. Pipeline-only projects, completions, ids.
  const pipelineOnly = caseRows.map((row) => {
    const proj = makeProject('pipelineOnly', { ...emptyParts(), rows: [row] }, assignedTo, resolve);
    proj.id = `CASE:${row.caseNo}`;
    return proj;
  });
  counts['link.pipelineOnly'] = pipelineOnly.length;

  const byPermit = new Map<string, LinkedProject>();
  for (const proj of graph) for (const q of proj.permits) byPermit.set(q.number, proj);
  for (const c of p.completions) byPermit.get(c.permit)?.completions.push(c);

  const projects = [...graph, ...pipelineOnly, ...ppaOnly].sort((a, b) => cmp(a.id, b.id));
  for (let i = 1; i < projects.length; i++) {
    if (projects[i].id === projects[i - 1].id) {
      throw new Error(`duplicate project id ${projects[i].id}`);
    }
  }
  return { projects, ppaLag, excludedRows, counts };
}
