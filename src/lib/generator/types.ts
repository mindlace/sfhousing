import type { CompositionId } from './composition-types';
import type { ParcelId } from '../data/parcel';

/** I10 */
export type TypologyId = 'adu' | 'plex' | 'walkup' | 'podium' | 'midrise' | 'tower';
/** I7 — M1 supports only 'max'; 'likely' is reserved for M2. */
export type BuildoutMode = 'max';
export type ReplacementTypology = Exclude<TypologyId, 'adu'>;

/** I9 */
export interface GeneratedBuilding {
  parcelId: ParcelId;
  source: 'user' | 'pipeline' | 'scenario';
  typology: TypologyId;
  composition: CompositionId;
  parts: {
    footprint: [lng: number, lat: number][] /* simple outer ring; exclusions remain empty */;
    role: 'occupied' | 'roof';
    tone: 0 | 1 | 2;
    baseM: number;
    topM: number;
    /** District results only: index into `lots` of the lot this part belongs to. */
    lot?: number;
  }[] /* supported floor bands; siblings may have separate footprints; rendered ground-to-topM */;
  stories: number;
  units: number;
  floorAreaM2: number;
  replacesExisting: boolean;
  /** District results only (large-site massing §4.4): the built lots, in fill order. */
  lots?: { typology: TypologyId; stories: number; floorAreaM2: number }[];
}
