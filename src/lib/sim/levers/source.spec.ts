import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { miniPolicy } from '../scenario/fixtures/mini-policy';
import { dayOf } from '../scenario/dates';
import { stockTable, type LayerCtx } from './layers';
import { resolveEnvelopes } from './resolve';
import { limitSources, SRC_FZP, SRC_PAINT, SRC_RULE0 } from './source';
import { DEFAULT_LEVERS, type SimLevers, type StoryEdit } from './types';

const city = miniCity();
const ctx: LayerCtx = { parcels: city.parcels, policy: miniPolicy(city) };
const fzp = stockTable(ctx, 'fzp').stories;
const rowOf = (id: string) => ctx.parcels.index.get(id)!;
const ids = Array.from(ctx.parcels.id);
// four lots at distinct rows, each with a known FZP story count
const [A, B, C, D] = ids.filter((_, i) => fzp[i] > 0).slice(0, 4);
const none = new Int32Array(0);
const e = (lots: string[], stories: number, source?: string): StoryEdit =>
  source === undefined ? { lots, stories } : { lots, stories, source };
const levers = (patch: Partial<SimLevers>): SimLevers => ({
  ...structuredClone(DEFAULT_LEVERS),
  ...patch
});

describe('limitSources', () => {
  it('a rule above FZP decides; the first of equal rules decides; a rule at or below FZP does not', () => {
    const hi = fzp[rowOf(A)] + 2;
    const s = limitSources(
      ctx,
      levers({
        rules: [e([A], hi, 'r1'), e([A], hi, 'r2'), e([B], fzp[rowOf(B)], 'r3')]
      }),
      none
    );
    expect(s.ruleIds).toEqual(['r1', 'r2', 'r3']);
    expect(s.source[rowOf(A)]).toBe(SRC_RULE0 + 0);
    expect(s.source[rowOf(B)]).toBe(SRC_FZP);
  });

  it('paint overrides a rule; a protected painted lot is FZP', () => {
    const s = limitSources(
      ctx,
      levers({ rules: [e([C], fzp[rowOf(C)] + 4, 'r1')], paint: [e([C, D], 2)] }),
      Int32Array.of(rowOf(D))
    );
    expect(s.source[rowOf(C)]).toBe(SRC_PAINT);
    expect(s.source[rowOf(D)]).toBe(SRC_FZP);
  });

  it('agrees with resolveEnvelopes on every lot (property)', () => {
    const lot = fc.constantFrom(...ids.slice(0, 12));
    const edit = (withSource: boolean) =>
      fc.record({
        lots: fc.uniqueArray(lot, { maxLength: 4 }),
        stories: fc.integer({ min: 0, max: 12 }),
        ...(withSource ? { source: fc.constantFrom('x', 'y', 'z') } : {})
      });
    const prop = fc.property(
      fc.array(edit(true), { maxLength: 5 }),
      fc.array(edit(false), { maxLength: 4 }),
      fc.uniqueArray(lot, { maxLength: 3 }),
      (rules, paint, prot) => {
        const l = levers({ rules, paint });
        const protect = Int32Array.from(prot.map(rowOf).sort((a, b) => a - b));
        // Protect exactly `protect` through the historic category.
        const hist = ctx.policy.historicProtected;
        const saved = hist.slice();
        hist.fill(0);
        for (const r of protect) hist[r] = 1;
        const real = resolveEnvelopes(
          ctx,
          { ...l, protect: { ...l.protect, historic: true } },
          dayOf(2025, 6, 1)
        );
        hist.set(saved);
        const s = limitSources(ctx, l, real.protectedRows);
        for (let i = 0; i < ctx.parcels.count; i++) {
          const got = real.plan.table.stories[i];
          const src = s.source[i];
          if (src === SRC_FZP) expect(got).toBe(fzp[i]);
          else if (src === SRC_PAINT) {
            const last = [...paint].reverse().find((p) => p.lots.includes(ids[i]))!;
            expect(got).toBe(last.stories);
          } else {
            const id = s.ruleIds[src - SRC_RULE0];
            const top = Math.max(
              ...rules
                .filter((r) => r.source === id && r.lots.includes(ids[i]))
                .map((r) => r.stories)
            );
            expect(got).toBe(top);
          }
        }
      }
    );
    expect(() => fc.assert(prop)).not.toThrow();
  });
});
