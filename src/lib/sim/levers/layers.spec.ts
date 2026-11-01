import { describe, expect, it } from 'vitest';
import { decodePolicyPayload, encodePolicyPayload } from '$lib/data/policy-codec';
import {
  MINI_EXEMPT_PERM_ID,
  MINI_HISTORIC_ID,
  MINI_S207_ID,
  miniPolicy
} from '../scenario/fixtures/mini-policy';
import { miniCity } from '../scenario/fixtures/mini-parcels';
import { stockTable, type LayerCtx } from './layers';

function ctx(): LayerCtx {
  const city = miniCity();
  return { parcels: city.parcels, policy: miniPolicy(city) };
}
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

describe('stockTable', () => {
  it('fzp reads the FZP columns', () => {
    const c = ctx();
    const t = stockTable(c, 'fzp');
    expect(t.count).toBe(c.parcels.count);
    expect(Array.from(t.stories)).toEqual(Array.from(c.parcels.envelopeStories));
    expect(Array.from(t.cap)).toEqual(Array.from(c.policy.fzpYieldCap));
    expect(Array.from(t.yield)).toEqual(Array.from(c.parcels.yield));
    expect(Array.from(t.hostable)).toEqual(Array.from(c.parcels.hostable));
  });
  it('base reads the base columns', () => {
    const c = ctx();
    const t = stockTable(c, 'base');
    expect(Array.from(t.stories)).toEqual(Array.from(c.parcels.baseStories));
    expect(Array.from(t.cap)).toEqual(Array.from(c.parcels.baseCap));
    expect(Array.from(t.yield)).toEqual(Array.from(c.parcels.baseYield));
    expect(Array.from(t.hostable)).toEqual(Array.from(c.parcels.hostableBase));
  });
});
