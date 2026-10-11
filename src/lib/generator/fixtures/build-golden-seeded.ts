// Regenerates golden-seeded.json. Run deliberately, and commit the result with a reason:
//   npx tsx src/lib/generator/fixtures/build-golden-seeded.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../generate';
import { fnv1a32 } from '../seed';
import { synthParcels } from './synth';

export const GOLDEN_SEEDED_SEED = 20261010;
export const GOLDEN_SEEDED_COUNT = 200;

const cases = synthParcels(GOLDEN_SEEDED_COUNT, GOLDEN_SEEDED_SEED).map(({ parcel, S }) => ({
  parcel,
  S,
  out: generate(parcel, { maxStories: S }, fnv1a32(parcel.id), 'max')
}));
writeFileSync(
  fileURLToPath(new URL('./golden-seeded.json', import.meta.url)),
  JSON.stringify(cases) + '\n'
);
console.log(`wrote ${cases.length} cases, ${cases.filter((c) => c.out).length} non-null`);
