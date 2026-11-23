import path from 'node:path';

const PIPELINE_DIR = import.meta.dirname;

/**
 * The freeway-land catalog (`pipeline/lib/lesscars/freeway-land.ts`): live, and the mini fixture's.
 */
export const LESSCARS_FREEWAY_LAND_JSON = {
  live: path.join(PIPELINE_DIR, 'enrichment/lesscars/freeway-land.json'),
  fixture: path.join(PIPELINE_DIR, 'test/fixtures/mini/enrichment/lesscars-freeway-land.json')
};
