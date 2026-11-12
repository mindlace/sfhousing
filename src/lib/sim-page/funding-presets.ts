// The funding preset list (finance-levers spec 2026-11-09 section 4.7, F16). Page code: presets
// shape only a policy. Every number a preset presents as a fact is a named `Sourced` constant in
// `funding-sources.ts`; this module only places them. Presets carry placeholder ids
// `u-<presetId>-1`; `addPreset` assigns real ones. `valueSource` says where a stored value of a
// preset-made item comes from; `pastItems` finds what lies before the simulation starts.
import {
  MARKET_TERMS,
  PROTOTYPES,
  missingTerms,
  resolveTerms,
  uncoveredPerHome
} from '$lib/sim/finance';
import { FINANCE_LIMITS, LAST_DAY } from '$lib/sim/levers/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { inflowArrivals } from '$lib/sim/scenario/funding';
import { dayOf } from '$lib/sim/scenario/dates';
import type {
  Calibration,
  Day,
  Inflow,
  Instrument,
  Pool,
  Programme,
  Provenance
} from '$lib/timelapse/types';
import {
  type Evidence,
  BOND_PRINCIPAL,
  CITY_GRANT_SHARE_PROVENANCE,
  CITY_PER_HOME,
  FEDERAL_SUPPORT_AMOUNT_PROVENANCE,
  FEDERAL_SUPPORT_START_PROVENANCE,
  GENERAL_FUND_FY25,
  NEXT_FISCAL_START_PROVENANCE,
  POOL_KIND_DEFAULTS,
  PROP_C_SCHEDULE,
  PUBLIC_BANK_COST_SHARE,
  PUBLIC_BANK_HOUSING,
  REVOLVING_COST_SHARE,
  REVOLVING_FUND_SIZE,
  REVOLVING_RATE
} from './funding-sources';

export interface FundingPreset {
  id: string;
  label: string;
  description: string;
  group: 'city' | 'bank' | 'state' | 'federal';
  baselineScale: FinanceLevers['baselineScale'];
  pools: Pool[];
  programmes: Programme[];
  provenance: Provenance[];
  available: boolean;
  reason?: string;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const utcYear = (d: Day): number => new Date(d * 86_400_000).getUTCFullYear();

/** 1 July of the year after `asOf`'s UTC year. Tier 4 default date. */
export const nextFiscal = (asOf: Day): Day => dayOf(utcYear(asOf) + 1, 7, 1);
/** 1 January of the year after `asOf`'s UTC year. Tier 4 default date. */
export const nextCalendar = (asOf: Day): Day => dayOf(utcYear(asOf) + 1, 1, 1);

/**
 * The City's grant toward an affordable home: CITY_PER_HOME over the uncovered cost, from the
 * pool's first arrival, with `minHomes` and `tiers` of the baseline's first affordable programme.
 */
export function cityGrant(from: Day, base: Programme): Omit<Programme, 'id' | 'label' | 'pool'> {
  const share = round6(CITY_PER_HOME.value / uncoveredPerHome('affordable', PROTOTYPES[0]));
  return {
    reach: 'affordable',
    instrument: { kind: 'grant', share },
    from,
    to: null,
    minHomes: base.minHomes,
    tiers: base.tiers === null ? null : { ...base.tiers }
  };
}

const firstArrival = (inflows: Inflow[]): Day =>
  Math.min(...inflows.map((f) => (f.kind === 'once' ? f.day : f.from)));

const unavailable = (
  id: string,
  label: string,
  description: string,
  group: FundingPreset['group'],
  reason: string
): FundingPreset => ({
  id,
  label,
  description,
  group,
  baselineScale: [],
  pools: [],
  programmes: [],
  provenance: [],
  available: false,
  reason
});

const NO_MODEL = 'This data has no funding model.';

/** The presets, in display order, against the page's calibration. */
export function fundingPresets(cal: Calibration): FundingPreset[] {
  const asOf = cal.asOf;
  const bf = cal.baselineFunding;
  const hasModel = cal.market !== undefined && bf !== undefined;
  const fiscal = nextFiscal(asOf);
  const base = bf?.programmes.find((g) => g.reach === 'affordable');
  const statePool = bf?.pools.find((p) => p.kind === 'state');
  const federalPool = bf?.pools.find((p) => p.kind === 'federal');
  const terms = resolveTerms(MARKET_TERMS);
  /** The baseline programmes' `minHomes` and `tiers` provenance: the last entry (finance-data F12). */
  const baseProv = bf?.provenance.at(-1);
  const withBase = (list: Provenance[]): Provenance[] =>
    baseProv === undefined ? list : [...list, baseProv];

  const mk = (
    id: string,
    label: string,
    description: string,
    group: FundingPreset['group'],
    reasonOf: () => string | null,
    build: () => Pick<FundingPreset, 'baselineScale' | 'pools' | 'programmes' | 'provenance'>,
    /** Build the content even though the preset is held back, so certifying it is one flag. */
    keepContent = false
  ): FundingPreset => {
    const reason = reasonOf();
    if (reason !== null) {
      const held = unavailable(id, label, description, group, reason);
      return keepContent && base !== undefined ? { ...held, ...build() } : held;
    }
    return { id, label, description, group, available: true, ...build() };
  };

  const pool = (
    id: string,
    kind: Pool['kind'],
    label: string,
    inflows: Inflow[],
    extra: Partial<Pool> = {}
  ): Pool => ({
    id: `u-${id}-1`,
    kind,
    label,
    inflows,
    uncapped: false,
    debt: null,
    leverage: 1,
    ...extra
  });
  const programme = (
    id: string,
    label: string,
    poolId: string,
    parts: Omit<Programme, 'id' | 'label' | 'pool'>
  ): Programme => ({ id: `u-${id}-1`, label, pool: poolId, ...parts });

  const needsModel = (): string | null => (hasModel ? null : NO_MODEL);
  const needsGrantBase = (): string | null =>
    needsModel() ??
    (base === undefined ? 'This data has no affordable programme to copy shares from.' : null);
  const loanTerms = (inst: Instrument): string | null => {
    const missing = missingTerms(inst, terms);
    return missing.length === 0
      ? null
      : `The market terms this loan is valued against are not sourced: ${missing.join(', ')}`;
  };

  /** A City grant preset: one pool, one cityGrant programme. */
  const grantPreset = (
    id: string,
    label: string,
    description: string,
    poolLabel: string,
    programmeLabel: string,
    kind: Pool['kind'],
    inflows: Inflow[],
    extra: Partial<Pool>,
    provenance: Provenance[],
    reasonOf: () => string | null,
    keepContent = false
  ): FundingPreset =>
    mk(
      id,
      label,
      description,
      'city',
      reasonOf,
      () => {
        const p = pool(id, kind, poolLabel, inflows, extra);
        return {
          baselineScale: [],
          pools: [p],
          programmes: [
            programme(id, programmeLabel, p.id, cityGrant(firstArrival(inflows), base!))
          ],
          provenance: withBase([CITY_GRANT_SHARE_PROVENANCE, ...provenance])
        };
      },
      keepContent
    );

  const bank = POOL_KIND_DEFAULTS.bank;
  const loan = (costShare: number, rate: number): Instrument => ({
    kind: 'loan',
    costShare,
    rate,
    requiredReturn: null
  });
  const revolvingLoan = loan(REVOLVING_COST_SHARE.value, REVOLVING_RATE.value);
  const bankLoan = loan(PUBLIC_BANK_COST_SHARE.value, bank.loanRate.value ?? 0);

  const scalePreset = (
    id: string,
    label: string,
    description: string,
    group: 'state' | 'federal',
    kind: Pool['kind'],
    from: Day,
    scale: number
  ): FundingPreset => {
    const target = kind === 'state' ? statePool : federalPool;
    return mk(
      id,
      label,
      description,
      group,
      () => needsModel() ?? (target === undefined ? `This data has no ${kind} pool.` : null),
      () => ({
        baselineScale: [{ pool: target!.id, from, scale }],
        pools: [],
        programmes: [],
        provenance: []
      })
    );
  };

  const stateYearly = statePool?.inflows.find(
    (f): f is Extract<Inflow, { kind: 'yearly' }> => f.kind === 'yearly'
  );
  const goBondDebt = POOL_KIND_DEFAULTS.goBond.debt;

  return [
    grantPreset(
      'housing-bond',
      'A housing bond',
      "A City bond, repaid with interest over 20 years, that shares the City's part of each new affordable home with today's City money, so more homes get built while there are projects waiting for money; it needs a two-thirds vote.",
      'Housing bond',
      'Housing bond: grant toward an affordable home',
      'goBond',
      [{ kind: 'once', day: fiscal, dollars: BOND_PRINCIPAL.value }],
      { debt: goBondDebt?.value ? { ...goBondDebt.value } : null },
      [
        BOND_PRINCIPAL.provenance,
        ...(goBondDebt?.value ? [goBondDebt.provenance] : []),
        NEXT_FISCAL_START_PROVENANCE
      ],
      needsGrantBase
    ),
    grantPreset(
      'general-revenue',
      'General revenue, yearly',
      "More City general-fund money every year, shared with today's City money toward new affordable homes, so more homes get built each year while there are projects waiting for money.",
      'General revenue for housing',
      'General revenue: grant toward an affordable home',
      'generalRevenue',
      [{ kind: 'yearly', from: fiscal, to: null, dollarsPerYear: GENERAL_FUND_FY25.value }],
      {},
      [GENERAL_FUND_FY25.provenance, NEXT_FISCAL_START_PROVENANCE],
      needsGrantBase
    ),
    grantPreset(
      'htf-2026',
      'Housing Trust Fund increase (Proposition C, 2026)',
      'The Housing Trust Fund increase voters passed in November 2026, rising to $60 million more a year by 2034-35; it is not offered until the result is certified.',
      'Housing Trust Fund increase (Proposition C)',
      'Housing Trust Fund increase: grant toward an affordable home',
      'generalRevenue',
      PROP_C_SCHEDULE.value.map((f) => ({ ...f })),
      {},
      [PROP_C_SCHEDULE.provenance],
      () => 'Not yet certified (passed on early counts, November 2026).',
      true
    ),
    mk(
      'revolving-fund',
      'A revolving construction-loan fund',
      'A $100 million City fund that lends private builders a tenth of the building cost below the market rate until the building is finished; the saving on each home is small, so it adds only a few private starts, and the loan size is a guess, not from any source.',
      'city',
      () => loanTerms(revolvingLoan) ?? needsModel(),
      () => {
        const p = pool('revolving-fund', 'generalRevenue', 'Revolving construction-loan fund', [
          { kind: 'once', day: fiscal, dollars: REVOLVING_FUND_SIZE.value }
        ]);
        return {
          baselineScale: [],
          pools: [p],
          programmes: [
            programme(
              'revolving-fund',
              'Revolving fund: construction loan to private projects',
              p.id,
              {
                reach: 'market',
                instrument: { ...revolvingLoan },
                from: fiscal,
                to: null,
                minHomes: 0,
                tiers: null
              }
            )
          ],
          provenance: [
            REVOLVING_FUND_SIZE.provenance,
            REVOLVING_RATE.provenance,
            REVOLVING_COST_SHARE.provenance,
            NEXT_FISCAL_START_PROVENANCE
          ]
        };
      }
    ),
    mk(
      'public-bank',
      'The SF public bank, as planned',
      "The planned public bank's lending to affordable housing over its first five years at its planned rate; each loan saves a project little, so it stretches City money only slightly, and the loan size is a guess, not from any source.",
      'bank',
      () => loanTerms(bankLoan) ?? needsGrantBase(),
      () => {
        const p = pool(
          'public-bank',
          'bank',
          'Public bank (housing share)',
          PUBLIC_BANK_HOUSING.value.map((dollars, k): Inflow => ({
            kind: 'once',
            day: dayOf(utcYear(fiscal) + k, 7, 1),
            dollars
          })),
          { leverage: bank.leverage?.value ?? 1 }
        );
        const { instrument: _grant, ...shared } = cityGrant(firstArrival(p.inflows), base!);
        return {
          baselineScale: [],
          pools: [p],
          programmes: [
            programme(
              'public-bank',
              'Public bank: construction loan to affordable projects',
              p.id,
              { ...shared, instrument: { ...bankLoan } }
            )
          ],
          provenance: withBase([
            PUBLIC_BANK_HOUSING.provenance,
            ...(bank.leverage?.value !== null && bank.leverage ? [bank.leverage.provenance] : []),
            ...(bank.loanRate.value !== null ? [bank.loanRate.provenance] : []),
            PUBLIC_BANK_COST_SHARE.provenance,
            NEXT_FISCAL_START_PROVENANCE
          ])
        };
      }
    ),
    unavailable(
      'state-bond-2026',
      'State housing bond (Proposition 1, 2026)',
      "The state housing bond passed in November 2026; it is not offered because the result is not certified and San Francisco's share is not published, so to try an amount of your own, add a state source yourself.",
      'state',
      "Not yet certified, and San Francisco's share is not published."
    ),
    scalePreset(
      'state-off',
      'No state money from a date',
      'No state money from a date you choose, so new affordable homes are no longer fully paid for and far fewer of them start.',
      'state',
      'state',
      fiscal,
      0
    ),
    scalePreset(
      'state-double',
      'State money doubled from a date',
      "Twice today's state money from a date you choose; on its own this adds no homes while the City's money is the limit, so pair it with more City or federal money.",
      'state',
      'state',
      fiscal,
      2
    ),
    mk(
      'federal-support',
      'Federal support from a year',
      "A new yearly federal grant from a year you choose that pays the City's part of each affordable home while it lasts; no law provides it yet, so the amount is your own.",
      'federal',
      () =>
        needsGrantBase() ??
        (statePool === undefined
          ? 'This data has no state pool.'
          : stateYearly === undefined
            ? "This data's state pool has no yearly amount to start from."
            : null),
      () => {
        const from = dayOf(Math.max(2028, utcYear(asOf) + 1), 1, 1);
        const p = pool('federal-support', 'federal', 'Federal support', [
          {
            kind: 'yearly',
            from,
            to: null,
            dollarsPerYear: stateYearly!.dollarsPerYear
          }
        ]);
        return {
          baselineScale: [],
          pools: [p],
          programmes: [
            programme(
              'federal-support',
              'Federal support: grant toward an affordable home',
              p.id,
              cityGrant(from, base!)
            )
          ],
          provenance: withBase([
            CITY_GRANT_SHARE_PROVENANCE,
            FEDERAL_SUPPORT_AMOUNT_PROVENANCE,
            FEDERAL_SUPPORT_START_PROVENANCE
          ])
        };
      }
    ),
    scalePreset(
      'federal-credits-off',
      'Federal tax credits withdrawn from a date',
      'Federal tax credits withdrawn from a date you choose, which shows how few affordable homes start when the City and the state cannot cover what the credits paid.',
      'federal',
      'federal',
      nextCalendar(asOf),
      0
    ),
    unavailable(
      'regional-bond',
      'A regional bond',
      'A Bay Area housing bond; it is not offered until a measure is put to voters.',
      'state',
      'There is no regional measure yet.'
    )
  ];
}

/** The least positive n with neither `u-<presetId>-<n>` a pool id nor a programme id in `f`. */
export function nextAddedId(f: FinanceLevers, presetId: string): string {
  const used = new Set([...f.pools.map((p) => p.id), ...f.programmes.map((g) => g.id)]);
  let n = 1;
  while (used.has(`u-${presetId}-${n}`)) n++;
  return `u-${presetId}-${n}`;
}

/**
 * Adds a preset's scales, pools and programmes with fresh ids (one `n` shared by its pool and
 * programme), a scale entry replacing one on the same pool and day, and keeps `baselineScale`
 * sorted. Throws `RangeError` past a `FINANCE_LIMITS` bound.
 */
export function addPreset(f: FinanceLevers, p: FundingPreset): FinanceLevers {
  const id = nextAddedId(f, p.id);
  const idOf = new Map(p.pools.map((x) => [x.id, id]));
  const pools = [...f.pools, ...p.pools.map((x) => ({ ...structuredClone(x), id }))];
  const programmes = [
    ...f.programmes,
    ...p.programmes.map((g) => ({ ...structuredClone(g), id, pool: idOf.get(g.pool) ?? g.pool }))
  ];
  const baselineScale = [
    ...f.baselineScale.filter(
      (e) => !p.baselineScale.some((n) => n.pool === e.pool && n.from === e.from)
    ),
    ...p.baselineScale.map((e) => ({ ...e }))
  ].sort((a, b) => (a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : a.from - b.from));
  if (pools.length > FINANCE_LIMITS.pools)
    throw new RangeError(`at most ${FINANCE_LIMITS.pools} pools`);
  if (programmes.length > FINANCE_LIMITS.programmes)
    throw new RangeError(`at most ${FINANCE_LIMITS.programmes} programmes`);
  if (baselineScale.length > FINANCE_LIMITS.baselineScale)
    throw new RangeError(`at most ${FINANCE_LIMITS.baselineScale} scale entries`);
  return { ...f, baselineScale, pools, programmes };
}

type InflowKey = 'day' | 'from' | 'to' | 'dollars' | 'dollarsPerYear';
export type PoolField =
  'debt.rate' | 'debt.termYears' | 'leverage' | `inflows[${number}].${InflowKey}`;
export type ProgrammeField =
  | 'instrument.share'
  | 'instrument.costShare'
  | 'instrument.rate'
  | 'instrument.requiredReturn'
  | 'from'
  | 'to'
  | 'minHomes'
  | 'tiers';

const INFLOW_PATH = /^inflows\[(\d+)\]\.(\w+)$/;

/** The value at a field path of a pool or programme; undefined where the item has no such path. */
function valueAt(item: Pool | Programme, field: string): unknown {
  const inflow = INFLOW_PATH.exec(field);
  if (inflow) {
    if (!('inflows' in item)) return undefined;
    return (item.inflows[Number(inflow[1])] as unknown as Record<string, unknown> | undefined)?.[
      inflow[2]
    ];
  }
  const o = item as unknown as Record<string, unknown>;
  if (field.startsWith('debt.')) {
    return 'inflows' in item
      ? (item.debt as Record<string, unknown> | null)?.[field.slice(5)]
      : undefined;
  }
  if (field.startsWith('instrument.')) {
    return 'instrument' in item
      ? (item.instrument as unknown as Record<string, unknown>)[field.slice(11)]
      : undefined;
  }
  if (field === 'leverage') return 'inflows' in item ? item.leverage : undefined;
  if (['from', 'to', 'minHomes', 'tiers'].includes(field))
    return 'instrument' in item ? o[field] : undefined;
  return undefined;
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
};

const evidenceProv = (e: Evidence<unknown> | null): Provenance | null =>
  e !== null && 'provenance' in e ? e.provenance : null;

/** The provenance the field table of spec section 4.7 gives a preset's field, or null. */
function tableSource(
  presetId: string,
  preset: FundingPreset,
  item: Pool | Programme,
  field: string
): Provenance | null {
  const isPool = 'inflows' in item;
  const inflow = INFLOW_PATH.exec(field);
  const key = inflow?.[2];
  const cityGrantPreset = preset.programmes.some(
    (g) => g.instrument.kind === 'grant' && g.reach === 'affordable'
  );
  if (!isPool) {
    if (field === 'instrument.share' && cityGrantPreset) return CITY_GRANT_SHARE_PROVENANCE;
    if (
      (field === 'minHomes' || field === 'tiers') &&
      (cityGrantPreset || presetId === 'public-bank')
    )
      return preset.provenance.at(-1) ?? null;
    if (field === 'instrument.rate' && presetId === 'public-bank')
      return evidenceProv(POOL_KIND_DEFAULTS.bank.loanRate);
    return null;
  }
  switch (presetId) {
    case 'housing-bond':
      if (field === 'inflows[0].dollars') return BOND_PRINCIPAL.provenance;
      if (field === 'debt.rate' || field === 'debt.termYears')
        return evidenceProv(POOL_KIND_DEFAULTS.goBond.debt);
      return null;
    case 'general-revenue':
      return field === 'inflows[0].dollarsPerYear' ? GENERAL_FUND_FY25.provenance : null;
    case 'htf-2026':
      return inflow ? PROP_C_SCHEDULE.provenance : null;
    case 'revolving-fund':
      return field === 'inflows[0].dollars' ? REVOLVING_FUND_SIZE.provenance : null;
    case 'public-bank':
      if (inflow && key === 'dollars') return PUBLIC_BANK_HOUSING.provenance;
      if (field === 'leverage') return evidenceProv(POOL_KIND_DEFAULTS.bank.leverage);
      return null;
    default:
      return null;
  }
}

/**
 * Where a stored value of a preset-made pool or programme comes from: the field's provenance when
 * the id is `u-<presetId>-<n>` for a preset in `presets`, the spec's field table gives it a source
 * and the value still equals what the preset builds now; else `'custom'`.
 */
export function valueSource(
  item: Pool | Programme,
  field: PoolField | ProgrammeField,
  presets: FundingPreset[]
): Provenance | 'custom' {
  const preset = presets.find((p) => {
    const prefix = `u-${p.id}-`;
    return item.id.startsWith(prefix) && /^\d+$/.test(item.id.slice(prefix.length));
  });
  if (preset === undefined) return 'custom';
  const built = ('inflows' in item ? preset.pools : preset.programmes)[0];
  if (built === undefined) return 'custom';
  const source = tableSource(preset.id, preset, item, field);
  if (source === null) return 'custom';
  const stored = valueAt(item, field);
  const now = valueAt(built, field);
  return now !== undefined && sameValue(stored, now) ? source : 'custom';
}

/**
 * What lies before the simulation starts (spec 4.6): pools none of whose inflows arrive on or
 * after `asOf`, programmes whose `to` is before it, and inflows with no arrival on or after it,
 * each list in document order.
 */
export function pastItems(
  f: FinanceLevers,
  asOf: Day
): { pools: string[]; programmes: string[]; inflows: { pool: string; index: number }[] } {
  const past = (x: Inflow): boolean => inflowArrivals(x, asOf, LAST_DAY).length === 0;
  return {
    pools: f.pools.filter((p) => p.inflows.every(past)).map((p) => p.id),
    programmes: f.programmes.filter((g) => g.to !== null && g.to < asOf).map((g) => g.id),
    inflows: f.pools.flatMap((p) =>
      p.inflows.flatMap((x, index) => (past(x) ? [{ pool: p.id, index }] : []))
    )
  };
}
