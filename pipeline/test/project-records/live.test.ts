/**
 * Opt-in check of a real (non-fixture) build. Skipped unless `pipeline/out/<version>/report.json`
 * exists for a version that is not `fixture-<n>`; run `npm run pipeline -- build` first. Also
 * skipped when the newest such report predates project-records (no `projects.inFlight` count).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ProjectsFile } from '../../../src/lib/timelapse/projects';
import { QUALITY_RULES, checkQuality } from '../../lib/quality';
import { PROJECTS_JSON } from '../../steps/projects';

const OUT = fileURLToPath(new URL('../../out', import.meta.url));

interface LiveReport {
  datasetVersion: string;
  counts: Record<string, number>;
  warnings: string[];
  invariants: { id: string; ok: boolean; detail?: string }[];
}

function findLiveReport(): { dir: string; report: LiveReport } | null {
  if (!existsSync(OUT)) return null;
  const versions = readdirSync(OUT)
    .filter((v) => !/^fixture-\d+$/.test(v))
    .sort()
    .reverse();
  for (const v of versions) {
    const path = join(OUT, v, 'report.json');
    if (existsSync(path)) {
      return { dir: join(OUT, v), report: JSON.parse(readFileSync(path, 'utf8')) as LiveReport };
    }
  }
  return null;
}

const found = findLiveReport();
/** The newest live report, only when it has project-records counts. */
const report = found !== null && 'projects.inFlight' in found.report.counts ? found.report : null;

function day(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

describe.skipIf(report === null)('live project-records build', () => {
  const inv = (id: string) => report?.invariants.find((i) => i.id === id);
  const projects = () =>
    JSON.parse(readFileSync(join(found!.dir, PROJECTS_JSON), 'utf8')) as ProjectsFile;

  it('passes V21 (pipeline coverage)', () => {
    expect(inv('V21')?.ok, inv('V21')?.detail).toBe(true);
  });

  it('passes V22 (RHNA / Housing Inventory cross-check)', () => {
    expect(inv('V22')?.ok, inv('V22')?.detail).toBe(true);
  });

  it.each(['V20', 'V23', 'V24'])('passes %s when the report has it', (id) => {
    const r = inv(id);
    expect(r === undefined || r.ok, r?.detail).toBe(true);
  });

  it('has an in-flight total in the plausible band', () => {
    const units = report?.counts['projects.inFlightUnits'] ?? 0;
    expect(units).toBeGreaterThanOrEqual(40_000);
    expect(units).toBeLessThanOrEqual(100_000);
  });

  it('DQ-2: Freedom West is in flight from its Planning record (spec 4.2 step 10, AC-14)', () => {
    const p = projects().projects.find((x) => x.id === 'PRJ:2020-006887PRJ');
    expect(p, 'PRJ:2020-006887PRJ in flight').toBeDefined();
    expect(p).toMatchObject({ stage: 'filed', units: 2387, multiPhase: false });
    expect(p?.history.filed).toBe(day('2020-07-24'));
    expect(p?.quality).toContain('pr.pipeline.status-date-linked');
    expect(p?.sources).toContainEqual({
      dataset: '6jgi-cpb4',
      id: '2023-007911PRX',
      key: 'case_no'
    });
  });

  it('DQ-2: Flower Mart is counted in projects.excludedNoUnits and named (AC-14)', () => {
    expect(report?.counts['projects.excludedNoUnits']).toBeGreaterThanOrEqual(3532);
    expect(report?.warnings).toContain(
      '2026-000246PRX: linked to 2025-008569PRJ with no units; excluded'
    );
    expect(projects().projects.map((x) => x.id)).not.toContain('PRJ:2025-008569PRJ');
  });

  it('V30: no pr.* rule is above its failShare (AC-14)', () => {
    const pr = QUALITY_RULES.filter((r) => r.owner === 'project-records').map((r) => r.id);
    expect(pr.length).toBeGreaterThan(0);
    const { failures } = checkQuality(report!.counts, { shares: true });
    expect(failures.filter((f) => pr.some((id) => f.startsWith(`${id}:`)))).toEqual([]);
  });
});
