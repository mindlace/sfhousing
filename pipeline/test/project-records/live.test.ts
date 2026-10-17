/**
 * Opt-in check of a real (non-fixture) build. Skipped unless `pipeline/out/<version>/report.json`
 * exists for a version that is not `fixture-<n>`; run `npm run pipeline -- build` first. Also
 * skipped when the newest such report predates project-records (no `projects.inFlight` count).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OUT = fileURLToPath(new URL('../../out', import.meta.url));

interface LiveReport {
  datasetVersion: string;
  counts: Record<string, number>;
  invariants: { id: string; ok: boolean; detail?: string }[];
}

function findLiveReport(): LiveReport | null {
  if (!existsSync(OUT)) return null;
  const versions = readdirSync(OUT)
    .filter((v) => !/^fixture-\d+$/.test(v))
    .sort()
    .reverse();
  for (const v of versions) {
    const path = join(OUT, v, 'report.json');
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as LiveReport;
  }
  return null;
}

const found = findLiveReport();
/** The newest live report, only when it has project-records counts. */
const report = found !== null && 'projects.inFlight' in found.counts ? found : null;

describe.skipIf(report === null)('live project-records build', () => {
  const inv = (id: string) => report?.invariants.find((i) => i.id === id);

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
});
