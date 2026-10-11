// Stress input at the renderer contract's limits; deliberately more complex than today's recipes.
import type { GeneratedBuilding } from '../../generator';
import { compositionParcel } from '../../generator/fixtures/composition-parcel';
import { normaliseSite } from '../../generator/site';
import { serializeComposition } from '../../generator/serialize';
import { unitsFor, bandsSupported } from '../../generator/bands';
import type { FloorBand, OccupiedComposition, RoofAccent } from '../../generator/composition-types';
import { floorTop } from '../../generator/massing';
import type { PathD } from 'clipper2-ts';
function roundedBox(x: number, y: number, w: number, h: number, n: 3 | 4): PathD {
  const r = 1;
  const corner =
    n === 3
      ? [
          [0, 1],
          [0.3, 0.3],
          [1, 0]
        ]
      : [
          [0, 1],
          [0.12, 0.55],
          [0.55, 0.12],
          [1, 0]
        ];
  const out: PathD = [];
  for (let k = 0; k < 4; k++)
    for (const [a, b] of corner) {
      const px = -w / 2 + a * r,
        py = -h / 2 + b * r;
      const q =
        k === 0
          ? { x: px, y: py }
          : k === 1
            ? { x: (-py * w) / h, y: (px * h) / w }
            : k === 2
              ? { x: -px, y: -py }
              : { x: (py * w) / h, y: (-px * h) / w };
      out.push({ x: x + q.x, y: y + q.y });
    }
  // The quarter turns above wind clockwise; reverse into the occupied CCW convention.
  return out.reverse();
}
export function worstComposition(): GeneratedBuilding {
  const parcel = compositionParcel('worst', 60, 50),
    site = normaliseSite(parcel.polygon, 0.4)!;
  const base = [
    [-13, -11],
    [13, -11],
    [13, 11],
    [-13, 11]
  ].map(([x, y]) => roundedBox(x, y, 24, 20, 3));
  const upper = [roundedBox(-13, -11, 14, 18, 3), roundedBox(13, 11, 14, 18, 3)];
  const top = [roundedBox(-13, -11, 12, 16, 3), roundedBox(13, 11, 12, 16, 3)];
  const bands: FloorBand[] = [
    { firstFloor: 1, floors: 5, regions: base },
    { firstFloor: 6, floors: 13, regions: upper },
    { firstFloor: 19, floors: 2, regions: top }
  ];
  const composition: OccupiedComposition = {
    family: 'paired',
    typology: 'tower',
    stories: 20,
    bands
  };
  if (!bandsSupported(bands)) throw new Error('unsupported stress fixture');
  const baseM = floorTop('tower', 20);
  const caps: RoofAccent[] = [
    roundedBox(-13, -11, 11.5, 15.5, 4),
    roundedBox(13, 11, 11.5, 15.5, 4)
  ].map((ring) => ({ ring, baseM, topM: baseM + 0.5, tone: 2 }));
  const output = serializeComposition(parcel, site, composition, caps, 0);
  if (!output) throw new Error('unserializable stress fixture');
  const area = Math.round(output.area * 10) / 10;
  return {
    parcelId: 'worst',
    source: 'user',
    typology: 'tower',
    composition: 'paired',
    parts: output.parts,
    stories: 20,
    units: unitsFor('tower', area),
    floorAreaM2: area,
    replacesExisting: true
  };
}
