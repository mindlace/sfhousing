import {
  BOND_PRINCIPAL,
  FEDERAL_SUPPORT_AMOUNT_PROVENANCE,
  GENERAL_FUND_FY25,
  PUBLIC_BANK_HOUSING,
  REVOLVING_FUND_SIZE,
  STATE_DOUBLE_TERM_YEARS
} from '$lib/sim-page/funding-sources';
import { PRESETS, type PresetId } from '$lib/sim-page/timing';
import type { StopType } from '$lib/sim/levers/brushes';
import type { Provenance } from '$lib/timelapse/types';
import type { Grant, NodeLevel, TreeNode } from '../tree';
import { LADDER_YEARS } from './ladder-years';
import { PRICES } from './tuning';

/** Stages run 0 to STAGES: the rings of a five-rung ladder. */
export const STAGES = 4;

/** The ring of `stage` on a ladder of `rungs` rungs (at most five). */
export function ringOf(stage: number, rungs: number = LADDER_YEARS.length + 1): number {
  return Math.round((stage * (rungs - 1)) / STAGES);
}

/** A level before its price, which `PRICES` holds. */
export type Unpriced = Omit<NodeLevel, 'price'>;

export type CatalogueEntry = Omit<TreeNode, 'ring' | 'levels'> & {
  stage: number;
  levels: Unpriced[];
};

const source = (p: Provenance): TreeNode['source'] => ({
  text: p.label,
  href: p.sources[0]?.url ?? null
});

function presetOf(id: PresetId) {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined || !p.available) throw new Error(`preset ${id} is not available`);
  return p;
}

const presetSource = (id: PresetId, which: 'first' | 'last') => {
  const list = presetOf(id).provenance;
  return source(which === 'first' ? list[0] : list[list.length - 1]);
};

const level = (grant: Grant, step: string): Unpriced => ({ grant, step });

const TODAY = 'From today';
const TALLER = 'A higher height cap near transit.';
const FURTHER = 'Taller homes further from each stop.';

function permitting(
  id: string,
  preset: PresetId,
  line: string,
  after: string[],
  stage: number,
  which: 'first' | 'last'
): CatalogueEntry {
  return {
    id,
    branch: 'permitting',
    label: presetOf(preset).name,
    line,
    after,
    stage,
    levels: [level({ tag: 'preset', preset }, TODAY)],
    source: presetSource(preset, which)
  };
}

function stop(
  id: string,
  stopType: StopType,
  label: string,
  line: string,
  step: string,
  after: string[],
  stage: number
): CatalogueEntry {
  return {
    id,
    branch: 'zoning',
    label,
    line,
    after,
    stage,
    levels: [level({ tag: 'stop', stop: stopType }, step)],
    source: null
  };
}

function measure(
  id: string,
  label: string,
  line: string,
  after: string[],
  stage: number,
  p: Provenance
): CatalogueEntry {
  return {
    id,
    branch: 'money',
    label,
    line,
    after,
    stage,
    levels: [level({ tag: 'measure', preset: id }, TODAY)],
    source: source(p)
  };
}

const stories = (n: number) => level({ tag: 'stories', max: n }, `${n} stories`);
const reach = (m: number) =>
  level({ tag: 'reach', maxM: m }, `Within ${m.toLocaleString('en-US')} m`);
const radius = (px: number) => level({ tag: 'hands', what: 'radius', value: px }, `${px} px ring`);
const linger = (ms: number) => level({ tag: 'hands', what: 'linger', value: ms }, `${ms / 1000} s`);

const zoning = (
  id: string,
  label: string,
  line: string,
  after: string[],
  stage: number,
  levels: Unpriced[]
): CatalogueEntry => ({ id, branch: 'zoning', label, line, after, stage, levels, source: null });

const hands = (
  id: string,
  label: string,
  line: string,
  after: string[],
  stage: number,
  levels: Unpriced[]
): CatalogueEntry => ({ id, branch: 'hands', label, line, after, stage, levels, source: null });

export const CATALOGUE: readonly CatalogueEntry[] = [
  permitting(
    'sb423-clock',
    'sb423Clock',
    'Streamlined approvals meet the state deadline.',
    [],
    0,
    'first'
  ),
  permitting(
    'benchmark-permits',
    'benchmarkPermits',
    'Permit review takes 134 days, not 280.',
    ['sb423-clock'],
    1,
    'last'
  ),
  permitting(
    'no-discretionary',
    'noDiscretionary',
    'Projects that meet the code skip hearings.',
    ['sb423-clock'],
    2,
    'first'
  ),
  stop(
    'stop-rail',
    'regionalRail',
    'Homes near rail',
    'Taller homes near BART and Caltrain.',
    'Rail stations',
    [],
    0
  ),
  stop(
    'stop-metro',
    'metro',
    'Homes near Muni Metro',
    'Taller homes near Muni Metro stops.',
    'Muni Metro stops',
    ['stop-rail'],
    0
  ),
  zoning('taller-1', 'Mid-rise near transit', TALLER, ['stop-rail'], 0, [stories(6), stories(8)]),
  zoning('reach-1', 'Half a mile out', FURTHER, ['stop-rail'], 1, [reach(805)]),
  zoning('bands', 'Distance bands', 'A band you can set to its own height.', ['reach-1'], 1, [
    level({ tag: 'bands', max: 2 }, '2 bands'),
    level({ tag: 'bands', max: 3 }, '3 bands')
  ]),
  stop(
    'stop-rapid',
    'rapidBus',
    'Homes near Rapid buses',
    'Taller homes near Muni Rapid stops.',
    'Rapid bus stops',
    ['stop-metro'],
    2
  ),
  zoning('taller-2', 'High-rise near transit', TALLER, ['taller-1'], 2, [stories(12), stories(20)]),
  stop(
    'stop-frequent',
    'frequentBus',
    'Homes near frequent buses',
    'Taller homes near stops with a bus every 10 minutes.',
    'Frequent bus stops',
    ['stop-rapid'],
    3
  ),
  zoning('reach-2', 'A mile out', FURTHER, ['reach-1'], 3, [reach(1609)]),
  zoning('taller-3', 'Towers near transit', TALLER, ['taller-2'], 4, [stories(40), stories(80)]),
  zoning('reach-3', 'Two miles out', FURTHER, ['reach-2'], 4, [reach(3219)]),
  measure(
    'housing-bond',
    'A housing bond',
    'A City bond for affordable homes, repaid over 20 years.',
    [],
    0,
    BOND_PRINCIPAL.provenance
  ),
  measure(
    'general-revenue',
    'General revenue, yearly',
    'More City money for affordable homes each year for 30 years.',
    ['housing-bond'],
    1,
    GENERAL_FUND_FY25.provenance
  ),
  measure(
    'revolving-fund',
    'A revolving construction-loan fund',
    'A $100 million fund that lends to private builders.',
    ['housing-bond'],
    1,
    REVOLVING_FUND_SIZE.provenance
  ),
  measure(
    'public-bank',
    'The SF public bank, as planned',
    'Public bank loans to affordable housing.',
    ['general-revenue', 'revolving-fund'],
    2,
    PUBLIC_BANK_HOUSING.provenance
  ),
  measure(
    'federal-support',
    'Federal support from a year',
    'A yearly federal grant for ten years.',
    ['general-revenue'],
    2,
    FEDERAL_SUPPORT_AMOUNT_PROVENANCE
  ),
  measure(
    'state-double',
    'State money doubled from a date',
    "Twice today's state money for ten years.",
    ['federal-support'],
    3,
    STATE_DOUBLE_TERM_YEARS.provenance
  ),
  hands('hands-radius', 'Wider ring', 'Collect drops further from the pointer.', [], 0, [
    radius(64),
    radius(80),
    radius(96),
    radius(120)
  ]),
  hands(
    'hands-linger',
    'Longer drops',
    'Drops wait longer before they fade.',
    ['hands-radius'],
    1,
    [linger(5000), linger(6500), linger(8000)]
  ),
  hands(
    'hands-auto',
    'Collect everything',
    'Every drop is collected as it appears.',
    ['hands-linger'],
    4,
    [level({ tag: 'hands', what: 'auto' }, 'Every drop')]
  )
];

/** The tree's nodes: each at the ring its stage takes on the measured ladder, priced from PRICES. */
export const NODES: readonly TreeNode[] = CATALOGUE.map(({ stage, levels, ...n }) => {
  const prices = PRICES[n.id];
  if (prices === undefined || prices.length !== levels.length)
    throw new Error(`PRICES has no price for each level of ${n.id}`);
  return {
    ...n,
    ring: ringOf(stage),
    levels: levels.map((l, k) => ({ ...l, price: { home: prices[k] } }))
  };
});
