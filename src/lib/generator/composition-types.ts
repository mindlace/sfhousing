import type { PathsD, PathD } from 'clipper2-ts';
import type { TypologyId } from './types';
export type CompositionId =
  'simple' | 'terrace' | 'divided' | 'slab' | 'shouldered' | 'offset' | 'paired';
export interface FloorBand {
  firstFloor: number;
  floors: number;
  regions: PathsD;
}
export interface OccupiedComposition {
  family: CompositionId;
  typology: TypologyId;
  stories: number;
  bands: FloorBand[];
}
export interface CompositionDraws {
  familyOrder: CompositionId[];
  splitFraction: number;
  setbackM: number;
  shoulderFloors: 1 | 2;
  offsetSign: 1 | -1;
  capEnabled: boolean;
  tone: 0 | 1 | 2;
}
export interface RoofAccent {
  ring: PathD;
  baseM: number;
  topM: number;
  tone: 0 | 1 | 2;
}
