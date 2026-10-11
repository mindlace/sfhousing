// Regenerates generated-small.json and parcels-small.json. Run deliberately:
//   npx tsx src/lib/map/fixtures/build-fixtures.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fnv1a32, generate, type GeneratedBuilding } from '../../generator';
import { synthParcels } from '../../generator/fixtures/synth';
import type { ParcelRecord } from '../../data/parcel';
import { TYPOLOGY_ORDER } from '../types';

const picked: { b: GeneratedBuilding; p: ParcelRecord }[] = [];
const counts = new Map<string, number>();
for (const { parcel, S } of synthParcels(5000, 20261010)) {
  const b = generate(parcel, { maxStories: S }, fnv1a32(parcel.id), 'max');
  if (!b) continue;
  const n = counts.get(b.typology) ?? 0;
  if (n >= 2) continue;
  // Keep a podium+tower (>= 2 parts) among the towers.
  if (b.typology === 'tower' && n === 1) {
    const have = picked.some((x) => x.b.typology === 'tower' && x.b.parts.length >= 2);
    if (!have && b.parts.length < 2) continue;
  }
  counts.set(b.typology, n + 1);
  picked.push({ b, p: parcel });
}
const missing = TYPOLOGY_ORDER.filter((t) => (counts.get(t) ?? 0) < 2);
const hasMulti = picked.some((x) => x.b.typology === 'tower' && x.b.parts.length >= 2);
if (missing.length || !hasMulti) {
  console.error(`missing typologies: ${missing.join(',')}; multi-part tower: ${hasMulti}`);
  process.exit(1);
}
const write = (name: string, x: unknown) =>
  writeFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    JSON.stringify(x, null, 2) + '\n'
  );
write(
  'generated-small.json',
  picked.map((x) => x.b)
);
write(
  'parcels-small.json',
  picked.map((x) => x.p)
);
console.log(`wrote ${picked.length} fixtures`);
