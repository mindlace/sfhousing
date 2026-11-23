<!--
  What (rule 10): today's editor for the selected policy's selector, on the selected span through
  the span lens (`edit`). Transit: `TransitLayerRow`, its stop types in the policy part (they are
  the policy's) and its bands in the span part; its Remove layer removes the policy. Painted: the
  page's `paint` snippet. Category: `ProtectionsSection only`. Routes: `PermittingSection` with no
  saved set, its preset fixed while the policy has more than one span. Baseline, fund and terms:
  `FundingTab only`, priced on the playhead's day; an existing fund's debt terms are read-only,
  with `TERMS_HINT` behind a tap. Read-only: `PolicySummary` of the span's projection.
-->
<script module lang="ts">
  /** Coalesce runs, numbered across mounts, so a remounted editor never resumes an old run. */
  let runs = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import {
    customLotStatus,
    ruleChangeLabel,
    ruleLotStatus,
    type LotStatus
  } from '$lib/sim-page/brush-summary';
  import type { FundingDrafts } from '$lib/sim-page/funding-drafts.svelte';
  import FundingTab from '$lib/sim-page/FundingTab.svelte';
  import PermittingSection from '$lib/sim-page/PermittingSection.svelte';
  import type { ZoningRule } from '$lib/sim-page/policy';
  import PolicySummary from '$lib/sim-page/PolicySummary.svelte';
  import ProtectionsSection from '$lib/sim-page/ProtectionsSection.svelte';
  import TransitLayerRow from '$lib/sim-page/TransitLayerRow.svelte';
  import type { Calibration, Day } from '$lib/timelapse/types';
  import { TERMS_HINT } from './money-copy';
  import Explain from './Explain.svelte';
  import { PRESET_PER_POLICY, type EditStore } from './lens';
  import type { Policy } from './policy4';
  import type { PolicySync } from './policy-sync.svelte';
  import { hasMoney } from './rows';
  import type { SpanRef } from './spans';

  interface Props {
    /** 'policy': what belongs to the whole policy (transit stop types); 'span': the rest. */
    part: 'policy' | 'span';
    policy: Policy;
    at: SpanRef;
    /** The span lens: today's editors' store on the selected span. */
    edit: EditStore;
    sync: Pick<PolicySync, 'result' | 'retry'>;
    calibration: Calibration;
    catalog: BrushCatalog | null | undefined;
    drafts: FundingDrafts;
    playheadDay: Day;
    readonly: boolean;
    announce(msg: string): void;
    /** Removes the policy (a transit layer's Remove). */
    onremove(): void;
    paint: Snippet;
  }

  let {
    part,
    policy,
    at,
    edit,
    sync,
    calibration,
    catalog,
    drafts,
    playheadDay,
    readonly,
    announce,
    onremove,
    paint
  }: Props = $props();

  const span = $derived(policy.spans[at.span]);
  const where = $derived(policy.where);
  const result = (k: string) => sync.result(k);

  /** The rule the policy holds, on or off (an off policy projects as no rule). */
  const rule = $derived<ZoningRule | null>(
    where.tag === 'transit' && span?.what.tag === 'bands'
      ? { id: policy.id, kind: 'transit', stopTypes: where.stopTypes, bands: span.what.bands }
      : null
  );

  /** A new coalesce run per selected span, so a later press on the same band is a new undo step. */
  let run = ++runs;
  const key = $derived(`${at.kind}\u0000${at.id}\u0000${at.span}`);
  $effect.pre(() => {
    void key;
    run = ++runs;
  });

  function editRule(next: ZoningRule, coalesce?: string): void {
    const c = coalesce === undefined ? undefined : `${coalesce}@${run}`;
    edit.apply((p) => ({ ...p, rules: [next] }), `Edited: ${ruleChangeLabel(next)}`, c);
  }

  const fundOnly = $derived(
    where.tag === 'baseline'
      ? ({ tag: 'baseline' } as const)
      : where.tag === 'fund'
        ? ({ tag: 'fund', pool: where.pool } as const)
        : where.tag === 'terms'
          ? ({ tag: 'terms' } as const)
          : null
  );
  const hasDebt = $derived(span?.what.tag === 'fund' && (span.what.pool?.debt ?? null) !== null);

  function lotsOf(k: `rule:${string}` | `custom:${string}`): LotStatus {
    const p = edit.policy;
    const id = k.slice(k.indexOf(':') + 1);
    if (k.startsWith('rule:')) {
      const r = p.rules.find((x) => x.id === id);
      return r ? ruleLotStatus(r, result) : { kind: 'finding' };
    }
    const b = p.custom.find((x) => x.id === id);
    return b ? customLotStatus(b, result) : { kind: 'finding' };
  }
</script>

{#if readonly}
  {#if part === 'span'}
    <PolicySummary policy={edit.policy} {calibration} {lotsOf} />
  {/if}
{:else if part === 'policy'}
  {#if rule}
    <TransitLayerRow
      part="stops"
      {rule}
      status={ruleLotStatus(rule, result)}
      {catalog}
      selected={true}
      onselect={() => {}}
      onedit={editRule}
      {onremove}
      onretry={(keys) => keys.forEach((k) => sync.retry(k))}
    />
  {/if}
{:else if rule}
  <TransitLayerRow
    part="bands"
    {rule}
    status={ruleLotStatus(rule, result)}
    {catalog}
    selected={true}
    onselect={() => {}}
    onedit={editRule}
    {onremove}
    onretry={(keys) => keys.forEach((k) => sync.retry(k))}
  />
{:else if where.tag === 'painted'}
  {@render paint()}
{:else if where.tag === 'category'}
  <ProtectionsSection store={edit} only={where.category} {announce} />
{:else if where.tag === 'routes'}
  <PermittingSection
    store={edit}
    {calibration}
    snapshot={false}
    {announce}
    presetLocked={policy.spans.length > 1 ? PRESET_PER_POLICY : null}
  />
{:else if fundOnly !== null && hasMoney(calibration)}
  <FundingTab
    store={edit}
    only={fundOnly}
    termsReadOnly={where.tag === 'fund'}
    priceDay={playheadDay}
    {calibration}
    {drafts}
    {announce}
  />
  {#if hasDebt}
    <p class="text-sm text-ink-muted dark:text-ink-dark-muted">
      <Explain text={TERMS_HINT}>Terms fixed</Explain>
    </p>
  {/if}
{:else}
  <PolicySummary policy={edit.policy} {calibration} {lotsOf} />
{/if}
