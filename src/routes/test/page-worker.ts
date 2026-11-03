// Page specs (`/`, `/p/:id`): a recording stand-in for the sim worker the page spawns through
// `new Worker(...)`, and a diff that carries a score, so a test can drive the header score and the
// Results face as the editor worker would.
import type { GeneratedUpdate } from '$lib/map/types';
import { score as computeScore, type Score } from '$lib/scoreboard';
import { building, parcel } from '$lib/scoreboard/score-fixtures';
import { M1_TARGETS } from '$lib/scoreboard/targets';
import type { SimResponse } from '$lib/sim/protocol';
import { FakeEditorWorker } from '$lib/brush/test/fake-editor-worker';

/** Every worker the page created, in order. Clear it per test. */
export const pageWorkers: FakeEditorWorker[] = [];

/** `vi.stubGlobal('Worker', PageWorker)`: each `new Worker(...)` is recorded in `pageWorkers`. */
export class PageWorker extends FakeEditorWorker {
  constructor() {
    super();
    pageWorkers.push(this);
  }
}

/** A score of `net` new homes on one vacant Mission parcel. */
export function scoreOf(net: number): Score {
  const p = parcel('8000001', 0, 'Mission');
  return computeScore([[p, building(p, net, true)]], M1_TARGETS);
}

/** The worker's diff after a load, carrying `score`. */
export function scoreDiff(score: Score, rev = 2): SimResponse {
  return {
    type: 'diff',
    rev,
    phase: 'load',
    render: { revision: 0 } as GeneratedUpdate,
    complete: true,
    score
  };
}
