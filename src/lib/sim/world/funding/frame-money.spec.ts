import { describe, expect, it } from 'vitest';
import { baselineFixture, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import type { SimInput } from '$lib/sim/scenario/types';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { Pool, Programme } from '$lib/timelapse/types';
import { monthFirstDay } from '../months';
import { inForceAt, moneyLeversOf } from '../policy/combine';
import type { FinanceFrame, PolicyFrame } from '../policy/frame';
import { createMoneyTrack } from '../policy/money';
import { AS_OF, fundPolicy, miniDoc, off, termsPolicy } from '../policy/test/fixtures';
import { miniInput } from '../policy/test/compile-fixtures';
import { frameOf, oneFrame } from '../test/timeline';
import { frameMoney, sameMoney } from './frame-money';

type Finance = NonNullable<SimInput['finance']>;

/** The mini city's money as one month's frame, everything offered. */
function miniFrame(id: number, over: Partial<FinanceFrame> = {}): PolicyFrame {
  const input = miniInput().input;
  const f = miniFinance(input.asOf);
  const fin: FinanceFrame = {
    pools: f.pools,
    programmes: f.programmes,
    offered: Uint8Array.from(f.programmes, () => 1),
    slope: f.slope,
    terms: f.terms,
    arrivals: [],
    ...over
  };
  return frameOf(input, { id, finance: fin });
}

describe('frameMoney', () => {
  it("maps ids to the frame's indices and lists offered programmes by kind, ascending", () => {
    const f = miniFrame(1);
    const fm = frameMoney(oneFrame(f), f);
    expect([...fm.pool]).toEqual([
      ['m-city', 0],
      ['m-bank', 1],
      ['federal', 2]
    ]);
    expect(fm.prog.get('m-bank-loan')).toBe(2);
    expect(fm.offered.affordable).toEqual([0, 1]);
    expect(fm.offered.market).toEqual([2, 3]);
    expect(fm.least.affordable).toBe(2);
    expect(fm.least.market).toBe(0);

    const some = miniFrame(2, { offered: Uint8Array.from([0, 1, 0, 1]) });
    const sm = frameMoney(oneFrame(some), some);
    expect(sm.offered.affordable).toEqual([1]);
    expect(sm.offered.market).toEqual([3]);
    const none = miniFrame(3, { offered: new Uint8Array(4) });
    expect(frameMoney(oneFrame(none), none).least.affordable).toBe(Infinity);
  });

  it('bundleOf returns one shared array per distinct set', () => {
    const f = miniFrame(1);
    const fm = frameMoney(oneFrame(f), f);
    expect(fm.bundleOf('affordable', 10)).toBe(fm.bundleOf('affordable', 11)); // same set
    expect(fm.bundleOf('affordable', 10)).toEqual([0, 1]);
    expect(fm.bundleOf('affordable', 1)).toEqual([]); // below minHomes 2
    expect(fm.bundleOf('affordable', 1)).not.toBe(fm.bundleOf('affordable', 10));
    expect(fm.bundleOf('market', 1)).toEqual([2, 3]);
  });

  it('bundleIds round-trips a joined id list and refuses an unknown id', () => {
    const f = miniFrame(1);
    const fm = frameMoney(oneFrame(f), f);
    const ids = ['m-city-grant', 'federal-grant'];
    expect(fm.bundleIds(ids.join(','))).toBe(fm.bundleOf('affordable', 10));
    expect(fm.bundleIds('nope')).toBeNull();
    expect(fm.bundleIds('m-city-grant,nope')).toBeNull();
    expect(fm.bundleIds('')).toEqual([]);
  });

  it('bundleIds refuses a programme not offered in the frame', () => {
    const f = miniFrame(1, { offered: Uint8Array.from([0, 1, 1, 1]) });
    const fm = frameMoney(oneFrame(f), f);
    expect(fm.bundleIds('m-city-grant')).toBeNull();
    expect(fm.bundleIds('federal-grant')).toEqual([1]);
  });

  it('frameMoney is memoised per (timeline, frame id)', () => {
    const f = miniFrame(1);
    const t = oneFrame(f);
    expect(frameMoney(t, f)).toBe(frameMoney(t, f));
    const g = miniFrame(2);
    expect(frameMoney(t, g)).not.toBe(frameMoney(t, f));
    // another timeline reusing the id gets its own entry
    const other = miniFrame(1, { offered: Uint8Array.from([0, 0, 0, 0]) });
    expect(frameMoney(oneFrame(other), other)).not.toBe(frameMoney(t, f));
  });

  it('refuses a frame without finance', () => {
    const f = frameOf(miniInput().input);
    expect(() => frameMoney(oneFrame(f), f)).toThrow(/finance/);
  });
});

describe('sameMoney', () => {
  it('ignores arrivals and sees an offer switched off', () => {
    const a = miniFrame(1);
    const t = oneFrame(a);
    const arrivals = miniFrame(2, { arrivals: [{ pool: 0, day: 5, dollars: 1e6 }] });
    expect(sameMoney(a, arrivals, t)).toBe(true);
    const switched = miniFrame(3, { offered: Uint8Array.from([1, 1, 0, 1]) });
    expect(sameMoney(a, switched, t)).toBe(false);
  });

  it('is true for a frame against itself and compares missing finance', () => {
    const a = miniFrame(1);
    const none = frameOf(miniInput().input);
    const t = oneFrame(a);
    expect(sameMoney(a, a, t)).toBe(true);
    expect(sameMoney(none, none, t)).toBe(true);
    expect(sameMoney(a, none, t)).toBe(false);
  });
});

describe('sameMoney agrees with the policy money identity (policy/money.ts, rule 16)', () => {
  const BASE = (): Finance => baselineFixture(AS_OF).finance;
  const pool = (id: string, inflows: Pool['inflows'] = []): Pool => ({
    ...structuredClone(fundingOnly().pools[0]),
    id,
    label: id,
    inflows
  });
  const prog = (id: string, poolId: string, over: Partial<Programme> = {}): Programme => ({
    ...structuredClone(fundingOnly().programmes[0]),
    id,
    label: id,
    pool: poolId,
    from: AS_OF,
    ...over
  });
  const D0 = (inflow = 1_000_000): SimPolicy4['kinds']['money'][number] =>
    fundPolicy(
      'f',
      'u-pool-1',
      pool('u-pool-1', [{ kind: 'once', day: AS_OF + 100, dollars: inflow }]),
      [prog('u-prog-1', 'u-pool-1')]
    );

  /** The real money track's month-1 frame of `doc` as a policy frame with a unique id. */
  let nextId = 100;
  function monthOne(doc: SimPolicy4, finance: Finance = BASE()) {
    const t = createMoneyTrack(doc, { asOf: AS_OF, finance });
    const r = t.month(1, moneyLeversOf(inForceAt(doc, monthFirstDay(AS_OF, 1))));
    expect(r).not.toBeNull();
    return {
      key: r!.key,
      frame: frameOf(miniInput().input, { id: nextId++, finance: r!.frame })
    };
  }

  const baseDoc = () => miniDoc(D0());
  const editedProgramme = () => {
    const p = D0();
    const w = p.spans[0].what;
    if (w.tag !== 'fund') throw new Error('fixture');
    w.programmes[0].minHomes = 4;
    return miniDoc(p);
  };
  const slope = (): Finance => ({ ...BASE(), slope: BASE().slope + 0.25 });

  const cases: [string, SimPolicy4, Finance | undefined, boolean][] = [
    ['identical documents', baseDoc(), undefined, true],
    ['arrivals only (an inflow raised)', miniDoc(D0(2_000_000)), undefined, true],
    [
      'an offered set changed (another fund)',
      miniDoc(D0(), fundPolicy('g', 'u-g', pool('u-g'), [prog('u-pg', 'u-g')])),
      undefined,
      false
    ],
    ['a programme definition changed', editedProgramme(), undefined, false],
    [
      'terms changed',
      miniDoc(D0(), termsPolicy('t', { constructionRate: 0.07 })),
      undefined,
      false
    ],
    ['slope changed', baseDoc(), slope(), false],
    [
      'a programme switched off is not offered (same)',
      miniDoc(D0(), off(fundPolicy('k', 'u-k', pool('u-k'), [prog('u-pk', 'u-k')]))),
      undefined,
      true
    ]
  ];

  it.each(cases)('%s', (_name, doc, finance, same) => {
    const a = monthOne(baseDoc());
    const b = monthOne(doc, finance);
    const t = oneFrame(a.frame);
    expect(a.key === b.key).toBe(same);
    expect(sameMoney(a.frame, b.frame, t)).toBe(same);
    expect(frameMoney(t, a.frame).key === frameMoney(t, b.frame).key).toBe(same);
  });
});
