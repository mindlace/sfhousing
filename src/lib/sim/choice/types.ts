// Construction types, forms and the dated model inputs the developer's choice reads. Pure;
// relative imports only: the pipeline imports this file through timelapse/types.
import type { Day, Dollars, Provenance } from '../../timelapse/types';
import type { PrototypeId } from '../finance/prototypes';

/** Construction types modelled: V (wood frame), III (podium on wood), I (concrete or steel). */
export type BuildingType = 'V' | 'III' | 'I';
/** Codes 0, 1, 2. */
export const BUILDING_TYPES = ['V', 'III', 'I'] as const;

export type BuildingForm = 'plex' | 'walkup' | 'podium' | 'midrise' | 'block' | 'tower';
/** Codes 0 to 5. */
export const BUILDING_FORMS = ['plex', 'walkup', 'podium', 'midrise', 'block', 'tower'] as const;

/** Stories each type can be built to, inclusive. Type I's top is the physical maximum. */
export const TYPE_STORIES: Record<BuildingType, readonly [number, number]> = {
  V: [1, 6],
  III: [4, 8],
  I: [1, 80]
};
/** The Type I tower form starts here. */
export const TOWER_MIN_STORIES = 13;
export const TYPE_FORMS: Record<BuildingType, readonly BuildingForm[]> = {
  V: ['plex', 'walkup', 'podium'],
  III: ['podium', 'midrise'],
  I: ['midrise', 'block', 'tower']
};

export interface Option {
  type: BuildingType;
  form: BuildingForm;
  stories: number;
  homes: number;
  plates: number;
}

/** A value that holds from `from` until the next step's `from`. */
export interface DatedStep<T> {
  from: Day;
  value: T;
}

/** The last step with `from <= day`, or step 0 before the first. */
export function stepAt<T>(series: readonly DatedStep<T>[], day: Day): { index: number; value: T } {
  if (series.length === 0) throw new RangeError('stepAt needs a non-empty series');
  for (let i = 1; i < series.length; i++) {
    if (series[i].from < series[i - 1].from) throw new RangeError('stepAt needs sorted steps');
  }
  let index = 0;
  for (let i = 1; i < series.length; i++) if (series[i].from <= day) index = i;
  return { index, value: series[index].value };
}

export interface PriceStep {
  anchors: Record<
    PrototypeId,
    { stories: number; homes: number; costPerHome: Dollars; valuePerHome: Dollars }
  >;
  /** Cost per home above the top anchor, as a multiple of the top anchor's. */
  aboveTopCostRatio: number;
  carrying: { rate: number; drawn: number };
}

export interface ChoiceModel {
  prices: DatedStep<PriceStep>[];
  choiceSpread: number;
  affordableRule: 'most-homes' | 'market';
  provenance: Record<
    | 'anchors'
    | 'aboveTopCostRatio'
    | 'carrying'
    | 'choiceSpread'
    | 'affordableRule'
    | 'locationValue',
    Provenance
  >;
}

export interface HeightTimeStep {
  permitIssued: number[];
  construction: number[];
  constructionMonths: number[];
}

export interface HeightTimeModel {
  /** Band edges in stories; 999 is "any", fixed across steps. */
  upTo: number[];
  steps: DatedStep<HeightTimeStep>[];
  provenance: Provenance;
}
