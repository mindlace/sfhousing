// The Release 2 gate (finance-engine spec 6): fixture-0 carries a market model and a baseline
// funding, so the default run must fund at least one start. If this fails, look at the fixture's
// baseline funding, not the engine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeScenarioPayload } from '../../src/lib/data/scenario-codec';
import { HORIZON } from '../../src/lib/fzp/time';
import { buildSimInput } from '../../src/lib/sim/scenario/input';
import { simulateDetailed } from '../../src/lib/sim/scenario/simulate';
import { parseCalibration } from '../../src/lib/timelapse/model';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';

const DIR = join(__dirname, '../../e2e/fixtures/data/fixture-0/scenarios/fzp');
const json = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));

describe('fixture-0 funding', () => {
  it('runs with finance and funds at least one start on seed 1', () => {
    const parcels = decodeScenarioPayload(inflateRawSync(readFileSync(join(DIR, 'parcels.bin'))));
    const input = buildSimInput({
      parcels,
      projects: parseProjectsFile(json('projects.json')),
      calibration: parseCalibration(json('calibration.json'))
    });
    expect(input.finance).toBeDefined();
    const { schedules } = simulateDetailed(input, 1, HORIZON);
    expect(schedules.some((s) => s.funding !== undefined)).toBe(true);
  }, 120_000);
});
