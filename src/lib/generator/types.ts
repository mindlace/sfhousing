import type { ParcelId } from '../data/parcel';

/** I10 */
export type TypologyId = 'adu' | 'plex' | 'walkup' | 'podium' | 'midrise' | 'tower';
/** I7 — M1 supports only 'max'; 'likely' is reserved for M2. */
export type BuildoutMode = 'max';
export type ReplacementTypology = Exclude<TypologyId, 'adu'>;

/** I9 */
export interface GeneratedBuilding {
  parcelId: ParcelId;
  source: 'user' /* widens to 'pipeline' | 'scenario' later */;
  typology: TypologyId;
  parts: {
    footprint: [lng: number, lat: number][] /* single outer ring; parcel holes dropped in M1 */;
    baseM: number;
    topM: number;
  }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */;
  stories: number;
  units: number;
  floorAreaM2: number;
  replacesExisting: boolean;
}
