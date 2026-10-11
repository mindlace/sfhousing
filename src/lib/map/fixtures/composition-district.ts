import type { ParcelRecord } from '../../data/parcel';
import { generate, fnv1a32, type GeneratedBuilding } from '../../generator';
import { compositionParcel } from '../../generator/fixtures/composition-parcel';
import { lRing, rectRing } from '../../generator/fixtures/geom';

/** Real generated buildings on standard, broad, concave and excluded parcel domains. */
export function compositionDistrict(
  seed: number,
  stories: number
): { parcels: ParcelRecord[]; buildings: GeneratedBuilding[] } {
  const parcels: ParcelRecord[] = [],
    buildings: GeneratedBuilding[] = [];
  for (let i = 0; i < 64; i++) {
    const wide = stories >= 13;
    const p = compositionParcel(`district-${seed}-${i}`, wide ? 60 : 30, wide ? 50 : 30);
    if (i % 8 === 0) p.polygon = [rectRing(7.62, 30.48)];
    if (i % 8 === 1)
      p.polygon = [lRing(wide ? 60 : 30, wide ? 50 : 30, wide ? 20 : 10, wide ? 20 : 10)];
    if (i % 8 === 2) p.polygon.push(rectRing(8, 8));
    p.labelPoint = [
      -122.4194 + ((i % 8) - 3.5) * (wide ? 0.00079 : 0.000385),
      37.7749 + (Math.floor(i / 8) - 3.5) * (wide ? 0.00054 : 0.000324)
    ];
    parcels.push(p);
    const b = generate(p, { maxStories: stories }, fnv1a32(p.id), 'max');
    if (b) buildings.push(b);
  }
  return { parcels, buildings };
}
