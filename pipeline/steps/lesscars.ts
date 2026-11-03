// /lesscars build step (docs/dev/lesscars.md; spec docs/superpowers/specs/2026-11-01-lesscars-design.md):
// parse and schedule the plan, check it (checkPlan, then the plan against this dataset), carve the
// freed land, build the dated regimes, run the paired plan/baseline futures and write
// scenarios/lesscars/{plan,sites,summary}.json and timeline.bin. Runs after the policy step: it
// reads parcels.bin, policy.bin, projects.json, calibration.json and transit.json from `outDir`,
// and pol_tod, parcels, src_streets and the scenario SQL tables from `db`.
//
// Builder's calls:
// - No plan file (the live build until the authored plan lands) writes nothing and adds no counts.
// - Every problem, the plan's own (checkPlan) and the dataset's, is collected and thrown as one
//   BuildError of `project.field: message` lines before the first file is written. A checkPlan
//   problem's field is its code (`hwy.fillmore: …`).
// - A stop id with the `lc:` prefix must be a stop a transit line of the plan places; any other
//   id must be a transit.json stop. Route ids are bare GTFS route ids (transit.json
//   `Pattern.routeId`), matched within the project's mode family (networkAt's RAISE_MODES), so a
//   route the project would raise nothing on fails.
// - A parking conversion is served when some stop of one of its direct transit dependencies is
//   within SQL_VARS.tod_half_m of the parcel's DataSF outline (geom_orig, EPSG:7131), the distance
//   pol_tod measures: a transit line's stops, a bus lane's stopIds, the stops of a tram priority's
//   routes in transit.json.
// - A parking build that adds no homes keeps its reservation (runs.ts) and is counted in
//   lesscars.sites.zero_gain_parking with a warning, not a failure (lesscars ruling 4).
// - Segment lines in plan.json are src_streets centrelines in [lng, lat], rounded to 1e-7°.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  LESSCARS_FORMAT,
  decodeTimelinePayload,
  encodeTimelinePayload,
  type LessCarsPlanFile,
  type LessCarsSitesFile
} from '../../src/lib/data/lesscars/codec';
import {
  NEW_STOP_PREFIX,
  TRANSIT_KINDS,
  parseLessCarsPlan,
  type LessCarsPlan,
  type PlanProject,
  type SegmentRef
} from '../../src/lib/data/lesscars/plan';
import { RAISE_MODES } from '../../src/lib/data/lesscars/network';
import { LESSCARS_HORIZON, checkPlan, schedulePlan } from '../../src/lib/data/lesscars/schedule';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { TransitNetwork } from '../../src/lib/data/transit';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import { buildSimInput } from '../../src/lib/sim/scenario/input';
import { parseCalibration } from '../../src/lib/timelapse/model';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import { SQL_VARS, type InvariantProfile } from '../config';
import { BuildError } from '../lib/build-error';
import { createTableFromRows, type Duck } from '../lib/duck';
import { buildRegimes } from '../lib/lesscars/regimes';
import {
  garageCosts,
  initiativeBuilds,
  lesscarsYearEnds,
  representativeTimeline,
  reservationsOf,
  runPairs,
  sourceOfRows,
  summarise
} from '../lib/lesscars/runs';
import { readFreedSites } from '../lib/lesscars/sites';
import { LESSCARS_FILES, POLICY_BIN } from '../lib/scenario-files';
import { LC } from '../lesscars-config';
import type { FreewayLandFile, FreewaySegment } from '../lib/lesscars/freeway-land';
import { CALIBRATION_JSON } from './calibration';
import { carveFreedLand, notNeighboursOf, removalsOf } from './lesscars-sql';
import { readPolicyBin } from './policy';
import { PROJECTS_JSON } from './projects';
import { PARCELS_BIN, readParcelsBin } from './scenario';

const FIXTURE_RE = /^fixture-\d+$/;
const DAY_MS = 86400000;
/**
 * Freed sites of a project with a build that no scheduled build uses: slivers whose envelope holds
 * no home (counted in `lesscars.sites.zero_yield`). A site a garage holds is not one.
 */
export function zeroYieldSites<
  S extends { siteId: string; projectId: string; heldBy: string | null }
>(sites: S[], withBuild: Set<string>, builds: { siteId: string; parcelRow: number | null }[]): S[] {
  const freedBuilt = new Set(builds.filter((b) => b.parcelRow === null).map((b) => b.siteId));
  return sites.filter(
    (s) => s.heldBy === null && withBuild.has(s.projectId) && !freedBuilt.has(s.siteId)
  );
}

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;
/** Published areas to the cm² (platform-stable; projection noise is far below it). */
const round2 = (x: number) => Math.round(x * 100) / 100;

const refCnns = (segments: readonly SegmentRef[]): string[] =>
  segments.flatMap((s) => ('cnn' in s ? s.cnn : []));

/** Every CNN the plan names, with the project or display naming it, projects first. */
const cnnsOf = (plan: LessCarsPlan): { owner: string; cnn: string }[] =>
  [
    ...plan.projects.map((p) => ({
      owner: p.id,
      cnns: 'segments' in p ? refCnns(p.segments) : []
    })),
    ...(plan.displays ?? []).map((d) => ({ owner: d.id, cnns: refCnns(d.segments) }))
  ].flatMap(({ owner, cnns }) => cnns.map((cnn) => ({ owner, cnn })));

/**
 * Stop points of a transit project, as `pol_tod` would see them: transit.json stops, and `lc:`
 * stops the plan places (`planStops`). Unknown ids are skipped (the id checks report them).
 */
function stopPointsOf(
  p: PlanProject,
  transit: TransitNetwork,
  planStops: ReadonlyMap<string, [number, number]>
): [number, number][] {
  const byId = new Map([...transit.stops.map((s) => [s.id, s.lngLat] as const), ...planStops]);
  if (p.kind === 'transit-line')
    return p.stops.flatMap((s) => {
      const ll = s.lngLat ?? byId.get(s.id);
      return ll ? [ll] : [];
    });
  if (p.kind === 'bus-lane')
    return p.stopIds.flatMap((id) => {
      const ll = byId.get(id);
      return ll ? [ll] : [];
    });
  if (p.kind === 'tram-priority') {
    const routes = new Set(p.routeIds);
    const modes = RAISE_MODES[p.kind];
    const idx = new Set<number>();
    for (const pat of transit.patterns)
      if (routes.has(pat.routeId) && modes.includes(pat.mode))
        for (const s of pat.stops) idx.add(s.stop);
    return [...idx].sort((a, b) => a - b).map((i) => transit.stops[i].lngLat);
  }
  return [];
}

/** The plan against this dataset (streets, stops, routes, parcels, parking service). */
async function dataProblems(
  db: Duck,
  plan: LessCarsPlan,
  parcels: ScenarioParcels,
  transit: TransitNetwork,
  freewayLand: FreewayLandFile | null
): Promise<string[]> {
  const out: string[] = [];
  const streetRows = await db.all<{ cnn: string }>(
    'SELECT DISTINCT cnn FROM src_streets WHERE cnn IS NOT NULL'
  );
  const cnns = new Set(streetRows.map((r) => r.cnn));
  const stopIds = new Set(transit.stops.map((s) => s.id));
  const routesIn = (kind: keyof typeof RAISE_MODES) =>
    new Set(
      transit.patterns.filter((x) => RAISE_MODES[kind].includes(x.mode)).map((x) => x.routeId)
    );
  const routeIds = { 'tram-priority': routesIn('tram-priority'), 'bus-lane': routesIn('bus-lane') };
  const planStops = new Map<string, [number, number]>();
  for (const p of plan.projects)
    if (p.kind === 'transit-line')
      for (const s of p.stops) if (s.lngLat !== null) planStops.set(s.id, s.lngLat);
  const stopProblem = (id: string): string | null => {
    if (id.startsWith(NEW_STOP_PREFIX))
      return planStops.has(id) ? null : `stop ${id} is placed by no transit line of the plan`;
    return stopIds.has(id) ? null : `stop ${id} is not in transit.json`;
  };
  const byId = new Map(plan.projects.map((p) => [p.id, p]));
  /** Catalog parcel → its segment. */
  const catalogSegment = new Map<string, FreewaySegment>();
  for (const seg of freewayLand?.segments ?? [])
    for (const id of seg.parcels) catalogSegment.set(id, seg);
  const parking: { project: PlanProject; parcel: string; deps: PlanProject[] }[] = [];

  for (const { owner, cnn } of cnnsOf(plan))
    if (!cnns.has(cnn)) out.push(`${owner}.segments: CNN ${cnn} is not in src_streets`);
  for (const p of plan.projects) {
    if (p.kind === 'transit-line')
      for (const s of p.stops) {
        const why = s.lngLat === null ? stopProblem(s.id) : null;
        if (why) out.push(`${p.id}.stops: ${why}`);
      }
    if (p.kind === 'bus-lane')
      for (const id of p.stopIds) {
        const why = stopProblem(id);
        if (why) out.push(`${p.id}.stopIds: ${why}`);
      }
    if (p.kind === 'bus-lane' || p.kind === 'tram-priority')
      for (const r of p.routeIds)
        if (!routeIds[p.kind].has(r))
          out.push(
            `${p.id}.routeIds: route ${r} has no ${RAISE_MODES[p.kind].join(' or ')} pattern ` +
              'in transit.json'
          );
    if (p.kind === 'highway-truncation' && p.freewayLand) {
      for (const id of p.freewayLand.parcels) {
        const row = parcels.index.get(id);
        if (row === undefined) {
          out.push(`${p.id}.freewayLand: parcel ${id} is not in parcels.bin`);
          continue;
        }
        const homes = parcels.existingUnits[row];
        if (homes !== 0)
          out.push(
            `${p.id}.freewayLand: parcel ${id} has ${homes} existing homes; the plan takes none`
          );
        const seg = catalogSegment.get(id);
        if (seg === undefined)
          out.push(
            `${p.id}.freewayLand: parcel ${id} is not freeway land in freeway-land.json; ` +
              'freeing it would count its homes twice'
          );
        else if (seg.removedBy !== p.id)
          out.push(
            `${p.id}.freewayLand: parcel ${id} is freeway land of ${seg.id}, ` +
              `removed by ${seg.removedBy ?? 'none'}`
          );
      }
      for (const e of p.freewayLand.excluded)
        if (!parcels.index.has(e.parcel))
          out.push(`${p.id}.freewayLand: parcel ${e.parcel} is not in parcels.bin`);
    }
    if (p.kind === 'parking-conversion' && catalogSegment.has(p.parcel))
      out.push(`${p.id}.parcel: parcel ${p.parcel} is freeway land; only a garage may stand on it`);
    let field: string | null = null;
    let id: string | null = null;
    if (p.kind === 'parking-conversion') [field, id] = ['parcel', p.parcel];
    else if (p.kind === 'edge-garage' && 'parcel' in p.site) [field, id] = ['site', p.site.parcel];
    if (field === null || id === null) continue;
    const row = parcels.index.get(id);
    if (row === undefined) {
      out.push(`${p.id}.${field}: parcel ${id} is not in parcels.bin`);
      continue;
    }
    const homes = parcels.existingUnits[row];
    if (homes !== 0)
      out.push(`${p.id}.${field}: parcel ${id} has ${homes} existing homes; the plan takes none`);
    if (p.kind === 'parking-conversion') {
      const deps = p.dependsOn
        .map((d) => byId.get(d))
        .filter((d): d is PlanProject => !!d && TRANSIT_KINDS.includes(d.kind));
      // No transit dependency at all is checkPlan's parking-no-transit.
      if (deps.length > 0) parking.push({ project: p, parcel: id, deps });
    }
  }

  if (parking.length > 0) {
    await createTableFromRows(
      db,
      'lc_chk_stop',
      [
        ['project_id', 'VARCHAR'],
        ['parcel_id', 'VARCHAR'],
        ['lng', 'DOUBLE'],
        ['lat', 'DOUBLE']
      ],
      parking.flatMap((k) =>
        k.deps.flatMap((d) =>
          stopPointsOf(d, transit, planStops).map(([lng, lat]) => [
            k.project.id,
            k.parcel,
            lng,
            lat
          ])
        )
      )
    );
    const near = await db.all<{ project_id: string; dist_m: number }>(
      `SELECT c.project_id,
              min(ST_Distance(p.geom_orig, ST_Transform(ST_Point(c.lng, c.lat), 'EPSG:4326',
                  'EPSG:7131', always_xy := true))) AS dist_m
       FROM lc_chk_stop c JOIN parcels p ON p.id = c.parcel_id
       GROUP BY c.project_id`
    );
    const dist = new Map(near.map((r) => [r.project_id, r.dist_m]));
    for (const k of parking) {
      const d = dist.get(k.project.id);
      if (d === undefined || d > SQL_VARS.tod_half_m)
        out.push(
          `${k.project.id}.dependsOn: no stop of ${k.deps.map((x) => x.id).join(', ')} is ` +
            `within ${SQL_VARS.tod_half_m} m of parcel ${k.parcel}`
        );
    }
  }
  return out;
}

/** cnn → [lng, lat] lines of every CNN the plan names (src_streets is EPSG:7131). */
async function segmentLines(db: Duck, plan: LessCarsPlan): Promise<LessCarsPlanFile['segments']> {
  const cnns = [...new Set(cnnsOf(plan).map((x) => x.cnn))].sort();
  const out: LessCarsPlanFile['segments'] = {};
  if (cnns.length === 0) return out;
  await createTableFromRows(
    db,
    'lc_seg_cnn',
    [['cnn', 'VARCHAR']],
    cnns.map((c) => [c])
  );
  const rows = await db.all<{ cnn: string; g: string }>(
    `SELECT s.cnn,
            ST_AsGeoJSON(ST_Transform(s.geom, 'EPSG:7131', 'EPSG:4326', always_xy := true)) AS g
     FROM src_streets s JOIN lc_seg_cnn c USING (cnn)
     ORDER BY s.cnn, ST_AsHEXWKB(s.geom)`
  );
  for (const r of rows) {
    const g = JSON.parse(r.g) as
      | { type: 'LineString'; coordinates: number[][] }
      | { type: 'MultiLineString'; coordinates: number[][][] };
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    (out[r.cnn] ??= []).push(
      ...lines.map((l) => l.map((p) => [round7(p[0]), round7(p[1])] as [number, number]))
    );
  }
  return out;
}

function readPlan(planPath: string): LessCarsPlan {
  try {
    return parseLessCarsPlan(JSON.parse(readFileSync(planPath, 'utf8')));
  } catch (e) {
    throw new BuildError(`lesscars: ${planPath} does not parse: ${(e as Error).message}`, {
      cause: e
    });
  }
}

/**
 * The /lesscars step. `planPath` null or a missing file: `written: false`, nothing written.
 * Otherwise throws BuildError listing every plan or data problem before writing, then writes the
 * four LESSCARS_FILES and returns the lesscars.* counts and warnings.
 */
export async function writeLessCars(a: {
  db: Duck;
  outDir: string;
  datasetVersion: string;
  records: { rec: ParcelRecord; cellId: string }[];
  planPath: string | null;
  profile: InvariantProfile;
  capDay: Day;
  /** The freeway-land catalog; null: no catalog. */
  freewayLand: FreewayLandFile | null;
}): Promise<{ written: boolean; counts: Record<string, number>; warnings: string[] }> {
  if (a.planPath === null || !existsSync(a.planPath))
    return { written: false, counts: {}, warnings: [] };
  const { db, outDir, datasetVersion } = a;
  const warnings: string[] = [];

  // ---- Parse, schedule, check ----
  const plan = readPlan(a.planPath);
  const schedule = schedulePlan(plan);
  const parcels = readParcelsBin(join(outDir, PARCELS_BIN));
  const transit = decodeTransit(JSON.parse(readFileSync(join(outDir, 'transit.json'), 'utf8')));
  const problems = [
    ...checkPlan(plan, schedule).map((p) => `${p.project}.${p.code}: ${p.message}`),
    ...(await dataProblems(db, plan, parcels, transit, a.freewayLand))
  ];
  if (problems.length > 0)
    throw new BuildError(
      `lesscars: plan ${plan.id} (${a.planPath}) has ${problems.length} problem(s):\n  ` +
        problems.join('\n  ')
    );

  // ---- Freed land, regimes, builds ----
  const policy = readPolicyBin(join(outDir, POLICY_BIN), parcels);
  const base = buildSimInput(
    {
      parcels,
      projects: parseProjectsFile(JSON.parse(readFileSync(join(outDir, PROJECTS_JSON), 'utf8'))),
      calibration: parseCalibration(
        JSON.parse(readFileSync(join(outDir, CALIBRATION_JSON), 'utf8'))
      )
    },
    (w) => warnings.push(`lesscars: ${w}`)
  );
  // buildRegimes reads pol_tod (the policy step) and lc_site (the carve): carve first.
  const removed = removalsOf(plan);
  await carveFreedLand(db, removed, notNeighboursOf(a.freewayLand, removed));
  const sites = await readFreedSites(db, a.capDay);
  const switchDay = Date.parse(LC.switchDay) / DAY_MS;
  const regimes = await buildRegimes({
    db,
    parcels,
    policy,
    records: new Map(a.records.map((r) => [r.rec.id, r.rec])),
    sites,
    base: transit,
    plan,
    schedule,
    switchDay,
    asOf: base.asOf,
    horizon: LESSCARS_HORIZON,
    capDay: a.capDay
  });
  const reservedFrom = reservationsOf(plan, schedule, parcels);
  const builds = initiativeBuilds(plan, schedule, sites, parcels, regimes);

  // ---- Paired runs ----
  const yearEnds = lesscarsYearEnds();
  const pairs = runPairs({
    base,
    regimes,
    reservedFrom,
    builds,
    source: sourceOfRows(parcels.count, reservedFrom, regimes.unlocked),
    seeds: a.profile.lesscarsSeeds,
    yearEnds,
    horizon: LESSCARS_HORIZON
  });
  const summary = summarise(pairs, {
    datasetVersion,
    planId: plan.id,
    switchDay,
    regimeDays: regimes.plan.map((g) => g.day),
    yearEnds,
    garageCost: garageCosts(plan, schedule, sites, regimes)
  });
  const timeline = representativeTimeline({
    base,
    regimes,
    reservedFrom,
    builds,
    seed: summary.representativeSeed,
    horizon: LESSCARS_HORIZON,
    datasetVersion
  });

  // ---- Files ----
  const planFile: LessCarsPlanFile = {
    format: LESSCARS_FORMAT,
    datasetVersion,
    plan,
    times: plan.projects.map((p) => schedule.times.get(p.id)!),
    segments: await segmentLines(db, plan)
  };
  const sitesFile: LessCarsSitesFile = {
    format: LESSCARS_FORMAT,
    datasetVersion,
    // The v1.1 keys only when non-empty, so a plan freeing no parcel writes the v1 file.
    sites: sites.map((s) => ({
      siteId: s.siteId,
      projectId: s.projectId,
      rec: s.rec,
      outline: s.outline,
      ...(s.parcels.length > 0 ? { parcels: s.parcels } : {}),
      ...(s.parcelM2 > 0 ? { parcelM2: round2(s.parcelM2) } : {}),
      ...(s.heldBy !== null ? { heldBy: s.heldBy } : {})
    }))
  };
  const payload = encodeTimelinePayload(timeline, parcels.id);
  const body = deflateRawSync(payload, { level: 9 });
  const write = (rel: string, data: string | Buffer) => {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), data);
  };
  write(LESSCARS_FILES.plan, JSON.stringify(planFile));
  write(LESSCARS_FILES.sites, JSON.stringify(sitesFile));
  write(LESSCARS_FILES.summary, JSON.stringify(summary));
  write(LESSCARS_FILES.timeline, body);
  // What was written decodes against this parcels.bin.
  decodeTimelinePayload(
    inflateRawSync(readFileSync(join(outDir, LESSCARS_FILES.timeline))),
    parcels
  );

  // ---- Counts ----
  const withBuild = new Set(
    plan.projects
      .filter((p) => (p.kind === 'highway-truncation' || p.kind === 'street-removal') && p.build)
      .map((p) => p.id)
  );
  const zeroYield = zeroYieldSites(sites, withBuild, builds);
  const parkingBuilt = new Set(builds.filter((b) => b.parcelRow !== null).map((b) => b.projectId));
  const zeroGain = plan.projects.filter(
    (p) => p.kind === 'parking-conversion' && !parkingBuilt.has(p.id)
  );
  if (zeroGain.length > 0)
    warnings.push(
      `lesscars: parking conversion(s) ${zeroGain.map((p) => p.id).join(', ')} add no homes ` +
        'at their envelope; their lots stay reserved'
    );
  let unlocked = 0;
  for (const u of regimes.unlocked) unlocked += u;
  // Freed land by origin, held sites aside (they get no homes).
  const open = sites.filter((s) => s.heldBy === null);
  const parcelM2 = open.reduce((t, s) => t + s.parcelM2, 0);
  const rowM2 = open.reduce((t, s) => t + s.rec.areaM2 - s.parcelM2, 0);
  const counts: Record<string, number> = {
    'lesscars.projects': plan.projects.length,
    'lesscars.sites': sites.length,
    'lesscars.sites.parcels': sites.filter((s) => s.parcelM2 > 0).length,
    'lesscars.sites.held': sites.length - open.length,
    'lesscars.freed_m2.parcels': Math.round(parcelM2),
    'lesscars.freed_m2.row': Math.round(rowM2),
    'lesscars.sites.zero_yield': zeroYield.length,
    'lesscars.sites.zero_gain_parking': zeroGain.length,
    'lesscars.regimes': regimes.plan.length,
    'lesscars.seeds': summary.seeds,
    'lesscars.extra_2068.mean': Math.round(summary.extra.mean[summary.extra.mean.length - 1]),
    'lesscars.unlocked_lots': unlocked,
    'lesscars.bytes.timeline_payload': payload.length
  };
  // Deflate bytes may differ across zlib builds, so fixture reports omit them (as policy.bin's).
  if (!FIXTURE_RE.test(datasetVersion)) counts['lesscars.bytes.timeline'] = body.length;
  return { written: true, counts, warnings };
}

/** The golden's canonical dump of a written timeline.bin, decoded against its parcels.bin. */
export function formatLessCarsTimelineDump(file: string, parcels: ScenarioParcels): string {
  const t = decodeTimelinePayload(inflateRawSync(readFileSync(file)), parcels);
  return JSON.stringify(t, null, 2) + '\n';
}
