import type { ParcelRecord } from '../../data/parcel';
import { rectRing, ringArea, type Ring } from './geom';
export function compositionParcel(
  id: string,
  widthM: number,
  depthM: number,
  holes: Ring[] = []
): ParcelRecord {
  return {
    id,
    polygon: [rectRing(widthM, depthM), ...holes],
    labelPoint: [-122.4194, 37.7749],
    areaM2: widthM * depthM - holes.reduce((a, r) => a + ringArea(r), 0),
    existingUnits: 0,
    existingFloorAreaM2: 0,
    existingHeightM: 0,
    landUse: 'RESIDENTIAL',
    eligible: true,
    neighborhood: 'Test'
  };
}
