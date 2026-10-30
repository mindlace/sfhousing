<!--
  The stock zoning layers (the policy panel's "Zoning layers"): which layers blend, whether the
  City keeps an alternative plan after 2031, and what the plan effect is measured against. Each
  change is one labelled store change, so Undo names it. At least one layer stays checked.
-->
<script lang="ts">
  import { STOCK_LAYERS, type StockLayerId } from '$lib/sim/levers/types';
  import type { PolicyStore } from './policy-store.svelte';
  import type { SimPolicy } from './policy';

  let { store }: { store: PolicyStore } = $props();

  const uid = $props.id();
  const lastId = `${uid}-last`;
  const assumeId = `${uid}-assume`;

  const LAYER_LABEL: Record<StockLayerId, string> = {
    currentLaw: 'Current law (Family Zoning Plan + SB 79 alternative plan)',
    fzp: 'Family Zoning Plan map',
    sb79: 'SB 79 as written',
    base: 'Zoning before the Family Zoning Plan'
  };
  const COMPARE: { id: SimPolicy['compare']; label: string }[] = [
    { id: 'currentLaw', label: 'Current law' },
    { id: 'preFzp', label: 'Zoning before the Family Zoning Plan' }
  ];

  const stock = $derived(store.policy.stock);
  const onlyOne = $derived(stock.length === 1);

  function setLayer(id: StockLayerId, on: boolean): void {
    store.apply(
      (p) => {
        if (p.stock.includes(id) === on) return p;
        const next = STOCK_LAYERS.filter((l) => (l === id ? on : p.stock.includes(l)));
        return next.length === 0 ? p : { ...p, stock: next };
      },
      `${on ? 'Turned on' : 'Turned off'} ${LAYER_LABEL[id]}`
    );
  }

  function setAssume(on: boolean): void {
    store.apply(
      (p) => (p.assumeAlternativePlanKept === on ? p : { ...p, assumeAlternativePlanKept: on }),
      on
        ? 'Assumed the City keeps an alternative plan'
        : 'Stopped assuming the City keeps an alternative plan'
    );
  }

  function setCompare(c: SimPolicy['compare']): void {
    const label = COMPARE.find((x) => x.id === c)!.label;
    store.apply(
      (p) => (p.compare === c ? p : { ...p, compare: c }),
      `Compared against ${label.charAt(0).toLowerCase()}${label.slice(1)}`
    );
  }

  const row =
    'flex min-h-6 items-start gap-2 py-0.5 text-sm pointer-coarse:min-h-11 pointer-coarse:items-center';
  const input = 'mt-0.5 size-4 shrink-0 accent-gray-900 pointer-coarse:mt-0';
</script>

<div class="space-y-4 text-black">
  <fieldset>
    <legend class="sr-only">Zoning layers</legend>
    {#each STOCK_LAYERS as id (id)}
      {@const checked = stock.includes(id)}
      {@const locked = checked && onlyOne}
      <label class={[row, locked && 'text-gray-700']}>
        <input
          type="checkbox"
          class={input}
          {checked}
          disabled={locked}
          aria-describedby={locked ? lastId : undefined}
          onchange={(e) => setLayer(id, e.currentTarget.checked)}
        />
        <span>{LAYER_LABEL[id]}</span>
      </label>
    {/each}
    {#if onlyOne}
      <p id={lastId} class="mt-1 text-xs text-gray-700">At least one layer stays on.</p>
    {/if}
  </fieldset>

  <div>
    <label class={row}>
      <input
        type="checkbox"
        class={input}
        checked={store.policy.assumeAlternativePlanKept}
        aria-describedby={assumeId}
        onchange={(e) => setAssume(e.currentTarget.checked)}
      />
      <span>Assume the City keeps an alternative plan after 2031</span>
    </label>
    <p id={assumeId} class="ml-6 text-xs text-gray-700">
      Otherwise SB 79 as written takes effect on 31 January 2032 (an assumption)
    </p>
  </div>

  <fieldset role="radiogroup">
    <legend class="text-sm font-semibold">Compare against</legend>
    {#each COMPARE as c (c.id)}
      <label class={row}>
        <input
          type="radio"
          class={input}
          name="{uid}-compare"
          value={c.id}
          checked={store.policy.compare === c.id}
          onchange={() => setCompare(c.id)}
        />
        <span>{c.label}</span>
      </label>
    {/each}
  </fieldset>
</div>
