// The Funding tab's edits, field checks, limits and drafts (funding-ui spec section 6,
// "funding-edit.spec.ts"). Every change is applied to a fragment policy and the result must pass
// `parseFinanceLevers`.
import { describe, expect, it } from 'vitest';
import { parseFinanceLevers } from '$lib/sim/levers/finance';
import { dayOf } from '$lib/sim/scenario/dates';
import type { Pool, Programme } from '$lib/timelapse/types';
import { fundingPresets, nextFiscal } from './funding-presets';
import { POOL_KIND_DEFAULTS } from './funding-sources';
import { programmeSentence, scaleLines, type Baseline } from './funding-view';
import type { SimPolicy } from './policy';
import {
  BOND_POLICY,
  FUND_ASOF,
  TERM_POLICY,
  fundingCalibration,
  policyWith
} from './test/funding';
import {
  addInflowEdit,
  addPoolEdit,
  addPresetEdit,
  addProgrammeEdit,
  addScaleEdit,
  clearTermEdit,
  completeDraft,
  fieldText,
  generatedName,
  isRefused,
  isUnchanged,
  limitProblem,
  newOwnPool,
  newProgramme,
  parseAmountMillions,
  parseLeverage,
  parseMinHomes,
  parseName,
  parsePercent,
  parseRateCutPoints,
  parseWholeYears,
  removeInflowEdit,
  removePoolEdit,
  removeProgrammeEdit,
  removeScaleEdit,
  renamePoolEdit,
  rescaleTiers,
  setDebtEdit,
  setInflowAmountEdit,
  setInflowDateEdit,
  setInflowKindEdit,
  setKindEdit,
  setLeverageEdit,
  setProgrammeEdit,
  setTermEdit,
  updatePoolDraft,
  type Draft,
  type FundingEdit,
  type Refused
} from './funding-edit';

const cal = fundingCalibration();
const baseline = cal.baselineFunding as Baseline;
const presets = fundingPresets(cal);
const preset = (id: string) => {
  const p = presets.find((x) => x.id === id && x.available);
  if (p === undefined) throw new Error(`no available preset ${id}`);
  return p;
};

function edit(e: FundingEdit | Refused): FundingEdit {
  if (isRefused(e)) throw new Error(`refused: ${e.refused}`);
  return e;
}

/** Applies the edit and checks the result parses. */
function run(e: FundingEdit | Refused, p: SimPolicy): SimPolicy {
  const next = edit(e).change(p);
  expect(() => parseFinanceLevers(next.funding, 'funding')).not.toThrow();
  return next;
}

const POOL: Omit<Pool, 'id'> = {
  kind: 'generalRevenue',
  label: 'City general fund, 2027',
  inflows: [{ kind: 'yearly', from: nextFiscal(FUND_ASOF), to: null, dollarsPerYear: 60_000_000 }],
  uncapped: false,
  debt: null,
  leverage: 1
};

const july = (y: number) => dayOf(y, 7, 1);

describe('funding edits', () => {
  it('labels and coalesce keys follow table 4.9', () => {
    const p = BOND_POLICY;
    const bond = p.funding.pools[0];
    const prog = p.funding.programmes[0];
    const rows: [FundingEdit | Refused, string, string | undefined][] = [
      [addPresetEdit(p, preset('housing-bond')), 'Added: A housing bond', undefined],
      [addPoolEdit(POOL), 'Added: your own pool', undefined],
      [removePoolEdit(p, bond.id), 'Removed: City bond, 2028 and its programme', undefined],
      [renamePoolEdit(p, bond.id, 'Big bond'), 'Renamed: Big bond', 'pool:u-pool-1:name'],
      [
        setKindEdit(p, bond.id, 'cop'),
        'Changed kind: City bond, 2028 is City lease financing (certificates of participation)',
        undefined
      ],
      [
        setInflowAmountEdit(p, bond.id, 0, 250_000_000),
        'Changed amount: City bond, 2028, row 1, $250 million',
        'pool:u-pool-1:in:1:amount'
      ],
      [
        setInflowKindEdit(p, bond.id, 0, 'yearly'),
        'Changed: City bond, 2028, row 1, every year',
        undefined
      ],
      [
        setInflowDateEdit(p, bond.id, 0, 'day', july(2029)),
        'Changed date: City bond, 2028, When July 2029',
        'pool:u-pool-1:in:1:day'
      ],
      [addInflowEdit(p, bond.id), 'Added money in: City bond, 2028', undefined],
      [
        setDebtEdit(p, bond.id, 'rate', 0.07),
        'Changed interest rate: City bond, 2028, 7%',
        'pool:u-pool-1:rate'
      ],
      [
        setDebtEdit(p, bond.id, 'termYears', 25),
        'Changed years to repay: City bond, 2028, 25 years',
        'pool:u-pool-1:termYears'
      ],
      [
        removeProgrammeEdit(p, baseline, prog.id),
        'Removed: Grant to affordable homes of 20 homes or more: 35% of the uncovered cost',
        undefined
      ],
      [
        setProgrammeEdit(
          p,
          baseline,
          prog.id,
          { instrument: { kind: 'grant', share: 0.4 } },
          'instrument.share'
        ),
        'Changed: Grant to affordable homes of 20 homes or more: 40% of the uncovered cost',
        'prog:u-prog-1:instrument.share'
      ],
      [
        setProgrammeEdit(p, baseline, prog.id, { reach: 'market', tiers: null }, 'reach'),
        'Changed: Grant to private projects of 20 homes or more: 35% of the uncovered cost',
        undefined
      ],
      [
        setProgrammeEdit(
          p,
          baseline,
          prog.id,
          { tiers: { veryLow: 0.5, low: 0.3, moderate: 0.2, aboveModerate: 0 } },
          'tiers'
        ),
        'Changed income mix: Grant to affordable homes of 20 homes or more: 35% of the uncovered cost',
        'prog:u-prog-1:tiers'
      ],
      [
        setProgrammeEdit(p, baseline, prog.id, { from: july(2029) }, 'from'),
        'Changed date: Grant to affordable homes of 20 homes or more, from July 2029: 35% of the ' +
          'uncovered cost, From July 2029',
        'prog:u-prog-1:from'
      ],
      [
        addScaleEdit(p, baseline, { group: 'state' }, july(2027), 0),
        "Today's funding: state switched off from July 2027",
        undefined
      ],
      [
        addScaleEdit(p, baseline, { group: 'federal' }, july(2027), 1),
        "Today's funding: federal switched back on from July 2027",
        undefined
      ],
      [
        addScaleEdit(p, baseline, { pool: 'city-gf' }, july(2027), 0.5),
        "Today's funding: city-gf 50% from July 2027",
        undefined
      ],
      [
        setTermEdit('guaranteeRateCut', 0.005),
        'Market term: guarantee rate cut 0.5 points',
        'term:guaranteeRateCut'
      ],
      [
        clearTermEdit(TERM_POLICY, 'guaranteeRateCut'),
        'Cleared market term: guarantee rate cut',
        undefined
      ]
    ];
    for (const [e, label, coalesce] of rows) {
      const ed = edit(e);
      expect(ed.label).toBe(label);
      expect(ed.coalesce).toBe(coalesce);
    }

    const removed = run(removeInflowEdit(run(addInflowEdit(p, bond.id), p), bond.id, 1), p);
    expect(removed.funding.pools[0].inflows).toHaveLength(1);
    const twoRows = run(addInflowEdit(p, bond.id), p);
    expect(edit(removeInflowEdit(twoRows, bond.id, 1)).label).toBe(
      'Removed money in: City bond, 2028, row 2'
    );
    expect(removeInflowEdit(p, bond.id, 0)).toEqual({
      refused: 'A source needs at least one row of money in.'
    });

    const bank = run(addPresetEdit(p, preset('public-bank')), p);
    const bankId = bank.funding.pools[1].id;
    const lev = edit(setLeverageEdit(bank, bankId, 0.8));
    expect(lev.label).toBe('Changed lending per dollar: Public bank (housing share), 0.8');
    expect(lev.coalesce).toBe(`pool:${bankId}:leverage`);
    expect(run(lev, bank).funding.pools[1].leverage).toBe(0.8);

    const line = scaleLines(
      run(addScaleEdit(p, baseline, { group: 'state' }, july(2027), 0), p).funding,
      baseline,
      'state'
    )[0];
    expect(removeScaleEdit(line).label).toBe('Removed change: state from July 2027');
    expect(removeScaleEdit(line).coalesce).toBeUndefined();
  });

  it('every row of 4.9 applies to a valid policy, and a no-op returns the same object', () => {
    const p = BOND_POLICY;
    const id = p.funding.pools[0].id;
    expect(run(setInflowAmountEdit(p, id, 0, 250_000_000), p).funding.pools[0].inflows[0]).toEqual({
      kind: 'once',
      day: july(2028),
      dollars: 250_000_000
    });
    expect(run(setInflowKindEdit(p, id, 0, 'yearly'), p).funding.pools[0].inflows[0]).toEqual({
      kind: 'yearly',
      from: july(2028),
      to: null,
      dollarsPerYear: 300_000_000
    });
    const kinded = run(setKindEdit(p, id, 'cop'), p).funding.pools[0];
    expect(kinded.debt).toEqual(POOL_KIND_DEFAULTS.cop.debt!.value);
    const banked = run(setKindEdit(p, id, 'bank'), p).funding.pools[0];
    expect(banked.debt).toBeNull();
    expect(banked.leverage).toBe(0.67);
    const gf = run(setKindEdit(p, id, 'generalRevenue'), p).funding.pools[0];
    expect([gf.debt, gf.leverage]).toEqual([null, 1]);
    expect(run(renamePoolEdit(p, id, '  Big bond  '), p).funding.pools[0].label).toBe('Big bond');
    expect(run(setDebtEdit(p, id, 'rate', 0.07), p).funding.pools[0].debt).toEqual({
      rate: 0.07,
      termYears: 20
    });

    // An edit that changes nothing, and one that would make the policy invalid, return `p`.
    expect(edit(setDebtEdit(p, id, 'rate', 0.06)).change(p)).toBe(p);
    expect(edit(renamePoolEdit(p, id, 'City bond, 2028')).change(p)).toBe(p);
    expect(edit(setDebtEdit(p, id, 'rate', 0.3)).change(p)).toBe(p);
    expect(
      edit(
        removeScaleEdit(
          scaleLines(p.funding, baseline, 'state')[0] ?? {
            group: 'state',
            pools: ['state'],
            name: 'State',
            from: july(2027),
            scale: 0,
            text: ''
          }
        )
      ).change(p)
    ).toBe(p);
  });

  it('a preset over a limit is refused', () => {
    let p = policyWith({});
    for (let i = 0; i < 12; i++) p = run(addPoolEdit(POOL), p);
    expect(p.funding.pools).toHaveLength(12);
    expect(addPresetEdit(p, preset('housing-bond'))).toEqual({
      refused: 'This would pass the limit of 12 added sources of money. Remove one first.'
    });
    expect(edit(addPoolEdit(POOL)).change(p)).toBe(p);
    expect(limitProblem(p.funding, { pools: 1 })).toBe(
      'This would pass the limit of 12 added sources of money. Remove one first.'
    );
    expect(
      limitProblem(policyWith({}).funding, { programmes: 1 }, { pools: 0, programmes: 24 })
    ).toBe('This would pass the limit of 24 programmes. Remove one first.');
    expect(limitProblem(policyWith({}).funding, { pools: 1, programmes: 1, scales: 1 })).toBeNull();
  });

  it('a draft makes no change until complete, then one edit with a nextAddedId id', () => {
    const draft = newOwnPool(FUND_ASOF);
    expect(draft.kind).toBe('generalRevenue');
    expect(draft.label).toBe('City general fund, 2027');
    expect(draft.inflows).toEqual([{ kind: 'yearly', empty: true, day: july(2027) }]);
    const p = BOND_POLICY;
    expect(completeDraft({ kind: 'pool', pool: draft }, p, baseline)).toBeNull();

    const filled = updatePoolDraft(draft, {
      inflows: [{ kind: 'yearly', from: july(2027), to: null, dollarsPerYear: 60_000_000 }]
    });
    const done = completeDraft({ kind: 'pool', pool: filled }, p, baseline)!;
    expect(done.label).toBe('Added: your own pool');
    expect(done.coalesce).toBeUndefined();
    const next = run(done, p);
    expect(next.funding.pools.map((x) => x.id)).toEqual(['u-pool-1', 'u-pool-2']);
    expect(next.funding.pools[1]).toEqual({
      id: 'u-pool-2',
      kind: 'generalRevenue',
      label: 'City general fund, 2027',
      inflows: [{ kind: 'yearly', from: july(2027), to: null, dollarsPerYear: 60_000_000 }],
      uncapped: false,
      debt: null,
      leverage: 1
    });
    const fresh = run(done, policyWith({}));
    expect(fresh.funding.pools[0].id).toBe('u-pool-1');

    // A loan on a generalRevenue pool: its rate has no source, so it is a draft.
    const gfPolicy = run(addPoolEdit(POOL), policyWith({}));
    const pool = gfPolicy.funding.pools[0];
    const base = newProgramme(pool, baseline);
    const loanDraft: Draft = {
      kind: 'programme',
      prog: {
        replaces: null,
        pool: pool.id,
        prog: {
          ...base,
          instrument: { kind: 'loan', costShare: 0.6, rate: null, requiredReturn: null }
        }
      }
    };
    expect(completeDraft(loanDraft, gfPolicy, baseline)).toBeNull();
    const withRate: Draft = {
      kind: 'programme',
      prog: {
        ...loanDraft.prog,
        prog: {
          ...loanDraft.prog.prog,
          instrument: { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null }
        }
      }
    };
    const loanEdit = completeDraft(withRate, gfPolicy, baseline)!;
    expect(loanEdit.label).toBe(
      'Added: Loan to affordable homes of 20 homes or more: 60% of the building cost at 4%'
    );
    const withLoan = run(loanEdit, gfPolicy);
    expect(withLoan.funding.programmes).toHaveLength(1);
    expect(withLoan.funding.programmes[0].id).toBe('u-prog-1');
    expect(withLoan.funding.programmes[0].instrument).toEqual({
      kind: 'loan',
      costShare: 0.6,
      rate: 0.04,
      requiredReturn: null
    });

    // An instrument change that needs a rate replaces the stored programme when complete.
    const replace: Draft = {
      kind: 'programme',
      prog: { ...withRate.prog, replaces: 'u-prog-1', pool: 'u-pool-1' }
    };
    const replaced = completeDraft(replace, BOND_POLICY, baseline)!;
    expect(replaced.label).toBe(
      'Changed: Loan to affordable homes of 20 homes or more, from July 2027: 60% of the ' +
        'building cost at 4%'
    );
    const after = run(replaced, BOND_POLICY);
    expect(after.funding.programmes.map((g) => [g.id, g.instrument.kind])).toEqual([
      ['u-prog-1', 'loan']
    ]);

    // A setKindEdit whose defaults have no source is refused, so the field opens a draft.
    const original = POOL_KIND_DEFAULTS.bank.leverage;
    POOL_KIND_DEFAULTS.bank.leverage = { value: null, reason: 'No source.' };
    try {
      expect(setKindEdit(BOND_POLICY, 'u-pool-1', 'bank')).toEqual({ refused: 'No source.' });
    } finally {
      POOL_KIND_DEFAULTS.bank.leverage = original;
    }
  });

  it('same pool and day replaces', () => {
    const p0 = policyWith({});
    const a = run(addScaleEdit(p0, baseline, { pool: 'state' }, july(2028), 0), p0);
    const b = run(addScaleEdit(a, baseline, { pool: 'state' }, july(2028), 2), a);
    expect(b.funding.baselineScale).toEqual([{ pool: 'state', from: july(2028), scale: 2 }]);
  });

  it('insert between two entries keeps order and the back-on prefix', () => {
    const p0 = policyWith({
      baselineScale: [
        { pool: 'city-gf', from: july(2027), scale: 0 },
        { pool: 'state', from: july(2028), scale: 0.5 },
        { pool: 'state', from: july(2032), scale: 1 }
      ]
    });
    const p = run(addScaleEdit(p0, baseline, { pool: 'state' }, july(2030), 0), p0);
    expect(p.funding.baselineScale).toEqual([
      { pool: 'city-gf', from: july(2027), scale: 0 },
      { pool: 'state', from: july(2028), scale: 0.5 },
      { pool: 'state', from: july(2030), scale: 0 },
      { pool: 'state', from: july(2032), scale: 1 }
    ]);
    expect(scaleLines(p.funding, baseline, 'state').map((l) => l.text)).toEqual([
      "From July 2028: 50% of today's amount",
      'From July 2030: switched off',
      "From July 2032: switched back on, 100% of today's amount"
    ]);
    // Inserting before every entry of a pool also sorts.
    const q = run(addScaleEdit(p, baseline, { pool: 'state' }, july(2027), 3), p);
    expect(q.funding.baselineScale.map((e) => e.from)).toEqual([
      july(2027),
      july(2027),
      july(2028),
      july(2030),
      july(2032)
    ]);
    expect(scaleLines(q.funding, baseline, 'state')[1].text).toBe(
      "From July 2028: 50% of today's amount"
    );
  });

  it('City-group change writes one entry per City pool and removes as one', () => {
    const p0 = policyWith({});
    const e = edit(addScaleEdit(p0, baseline, { group: 'city' }, july(2029), 0));
    expect(e.label).toBe("Today's funding: City money switched off from July 2029");
    const p = run(e, p0);
    expect(p.funding.baselineScale).toEqual([
      { pool: 'city-gf', from: july(2029), scale: 0 },
      { pool: 'city-tax', from: july(2029), scale: 0 }
    ]);
    const lines = scaleLines(p.funding, baseline, 'city');
    expect(lines).toHaveLength(1);
    const r = removeScaleEdit(lines[0]);
    expect(r.label).toBe('Removed change: City money from July 2029');
    expect(run(r, p).funding.baselineScale).toEqual([]);
  });

  it('City-group change refused past 24 entries', () => {
    const scale = Array.from({ length: 23 }, (_, i) => ({
      pool: 'state',
      from: dayOf(2030 + i, 1, 1),
      scale: 1
    }));
    const p = policyWith({ baselineScale: scale });
    expect(addScaleEdit(p, baseline, { group: 'city' }, july(2029), 0)).toEqual({
      refused: 'A policy can hold 24 dated changes; this one needs 2. Remove one first.'
    });
    // One more entry for a single pool still fits.
    expect(
      run(addScaleEdit(p, baseline, { pool: 'city-gf' }, july(2029), 0), p).funding.baselineScale
    ).toHaveLength(24);
    // A replacement needs no new entry.
    const full = run(addScaleEdit(p, baseline, { pool: 'city-gf' }, july(2029), 0), p);
    expect(isRefused(addScaleEdit(full, baseline, { pool: 'state' }, dayOf(2030, 1, 1), 0))).toBe(
      false
    );
  });

  it('preset values pass their fields and re-committing them is no edit', () => {
    const p = run(addPresetEdit(policyWith({}), preset('housing-bond')), policyWith({}));
    const prog = p.funding.programmes[0];
    expect(prog.instrument).toEqual({ kind: 'grant', share: 0.348251 });
    expect(fieldText(0.348251, 'fraction')).toBe('34.8251');
    expect(isUnchanged('34.8251', 0.348251, 'fraction')).toBe(true);
    expect(isUnchanged('34.83', 0.348251, 'fraction')).toBe(false);
    const share = parsePercent(0, 100, true, 'Enter a percent above 0 and at most 100.');
    expect(share('34.8251')).toEqual({ value: 0.348251 });
    expect(share('0')).toEqual({ error: 'Enter a percent above 0 and at most 100.' });
    expect(share('100')).toEqual({ value: 1 });

    expect(fieldText(8_666_667, 'millions')).toBe('8.666667');
    expect(isUnchanged('8.666667', 8_666_667, 'millions')).toBe(true);
    expect(parseAmountMillions('8.666667')).toEqual({ value: 8_666_667 });
    expect(parseAmountMillions('0.0000001')).toEqual({ value: 1 });
    expect(parseAmountMillions('')).toEqual({
      error: 'Enter an amount above $0 and at most $100,000 million.'
    });
    expect(parseAmountMillions('0')).toHaveProperty('error');
    expect(parseAmountMillions('100001')).toHaveProperty('error');
    expect(parseAmountMillions('100000')).toEqual({ value: 100_000_000_000 });

    expect(parseMinHomes('0')).toEqual({ value: 0 });
    expect(parseMinHomes('10.5')).toEqual({
      error: 'Enter a whole number of homes from 0 to 10,000.'
    });
    expect(isUnchanged('0', 0, 'plain')).toBe(true);
    expect(isUnchanged('', 0, 'plain')).toBe(false);
    expect(parseWholeYears('20')).toEqual({ value: 20 });
    expect(parseWholeYears('41')).toEqual({ error: 'Enter a whole number of years from 1 to 40.' });
    expect(parseLeverage('0.67')).toEqual({ value: 0.67 });
    expect(parseLeverage('0')).toEqual({ error: 'Enter a number above 0 and at most 10.' });
    expect(parseName('  ')).toEqual({ error: 'Enter a name of up to 48 characters.' });
    expect(parseName('x'.repeat(49))).toHaveProperty('error');
    expect(parseName(' Bond ')).toEqual({ value: 'Bond' });

    // Every preset's stored numbers pass their field's parser through their own text.
    for (const pr of presets.filter((x) => x.available)) {
      for (const pool of pr.pools) {
        for (const f of pool.inflows) {
          const d = f.kind === 'once' ? f.dollars : f.dollarsPerYear;
          expect(parseAmountMillions(fieldText(d, 'millions'))).toEqual({ value: d });
        }
      }
      for (const g of pr.programmes) {
        expect(parseMinHomes(String(g.minHomes))).toEqual({ value: g.minHomes });
        if (g.instrument.kind === 'grant')
          expect(
            isUnchanged(fieldText(g.instrument.share, 'fraction'), g.instrument.share, 'fraction')
          ).toBe(true);
      }
    }
  });

  it('removing a pool removes its programmes', () => {
    const p = run(addPresetEdit(BOND_POLICY, preset('public-bank')), BOND_POLICY);
    expect(p.funding.programmes).toHaveLength(2);
    const r = edit(removePoolEdit(p, 'u-pool-1'));
    const next = run(r, p);
    expect(next.funding.pools.map((x) => x.id)).toEqual(['u-public-bank-1']);
    expect(next.funding.programmes.map((g) => g.pool)).toEqual(['u-public-bank-1']);
    const two = run(addProgrammeEdit(p, baseline, newProgramme(p.funding.pools[0], baseline)), p);
    expect(edit(removePoolEdit(two, 'u-pool-1')).label).toBe(
      'Removed: City bond, 2028 and its 2 programmes'
    );
    const bare = run(addPoolEdit(POOL), policyWith({}));
    expect(edit(removePoolEdit(bare, 'u-pool-1')).label).toBe('Removed: City general fund, 2027');
  });

  it('name stops regenerating after a user edit', () => {
    const d = newOwnPool(FUND_ASOF);
    const bond = updatePoolDraft(d, { kind: 'goBond' });
    expect(bond.label).toBe('City bond, 2027');
    expect(bond.debt).toEqual({ rate: 0.06, termYears: 20 });
    const later = updatePoolDraft(bond, {
      inflows: [{ kind: 'once', empty: true, day: july(2029) }]
    });
    expect(later.label).toBe('City bond, 2029');
    const named = updatePoolDraft(later, { label: 'My bond' });
    expect(named.labelEdited).toBe(true);
    expect(updatePoolDraft(named, { kind: 'cop' }).label).toBe('My bond');
    // A bank with no sourced leverage leaves the field empty.
    expect(updatePoolDraft(d, { kind: 'bank' }).leverage).toBe(0.67);
    expect(updatePoolDraft(d, { kind: 'bank' }).debt).toBeNull();
    expect(generatedName('goBond', july(2028))).toBe('City bond, 2028');

    // A stored pool regenerates only when the page says its name was not edited.
    const p = BOND_POLICY;
    expect(run(setKindEdit(p, 'u-pool-1', 'cop', true), p).funding.pools[0].label).toBe(
      'City lease financing, 2028'
    );
    expect(run(setKindEdit(p, 'u-pool-1', 'cop'), p).funding.pools[0].label).toBe(
      'City bond, 2028'
    );
    expect(
      run(setInflowDateEdit(p, 'u-pool-1', 0, 'day', july(2030), true), p).funding.pools[0].label
    ).toBe('City bond, 2030');
  });

  it('hand-made ids match ^u-[a-z0-9-]{1,38}$', () => {
    let p = run(addPoolEdit(POOL), policyWith({}));
    p = run(addPoolEdit(POOL), p);
    p = run(addProgrammeEdit(p, baseline, newProgramme(p.funding.pools[1], baseline)), p);
    p = run(addProgrammeEdit(p, baseline, newProgramme(p.funding.pools[0], baseline)), p);
    const ids = [...p.funding.pools, ...p.funding.programmes].map((x) => x.id);
    expect(ids).toEqual(['u-pool-1', 'u-pool-2', 'u-prog-1', 'u-prog-2']);
    for (const id of ids) expect(id).toMatch(/^u-[a-z0-9-]{1,38}$/);
  });

  it('programme on a baseline pool names that pool', () => {
    const state = baseline.pools.find((x) => x.id === 'state')!;
    const prog = newProgramme(state, baseline);
    expect(prog).toMatchObject({
      pool: 'state',
      reach: 'affordable',
      instrument: { kind: 'grant', share: 0.35 },
      from: FUND_ASOF,
      to: null,
      minHomes: 20,
      tiers: { veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 }
    });
    const p0 = policyWith({});
    const e = edit(addProgrammeEdit(p0, baseline, prog));
    expect(e.label).toBe(
      'Added: Grant to affordable homes of 20 homes or more: 35% of the uncovered cost'
    );
    const p = run(e, p0);
    expect(p.funding.programmes[0]).toMatchObject({ id: 'u-prog-1', pool: 'state' });
    expect(p.funding.programmes[0].label.length).toBeLessThanOrEqual(80);
  });

  it('rescaleTiers keeps whole percents summing to 100', () => {
    const t = { veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 };
    const r = rescaleTiers(t, 'veryLow', 70);
    expect(r).toEqual({ veryLow: 0.7, low: 0.19, moderate: 0.11, aboveModerate: 0 });
    const all = rescaleTiers({ veryLow: 1, low: 0, moderate: 0, aboveModerate: 0 }, 'veryLow', 40);
    expect(all).toEqual({ veryLow: 0.4, low: 0.2, moderate: 0.2, aboveModerate: 0.2 });
    const sum = Object.values(r).reduce((s, x) => s + x, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('rate cut 0.5 points stores 0.005; 5.05 refused; clear removes the key; clear refused while a guarantee uses it', () => {
    expect(parseRateCutPoints('0.5')).toEqual({ value: 0.005 });
    expect(parseRateCutPoints('5.05')).toEqual({
      error: 'Enter a rate cut from 0 to 5 percentage points.'
    });
    expect(parseRateCutPoints('5')).toEqual({ value: 0.05 });
    const p0 = policyWith({});
    const p = run(setTermEdit('guaranteeRateCut', 0.005), p0);
    expect(p.funding.terms).toEqual({ guaranteeRateCut: 0.005 });
    expect(edit(setTermEdit('guaranteeRateCut', 0.06)).change(p0)).toBe(p0);
    const cleared = run(clearTermEdit(p, 'guaranteeRateCut'), p);
    expect(cleared.funding.terms).toEqual({});
    expect('guaranteeRateCut' in cleared.funding.terms).toBe(false);

    const withPool = run(addPoolEdit(POOL), TERM_POLICY);
    const guarantee: Omit<Programme, 'id'> = {
      ...newProgramme(withPool.funding.pools[0], baseline),
      reach: 'market',
      tiers: null,
      minHomes: 10,
      instrument: { kind: 'guarantee', costShare: 0.6, reserve: 0.1 }
    };
    const used = run(addProgrammeEdit(withPool, baseline, guarantee), withPool);
    expect(clearTermEdit(used, 'guaranteeRateCut')).toEqual({
      refused:
        'A guarantee in this policy is valued with this rate cut. Change or remove the guarantee first.'
    });
  });

  it('addPoolEdit: the generated id wins over an id in the input', () => {
    const p = run(addPoolEdit({ ...POOL, id: 'u-pool-99' } as Omit<Pool, 'id'>), policyWith({}));
    expect(p.funding.pools.map((x) => x.id)).toEqual(['u-pool-1']);
  });

  it('the add and remove labels of a dated change name the same source', () => {
    const p0 = policyWith({});
    for (const group of ['city', 'state', 'federal'] as const) {
      const e = edit(addScaleEdit(p0, baseline, { group }, july(2027), 0));
      const p = run(e, p0);
      const lines = scaleLines(p.funding, baseline, group);
      const name = (e.label as string).replace("Today's funding: ", '').split(' switched off')[0];
      expect(lines.length).toBeGreaterThan(0);
      expect(removeScaleEdit(lines[0]).label).toBe(`Removed change: ${name} from July 2027`);
    }
  });

  it('a label longer than 80 characters is truncated in the stored programme only', () => {
    const withPool = run(addPoolEdit(POOL), TERM_POLICY);
    const pool = withPool.funding.pools[0];
    const guarantee: Omit<Programme, 'id'> = {
      ...newProgramme(pool, baseline),
      reach: 'market',
      tiers: null,
      minHomes: 10,
      from: july(2029),
      to: july(2033),
      instrument: { kind: 'guarantee', costShare: 0.6, reserve: 0.1 }
    };
    expect(programmeSentence({ ...guarantee, id: '' }, pool).length).toBeGreaterThan(80);
    const q = run(addProgrammeEdit(withPool, baseline, guarantee), withPool);
    expect(q.funding.programmes).toHaveLength(1);
    expect(q.funding.programmes[0].label.length).toBeLessThanOrEqual(80);
    expect(q.funding.programmes[0].label.endsWith('…')).toBe(true);
  });
});
