import { describe, expect, it } from 'vitest';
import { decodePolicyPayload, encodePolicyPayload } from '$lib/data/policy-codec';
import {
  MINI_EXEMPT_PERM_ID,
  MINI_HISTORIC_ID,
  MINI_S207_ID,
  MINI_SB79_ID,
  MINI_TIE_ID,
  miniPolicy
} from '../scenario/fixtures/mini-policy';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import {
  blendStock,
  currentLawAfterTable,
  currentLawTable,
  stockTable,
  type EnvelopeTable,
  type LayerCtx
} from './layers';

function ctx(): LayerCtx {
  const city = miniCity();
  return { parcels: city.parcels, policy: miniPolicy(city) };
}
const F = 5;
function row(t: EnvelopeTable, i: number) {
  return {
    stories: t.stories[i],
    cap: t.cap[i],
    yield: Array.from(t.yield.subarray(i * F, i * F + F)),
    hostable: t.hostable[i]
  };
}
const top = (t: EnvelopeTable, i: number) => t.yield[i * F + F - 1];

describe('miniPolicy', () => {
  it('survives an encode/decode round trip', () => {
    const city = miniCity();
    const policy = miniPolicy(city);
    const back = decodePolicyPayload(encodePolicyPayload(policy), city.parcels);
    expect(back).toEqual(policy);
  });
  it('names lots that exist and mean what they say', () => {
    const { parcels, policy } = ctx();
    const at = (id: string) => parcels.index.get(id)!;
    expect(policy.exemptPermanent[at(MINI_EXEMPT_PERM_ID)]).toBe(1);
    expect(policy.currentFromS207[at(MINI_S207_ID)]).toBe(1);
    expect(policy.historicProtected[at(MINI_HISTORIC_ID)]).toBe(1);
  });
});

describe('blendStock', () => {
  it('a single fzp layer equals the FZP columns', () => {
    const c = ctx();
    const t = blendStock(c, ['fzp'], 'before', false);
    expect(t.count).toBe(c.parcels.count);
    expect(Array.from(t.stories)).toEqual(Array.from(c.parcels.envelopeStories));
    expect(Array.from(t.cap)).toEqual(Array.from(c.policy.fzpYieldCap));
    expect(Array.from(t.yield)).toEqual(Array.from(c.parcels.yield));
    expect(Array.from(t.hostable)).toEqual(Array.from(c.parcels.hostable));
  });
  it('base reads the base columns and sb79 the SB 79 columns', () => {
    const c = ctx();
    expect(Array.from(stockTable(c, 'base').yield)).toEqual(Array.from(c.parcels.baseYield));
    expect(Array.from(stockTable(c, 'base').cap)).toEqual(Array.from(c.parcels.baseCap));
    expect(Array.from(stockTable(c, 'sb79').stories)).toEqual(Array.from(c.policy.sb79Stories));
  });
  it('takes SB 79 where it is more permissive and keeps FZP on a tie', () => {
    const c = ctx();
    const t = blendStock(c, ['fzp', 'sb79'], 'before', false);
    const sb = c.parcels.index.get(MINI_SB79_ID)!;
    const tie = c.parcels.index.get(MINI_TIE_ID)!;
    expect(row(t, sb)).toEqual(row(stockTable(c, 'sb79'), sb));
    expect(top(t, sb)).toBeGreaterThan(c.parcels.yield[sb * F + F - 1]);
    expect(row(t, tie)).toEqual(row(stockTable(c, 'fzp'), tie));
    expect(top(stockTable(c, 'sb79'), tie)).toBe(top(stockTable(c, 'fzp'), tie));
    expect(stockTable(c, 'sb79').stories[tie]).not.toBe(stockTable(c, 'fzp').stories[tie]);
  });
  it('is order-insensitive', () => {
    const c = ctx();
    const a = blendStock(c, ['fzp', 'sb79'], 'before', false);
    const b = blendStock(c, ['sb79', 'fzp'], 'before', false);
    expect(b).toEqual(a);
    const all = blendStock(c, ['currentLaw', 'fzp', 'sb79', 'base'], 'before', false);
    const rev = blendStock(c, ['base', 'sb79', 'fzp', 'currentLaw'], 'before', false);
    expect(rev).toEqual(all);
  });
  it('an empty stock hosts nothing', () => {
    const c = ctx();
    const t = blendStock(c, [], 'before', false);
    expect(t.hostable.every((h) => h === 0)).toBe(true);
    expect(t.yield.every((y) => y === 0)).toBe(true);
  });
});

describe('current law and the switch', () => {
  it('before the switch current law is FZP + §207.11', () => {
    const c = ctx();
    expect(currentLawTable(c, 'before', false)).toEqual(stockTable(c, 'currentLaw'));
    expect(currentLawTable(c, 'before', true)).toEqual(stockTable(c, 'currentLaw'));
  });
  it('after the switch: permanent exemption keeps FZP, SB 79 wins elsewhere, §207.11 lapses', () => {
    const c = ctx();
    const t = currentLawAfterTable(c);
    const fzp = stockTable(c, 'fzp');
    const sb79 = stockTable(c, 'sb79');
    const ex = c.parcels.index.get(MINI_EXEMPT_PERM_ID)!;
    const sb = c.parcels.index.get(MINI_SB79_ID)!;
    const s207 = c.parcels.index.get(MINI_S207_ID)!;
    expect(top(sb79, ex)).toBeGreaterThan(top(fzp, ex)); // it would win but for the exemption
    expect(row(t, ex)).toEqual(row(fzp, ex));
    expect(row(t, sb)).toEqual(row(sb79, sb));
    expect(top(stockTable(c, 'currentLaw'), s207)).toBeGreaterThan(top(sb79, s207));
    expect(row(t, s207)).toEqual(row(sb79, s207));
  });
  it('is memoised per ctx', () => {
    const c = ctx();
    expect(currentLawAfterTable(c)).toBe(currentLawAfterTable(c));
  });
  it('after the switch with the Alternative Plan kept it is the stock current-law table', () => {
    const c = ctx();
    expect(currentLawTable(c, 'after', true)).toEqual(stockTable(c, 'currentLaw'));
    expect(currentLawTable(c, 'after', false)).toEqual(currentLawAfterTable(c));
  });
  it('blendStock routes currentLaw through the period', () => {
    const c = ctx();
    expect(blendStock(c, ['currentLaw'], 'after', false)).toEqual(currentLawAfterTable(c));
    expect(blendStock(c, ['currentLaw'], 'after', true)).toEqual(stockTable(c, 'currentLaw'));
  });
});
