/**
 * Smoke test that the simulation engine runs from pipeline code under Node (tsx), as the lesscars
 * step does: seed 1 on the mini city with one regime, printing the schedule count and how many
 * simulated schedules ran on the regime's view. Run by pipeline/test/engine-node.test.ts.
 *
 * Node resolution (lesscars plan 1 Task 4, for docs/dev/lesscars.md): fallback (1) was enough.
 * tsx resolves the engine's `$lib` imports through the root tsconfig.json, which extends
 * .svelte-kit/tsconfig.json and its `$lib` paths (as scripts/bench-levers.ts already relies on);
 * no resolve hook and no headless browser were needed. It needs `svelte-kit sync` to have run
 * (npm install's prepare does it).
 */
import { parseCalibration } from '../../../src/lib/timelapse/model';
import { parseProjectsFile } from '../../../src/lib/timelapse/projects';
import { dayOf } from '../../../src/lib/sim/scenario/dates';
import miniCalibrationJson from '../../../src/lib/sim/scenario/fixtures/mini-calibration.json';
import { miniCity } from '../../../src/lib/sim/scenario/fixtures/mini-parcels';
import { miniProjectsJson } from '../../../src/lib/sim/scenario/fixtures/mini-projects';
import { buildSimInput } from '../../../src/lib/sim/scenario/input';
import { simulate } from '../../../src/lib/sim/scenario/simulate';
import type { SimInput } from '../../../src/lib/sim/scenario/types';

const parcels = miniCity().parcels;
const base = buildSimInput({
  parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown)
});
const input: SimInput = {
  ...base,
  regimes: [{ day: dayOf(2032, 1, 31), parcels: { ...parcels } }]
};
const schedules = simulate(input, 1, dayOf(2050, 12, 31));
const regime1 = schedules.filter((s) => s.regime === 1).length;
process.stdout.write(JSON.stringify({ schedules: schedules.length, regime1 }) + '\n');
