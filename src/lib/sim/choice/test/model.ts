// Test fixtures for the choice: the shipped price step from PROTOTYPES, the raw height-time pull
// and models and tables built from them.
import { optionTableOf, type OptionTable } from '../../../data/option-table';
import { PROTOTYPES } from '../../finance/prototypes';
import type {
  BuildingForm,
  BuildingType,
  ChoiceModel,
  HeightTimeModel,
  HeightTimeStep,
  Option,
  PriceStep
} from '../types';

export const opt = (
  type: BuildingType,
  form: BuildingForm,
  stories: number,
  homes: number
): Option => ({ type, form, stories, homes, plates: form === 'tower' ? 1 : 0 });

export const shippedPrices = (): PriceStep => ({
  anchors: Object.fromEntries(
    PROTOTYPES.map((p) => [
      p.id,
      {
        stories: p.stories,
        homes: p.homes,
        costPerHome: p.costPerHome,
        valuePerHome: p.costPerHome - p.shortfallPerHome
      }
    ])
  ) as PriceStep['anchors'],
  aboveTopCostRatio: 1.39,
  carrying: { rate: 0.085, drawn: 0.55 }
});

/** `p` with Type I's anchors (C and D) costing `factor` times as much per home. */
export function typeICostTimes(p: PriceStep, factor: number): PriceStep {
  const scale = (a: PriceStep['anchors']['C']) => ({ ...a, costPerHome: a.costPerHome * factor });
  return { ...p, anchors: { ...p.anchors, C: scale(p.anchors.C), D: scale(p.anchors.D) } };
}

const prov = { tier: 4 as const, label: 'test fixture, invented', sources: [], method: 'test' };

export function choiceModel(choiceSpread: number, prices = [{ from: 0, value: shippedPrices() }]) {
  const m: ChoiceModel = {
    prices,
    choiceSpread,
    affordableRule: 'most-homes',
    provenance: {
      anchors: prov,
      aboveTopCostRatio: prov,
      carrying: prov,
      choiceSpread: prov,
      affordableRule: prov,
      locationValue: prov
    }
  };
  return m;
}

const time: HeightTimeStep = {
  permitIssued: [1, 1, 1, 1, 1],
  construction: [1, 1, 1, 1, 1],
  constructionMonths: [26.2, 29.3, 28.6, 27.4, 34.7]
};
export const heightTime: HeightTimeModel = {
  upTo: [4, 7, 12, 20, 999],
  steps: [{ from: 0, value: time }],
  provenance: prov
};

export function table(rows: { options: Option[]; locationValue: number }[]): OptionTable {
  return optionTableOf('test', rows);
}
