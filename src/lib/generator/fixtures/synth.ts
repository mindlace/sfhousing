import type { ParcelRecord } from '../../data/parcel';
import { mulberry32 } from '../seed';
import { lRing, rectRing, ringArea, rotateRing, type Ring } from './geom';

export interface SynthCase {
  parcel: ParcelRecord;
  S: number;
}

const S_CHOICES = [1, 2, 3, 3, 4, 5, 5, 6, 8, 10, 12, 15, 24, 40, 80];
const UNIT_CHOICES = [0, 1, 1, 1, 2, 3];
const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

/**
 * Seeded SF-like mix: 70% 25×100 ft lots, 25% 400–3,000 m² lots, 5% irregular (L-shapes),
 * every one rotated by a random angle, at mixed painted S. No transcendental Math.
 */
export function synthParcels(n: number, seed: number): SynthCase[] {
  const r = mulberry32(seed);
  const out: SynthCase[] = [];
  for (let i = 0; i < n; i++) {
    const k = r();
    let ring: Ring;
    if (k < 0.7) {
      ring = rectRing(7.62, 30.48);
    } else if (k < 0.95) {
      const area = 400 + 2600 * r();
      const aspect = 1 + 1.5 * r();
      const w = Math.sqrt(area / aspect);
      ring = rectRing(w, area / w);
    } else {
      const w = 15 + 30 * r();
      const h = 15 + 30 * r();
      ring = lRing(w, h, w * (0.3 + 0.3 * r()), h * (0.3 + 0.3 * r()));
    }
    ring = rotateRing(ring, 2 * r() - 1, r() < 0.5);
    const S = S_CHOICES[Math.floor(r() * S_CHOICES.length)];
    const units = UNIT_CHOICES[Math.floor(r() * UNIT_CHOICES.length)];
    const fa =
      units === 0 ? (r() < 0.5 ? 0 : Math.round(400 * r())) : units * (80 + Math.round(60 * r()));
    const height = fa === 0 ? 0 : 3 + Math.round(9 * r());
    out.push({
      parcel: {
        id: String(9000000 + i),
        polygon: [ring],
        labelPoint: [r7(-122.51 + 0.14 * r()), r7(37.71 + 0.1 * r())],
        areaM2: ringArea(ring),
        existingUnits: units,
        existingFloorAreaM2: fa,
        existingHeightM: height,
        landUse: units > 0 ? 'RESIDENTIAL' : 'COMMERCIAL',
        eligible: true,
        neighborhood: 'Synthetic'
      },
      S
    });
  }
  return out;
}
