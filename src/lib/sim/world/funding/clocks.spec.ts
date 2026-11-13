// world-funding Task 3: the market and affordable funded clocks (spec rules 2, 3, 4, 5, 7).
import { describe, expect, it } from 'vitest';
import { runOf } from '$lib/sim/scenario/engine';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import {
  NEVER_KEY_DAY,
  drawsOf,
  financePreOf,
  kindLatentInto,
  latentsWith,
  newKindOut
} from '$lib/sim/scenario/funded';
import { lastInitiationMonth, precomputeOf } from '$lib/sim/scenario/input';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { SimInput } from '$lib/sim/scenario/types';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { ProjectKind } from '$lib/timelapse/types';
import { monthFirstDay, monthOfDay } from '../months';
import { lotEntity, ordinaryStart } from '../rates';
import { staticsOf, type Statics } from '../statics';
import { changingAt, frameOf, limited } from '../test/timeline';
import { kindClock, sizeIn, type Spell } from './clocks';
import { financeFrameOf, fundedMini, oneMoneyTimeline } from './test/fixtures';

type Finance = NonNullable<SimInput['finance']>;

const KINDS: readonly ProjectKind[] = ['market', 'affordable'];
const startOf = (r: Day, T: number) => r + 1 + Math.floor((T - 1) * MONTH_DAYS);

function spellOf(statics: Statics, sh: number, lot: number, r: Day, existing: number): Spell {
  return { lot, k: 0, stream: streamOf(sh, lotEntity(statics, lot), 0), r, existing };
}

/** Every candidate of `input` on seeds 1..n, attempt 0, free since `r`. */
function eachSpell(
  input: SimInput,
  n: number,
  r: Day,
  fn: (spell: Spell, sh: number, seed: number, c: number) => void
) {
  const statics = staticsOf(input);
  const pre = precomputeOf(input);
  for (let seed = 1; seed <= n; seed++) {
    const sh = seedHash(seed);
    pre.candidates.forEach((i, c) =>
      fn(spellOf(statics, sh, i, r, input.parcels.existingUnits[i]), sh, seed, c)
    );
  }
}

describe('kindClock', () => {
  it.each([
    ['without a market', 0],
    ['with a market step at asOf', 0.35]
  ])('on one frame equals the old kernel for every lot, attempt 0 (%s)', (_name, logOdds) => {
    const base = fundedMini();
    const asOf = base.asOf;
    const fin: Finance = { ...miniFinance(asOf), off: [] };
    const input: SimInput = {
      ...fundedMini(fin),
      ...(logOdds !== 0 ? { market: [{ from: asOf, logOdds }] } : {})
    };
    const fp = financePreOf(input);
    expect(fp.days).toEqual([]); // no finance segment days: one frame is the whole old grid
    const t = oneMoneyTimeline(input, fin);
    expect(t.changes()).toEqual([]);
    expect(t.frameAt(1).market).toBe(logOdds);
    const statics = staticsOf(input);
    const pre = precomputeOf(input);
    const out = newKindOut();
    const horizon = 1_099_511_627_776; // past every day the clocks give
    let compared = 0;
    let applying = 0;
    let certain = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const run = runOf(input, seed, horizon, true);
      const sh = seedHash(seed);
      pre.candidates.forEach((i, c) => {
        const e = input.parcels.existingUnits[i];
        const d = drawsOf(streamOf(sh, pre.entity[c], 0));
        const lat = latentsWith(run, fp, i, asOf, e, d);
        const spell = spellOf(statics, sh, i, asOf, e);
        for (const kind of KINDS) {
          const [u, v] = kind === 'market' ? [d.uO, d.vO] : [d.uA, d.vA];
          kindLatentInto(out, run, fp, i, lat.size, kind, asOf, u, v, lat.TO, -1, null);
          const k = kindClock(statics, t, 1, sh, spell, kind);
          expect({
            T: k.T,
            day: k.day,
            keyDay: k.keyDay,
            bundle: k.bundle,
            level: k.level
          }).toEqual({
            T: out.T,
            day: out.day,
            keyDay: out.keyDay,
            bundle: out.bundle,
            level: out.level
          });
          if (k.T !== 0) {
            expect([k.f, k.units, k.stories, k.protoId]).toEqual([
              out.f,
              out.units,
              out.stories,
              out.protoId
            ]);
            expect(k.viewMonth).toBe(1);
          }
          expect(k.month).toBe(k.day === null ? 0 : monthOfDay(asOf, k.day));
          compared++;
          if (k.day !== null) applying++;
          if (k.certain) certain++;
        }
      });
    }
    expect(compared).toBeGreaterThan(100);
    expect(applying).toBeGreaterThan(0);
    expect(certain).toBeGreaterThan(0);
  });

  it('a market clock with nothing shifting is the ordinary clock', () => {
    const base = fundedMini();
    const asOf = base.asOf;
    // only the affordable programmes: no market bundle anywhere
    const fin: Finance = {
      ...miniFinance(asOf),
      programmes: miniFinance(asOf).programmes.filter((g) => g.reach === 'affordable')
    };
    const input = fundedMini(fin);
    const money = financeFrameOf(fin, asOf, 1);
    const a = frameOf(input, { id: 9101, finance: money });
    const sameRates = frameOf(input, { id: 9102, finance: money }); // a change that moves no rate
    const shifted = frameOf(input, { id: 9103, finance: money, market: 0.4 });
    const timelines = [
      oneMoneyTimeline(input, fin),
      changingAt(5, a, sameRates, new Int32Array(0)),
      changingAt(7, a, shifted, null)
    ];
    const statics = staticsOf(input);
    let planned = 0;
    let never = 0;
    for (const t of timelines) {
      for (const r of [asOf, asOf + 100]) {
        for (const month of [1, 12, 30]) {
          eachSpell(input, 3, r, (spell, sh) => {
            const k = kindClock(statics, t, month, sh, spell, 'market');
            const os = ordinaryStart(statics, t, month, sh, spell.lot, r, 0);
            expect(k.day).toBeNull();
            expect(k.bundle).toEqual([]);
            if (os === null) {
              expect(k.T).toBe(0);
              expect(k.keyDay).toBe(NEVER_KEY_DAY);
              never++;
            } else {
              const vO = drawOn(spell.stream, P.INIT_DAY, 0);
              expect(r + 1 + Math.floor((k.T - 1 + vO) * MONTH_DAYS)).toBe(os.day);
              expect(k.keyDay).toBe(startOf(r, k.T));
              planned++;
            }
          });
        }
      }
    }
    expect(planned).toBeGreaterThan(100);
    expect(planned + never).toBe(
      timelines.length * 2 * 3 * 3 * precomputeOf(input).candidates.length
    );
  });

  it('a certain bundle applies on the first day of lot-month T', () => {
    const input = fundedMini();
    const asOf = input.asOf;
    const t = oneMoneyTimeline(input, input.finance!);
    const statics = staticsOf(input);
    let certain = 0;
    eachSpell(input, 5, asOf, (spell, sh) => {
      const k = kindClock(statics, t, 1, sh, spell, 'affordable');
      if (!k.certain) return;
      expect(k.day).toBe(spell.r + 1 + Math.floor((k.T - 1) * MONTH_DAYS));
      expect(k.level).toBe(1);
      certain++;
    });
    expect(certain).toBeGreaterThan(0);
  });

  it('rule 5: a programme opening at month m does not make an earlier pass apply', () => {
    const asOf = fundedMini().asOf;
    const m = 13;
    const opens = monthFirstDay(asOf, m);
    const fin: Finance = {
      ...miniFinance(asOf),
      programmes: miniFinance(asOf).programmes.map((g) =>
        g.reach === 'affordable' ? { ...g, from: opens } : g
      )
    };
    const input = fundedMini(fin);
    const t = oneMoneyTimeline(input, fin);
    expect(t.changes()).toContain(m);
    const statics = staticsOf(input);
    const before = lastInitiationMonth(asOf, opens - 1); // the last lot-month wholly before m
    let early = 0;
    let after = 0;
    eachSpell(input, 20, asOf, (spell, sh) => {
      const k12 = kindClock(statics, t, m - 1, sh, spell, 'affordable');
      const k20 = kindClock(statics, t, 20, sh, spell, 'affordable');
      if (k12.T !== 0 && k12.T <= before) {
        // passed with an empty bundle: the spell is spent, whatever opens later
        expect(k12.day).toBeNull();
        expect(k20.T).toBe(k12.T);
        expect(k20.day).toBeNull();
        expect(k20.month).toBe(0);
        early++;
      } else if (k20.day !== null) {
        expect(k20.day).toBeGreaterThanOrEqual(opens);
        after++;
      }
    });
    expect(early).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
  });

  it('rule 7: keyDay is the ordinary pass (market) or the unshifted affordable pass', () => {
    const asOf = fundedMini().asOf;
    const fin = miniFinance(asOf);
    // the same programmes, none ever offered: every clock runs on the unshifted rates
    const none: Finance = {
      ...fin,
      programmes: fin.programmes.map((g) => ({ ...g, from: asOf + 365 * 1000 }))
    };
    const input = fundedMini(fin);
    const withMoney = oneMoneyTimeline(input, fin);
    const without = oneMoneyTimeline(fundedMini(none), none);
    const statics = staticsOf(input);
    let moved = 0;
    let compared = 0;
    eachSpell(input, 5, asOf, (spell, sh) => {
      for (const kind of KINDS) {
        const k = kindClock(statics, withMoney, 30, sh, spell, kind);
        const ref = kindClock(statics, without, 30, sh, spell, kind);
        expect(k.keyDay).toBe(ref.T === 0 ? NEVER_KEY_DAY : startOf(asOf, ref.T));
        if (kind === 'market') {
          const os = ordinaryStart(statics, withMoney, 30, sh, spell.lot, asOf, 0);
          if (os === null) expect(k.keyDay).toBe(NEVER_KEY_DAY);
          else {
            expect(os.day).toBeGreaterThanOrEqual(k.keyDay);
            expect(os.day).toBeLessThan(startOf(asOf, ref.T + 1) + 1);
          }
        }
        if (k.T !== 0 && k.T !== ref.T) moved++;
        compared++;
      }
    });
    expect(compared).toBeGreaterThan(100);
    expect(moved).toBeGreaterThan(0); // the shifted pass differs, the key does not follow it
  });

  it('reads no frame above `month`', () => {
    const input = fundedMini();
    const asOf = input.asOf;
    const fin = input.finance!;
    const a = frameOf(input, { id: 9201, finance: financeFrameOf(fin, asOf, 1) });
    const b = frameOf(input, {
      id: 9202,
      finance: { ...financeFrameOf(fin, asOf, 1), offered: new Uint8Array(fin.programmes.length) },
      market: 0.5
    });
    const full = changingAt(40, a, b, null);
    const t = limited(full, () => 30);
    const statics = staticsOf(input);
    let checked = 0;
    eachSpell(input, 2, asOf, (spell, sh) => {
      for (const kind of KINDS) {
        const k = kindClock(statics, t, 30, sh, spell, kind);
        expect(k).toEqual(kindClock(statics, full, 30, sh, spell, kind));
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
    // the guard is live: reading month 40 throws
    const spell = spellOf(statics, seedHash(1), precomputeOf(input).candidates[0], asOf, 0);
    expect(() => kindClock(statics, t, 40, seedHash(1), spell, 'market')).toThrow(RangeError);
  });
});

describe('sizeIn', () => {
  it('draws the size as the old kernel does, against own and other existing homes', () => {
    const input = fundedMini();
    const asOf = input.asOf;
    const fp = financePreOf(input);
    const statics = staticsOf(input);
    const pre = precomputeOf(input);
    const t = oneMoneyTimeline(input, input.finance!);
    const f1 = t.frameAt(1);
    const run = runOf(input, 1, asOf + 365 * 30, true);
    let sized = 0;
    pre.candidates.forEach((i, c) => {
      const d = drawsOf(streamOf(run.sh, pre.entity[c], 0));
      for (const e of [input.parcels.existingUnits[i], 0]) {
        const want = latentsWith(run, fp, i, asOf, e, d).size[0];
        const got = sizeIn(statics, f1.view, f1.calibration, i, e, d.uS);
        expect(got === null ? null : { ...got }).toEqual(want === null ? null : { ...want });
        if (got !== null) sized++;
      }
    });
    expect(sized).toBeGreaterThan(0);
  });
});
