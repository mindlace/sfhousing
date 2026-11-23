// The card's "Allowed by" and "Funded by" names over a schema 4 document (rules 19, 21).
import { describe, expect, it } from 'vitest';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import type { LimitOwner } from '$lib/sim/levers/source';
import type { PolicyLimitOwner } from '$lib/sim/world/policy/limits';
import type { Pool, Programme } from '$lib/timelapse/types';
import { fundingName4, ownerName4, policyOfOwner } from './owner';
import type { Policy, SimPolicy4 } from './policy4';

const FROM = 20_000;

const transit: Policy = {
  id: 'near-bart',
  label: 'Taller near BART',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: [] },
  spans: [{ from: FROM, to: null, what: { tag: 'bands', bands: [{ maxM: 400, stories: 8 }] } }]
};
const painted: Policy = {
  id: 'mission',
  label: 'Mission paint',
  preset: null,
  on: true,
  where: { tag: 'painted' },
  spans: [{ from: FROM, to: null, what: { tag: 'brushes', brushes: [] } }]
};
const doc = (...zoning: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { zoning, permitting: [], money: [] }
});
// The worker's owners carry the policy (PolicyLimitOwner); the map types them as LimitOwner.
const asLimit = (o: PolicyLimitOwner): LimitOwner => o as unknown as LimitOwner;

describe('policyOfOwner', () => {
  it('reads the policy of a paint or rule owner; fzp has none', () => {
    expect(policyOfOwner(asLimit({ kind: 'paint', policy: 'mission' }))).toBe('mission');
    expect(policyOfOwner(asLimit({ kind: 'rule', ruleId: 'near-bart', policy: 'near-bart' }))).toBe(
      'near-bart'
    );
    expect(policyOfOwner({ kind: 'fzp' })).toBeNull();
    // A schema 3 owner (no policy field) names no policy.
    expect(policyOfOwner({ kind: 'paint' })).toBeNull();
  });
});

describe('ownerName4', () => {
  it('ownerName4 names the policy that sets a lot; fzp and a removed policy give null', () => {
    const d = doc(transit, painted);
    expect(ownerName4(asLimit({ kind: 'paint', policy: 'mission' }), d)).toBe('Mission paint');
    expect(ownerName4(asLimit({ kind: 'rule', ruleId: 'near-bart', policy: 'near-bart' }), d)).toBe(
      'Taller near BART'
    );
    expect(ownerName4({ kind: 'fzp' }, d)).toBeNull();
    expect(ownerName4(asLimit({ kind: 'paint', policy: 'gone' }), d)).toBeNull();
    expect(ownerName4(asLimit({ kind: 'paint', policy: 'mission' }), doc(transit))).toBeNull();
  });
});

describe('fundingName4', () => {
  const { baselineFunding } = baselineFixture();
  const bond: Pool = {
    id: 'u-bond',
    kind: 'generalRevenue',
    label: 'Housing bond',
    inflows: [{ kind: 'once', day: FROM, dollars: 500_000_000 }],
    debt: null,
    leverage: 1
  };
  const grant = (id: string, pool: string): Programme => ({
    ...baselineFunding.programmes[0],
    id,
    label: id,
    pool
  });
  const money = (
    spans: Policy['spans'],
    where: Policy['where'] = { tag: 'fund', pool: 'u-bond' }
  ) => ({ id: 'm', label: 'Bond', preset: null, on: true, where, spans }) satisfies Policy;
  const withMoney = (...m: Policy[]): SimPolicy4 => ({
    schema: 4,
    kinds: { zoning: [], permitting: [], money: m }
  });

  it("names an added pool's programme by the pool, a baseline one by its group", () => {
    const d = withMoney(
      money([
        { from: FROM, to: FROM + 99, what: { tag: 'fund', pool: bond, programmes: [] } },
        {
          from: FROM + 100,
          to: null,
          what: { tag: 'fund', pool: bond, programmes: [grant('g-bond', 'u-bond')] }
        }
      ])
    );
    const name = fundingName4(d, baselineFunding);
    expect(name({ kind: 'affordable', programmes: ['g-bond'], certain: true })).toBe(
      'Funded by: Housing bond · fully funded'
    );
    expect(
      name({ kind: 'affordable', programmes: ['baseline-city-a', 'g-bond'], certain: false })
    ).toBe('Funded by: the City and Housing bond · partly funded');
  });

  it('a programme on a baseline pool added by a policy is named by the group', () => {
    const d = withMoney(
      money([
        {
          from: FROM,
          to: null,
          what: { tag: 'fund', pool: null, programmes: [grant('g-state', 'state')] }
        }
      ])
    );
    expect(
      fundingName4(d, baselineFunding)({ kind: 'market', programmes: ['g-state'], certain: true })
    ).toBe('Funded by: the state · fully funded');
  });

  it('ids that no longer resolve are left out', () => {
    expect(
      fundingName4(withMoney(), undefined)({ kind: 'market', programmes: ['nope'], certain: true })
    ).toBe('Funded by: public money · fully funded');
  });
});
