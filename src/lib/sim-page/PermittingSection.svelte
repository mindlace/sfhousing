<!--
  "Permitting timelines" (sim-timers plan, Task 4): a preset picker, the set's label with Save and
  Revert, a share input and a timeline for each approval route, and the Local Program line. Every
  change is one labelled store change (Undo names it); a custom edit stays with the set, so
  choosing a preset replaces the edits (Undo brings them back) but keeps the saved snapshot. Share
  inputs commit on `change`, coalesced per route. Each route's timeline is a `RouteTimeline`
  (Task 5): segments, chances, drag handles and the stage details editor. A "Sources and tiers"
  disclosure ends the section: the preset's provenance and the route shares' source.
-->
<script lang="ts">
  import { PATHWAYS, type Calibration, type Pathway } from '$lib/timelapse/types';
  import type { PolicyStore } from './policy-store.svelte';
  import RouteTimeline from './RouteTimeline.svelte';
  import SourceList from './SourceList.svelte';
  import {
    OBSERVED_TIMING,
    PRESETS,
    resolvePreset,
    revertTarget,
    setRouteShare,
    shownRouteShares,
    timingLabel,
    type PresetId,
    type TimingSet
  } from './timing';

  interface Props {
    store: PolicyStore;
    calibration: Calibration;
    /** Speaks a change (WCAG 4.1.3). */
    announce(msg: string): void;
  }
  let { store, calibration, announce }: Props = $props();

  const uid = $props.id();
  const PATHWAY_NAMES: Record<Pathway, string> = {
    discretionary: 'Discretionary',
    streamlined: 'Streamlined',
    permitOnly: 'Permit only'
  };

  const available = PRESETS.filter((p) => p.available);
  const timing = $derived(store.policy.timing);
  const current = $derived(timing.current);
  const label = $derived(timingLabel(current));
  const preset = $derived(PRESETS.find((p) => p.id === current.preset)!);
  /** The weakest evidence among the preset's values (a higher tier is weaker). */
  const tier = $derived(Math.max(...preset.provenance.map((x) => x.tier)));
  const shares = $derived(shownRouteShares(current, calibration));
  const target = $derived(revertTarget(timing, calibration));
  const same = (a: TimingSet, b: TimingSet) => JSON.stringify(a) === JSON.stringify(b);
  const canSave = $derived(!same(current, timing.saved?.set ?? OBSERVED_TIMING.current));

  function choosePreset(id: PresetId): void {
    const set = resolvePreset(id, calibration);
    const name = PRESETS.find((p) => p.id === id)!.name;
    store.apply((p) => ({ ...p, timing: { ...p.timing, current: set } }), `Timelines: ${name}`);
    announce(`Timelines: ${name}`);
  }

  function save(): void {
    const snapshot = { label, set: structuredClone(current) };
    store.apply((p) => ({ ...p, timing: { ...p.timing, saved: snapshot } }), 'Saved timelines');
    announce('Saved timelines');
  }

  function revert(): void {
    if (!target) return;
    const set = structuredClone(target.set);
    const msg = `Reverted to ${target.label}`;
    store.apply((p) => ({ ...p, timing: { ...p.timing, current: set } }), msg);
    announce(msg);
  }

  const sharesList = (r: Record<Pathway, number>) =>
    PATHWAYS.map((p) => `${PATHWAY_NAMES[p].toLowerCase()} ${r[p]} %`).join(', ');

  function sharesText(r: Record<Pathway, number>): string {
    return `Shares now: ${sharesList(r)}`;
  }

  /** The route shares in the records, for comparison with custom shares. */
  const observedShares = $derived(shownRouteShares(OBSERVED_TIMING.current, calibration));

  /** Commits on `change`; an empty or non-numeric entry restores the shown value. */
  function commitShare(p: Pathway, input: HTMLInputElement): void {
    const text = input.value;
    const pct = Number(text);
    if (text.trim() === '' || !Number.isFinite(pct)) {
      input.value = String(shares[p]);
      return;
    }
    const next = setRouteShare(current, calibration, p, pct);
    const after = shownRouteShares(next, calibration);
    if (PATHWAYS.some((x) => after[x] !== shares[x])) {
      store.apply(
        (po) => ({ ...po, timing: { ...po.timing, current: next } }),
        `Route share: ${PATHWAY_NAMES[p]} ${after[p]} %`,
        `share:${p}`
      );
      announce(sharesText(after));
    }
    input.value = String(shownRouteShares(store.policy.timing.current, calibration)[p]);
  }

  const btn =
    'min-h-6 min-w-6 rounded-md border border-gray-300 px-2 font-semibold disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<div class="flex flex-col gap-3 text-sm">
  <label class="flex flex-col gap-1 font-semibold">
    Preset
    <select
      class="min-h-6 rounded-md border border-gray-400 px-1 font-normal pointer-coarse:min-h-11"
      aria-describedby="{uid}-preset-desc"
      value={current.preset}
      onchange={(e) => choosePreset(e.currentTarget.value as PresetId)}
    >
      {#each available as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
  </label>
  <p id="{uid}-preset-desc" class="text-xs text-gray-700">
    {preset.summary} Evidence tier {tier}.
  </p>

  <p class="font-semibold" data-testid="timing-label">{label}</p>
  <div class="flex flex-wrap gap-2">
    <button type="button" class={btn} disabled={!canSave} onclick={save}>Save timelines</button>
    <button
      type="button"
      class={btn}
      disabled={target === null}
      aria-describedby={timing.saved ? `${uid}-revert-desc` : undefined}
      onclick={revert}
    >
      {timing.saved ? 'Revert to saved' : `Revert to ${preset.name}`}
    </button>
    {#if timing.saved}
      <span id="{uid}-revert-desc" class="sr-only"
        >Restores the saved timelines: {timing.saved.label}</span
      >
    {/if}
  </div>

  {#each PATHWAYS as p (p)}
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <h4 class="font-semibold">{PATHWAY_NAMES[p]}</h4>
        <label class="flex items-center gap-1">
          {PATHWAY_NAMES[p]} share, %
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            class="min-h-6 w-16 rounded-md border border-gray-400 px-1 pointer-coarse:min-h-11"
            value={shares[p]}
            onchange={(e) => commitShare(p, e.currentTarget)}
          />
        </label>
      </div>
      <RouteTimeline {store} {calibration} pathway={p} {announce} />
    </div>
  {/each}

  <p>
    Family Zoning Plan Local Program lots {current.localProgramStreamlined ? 'use' : 'do not use'} the
    streamlined route.
  </p>

  <details class="text-xs text-gray-700">
    <summary
      class="flex min-h-6 cursor-pointer items-center font-semibold text-gray-900 pointer-coarse:min-h-11"
      >Sources and tiers</summary
    >
    <div class="mt-1 flex flex-col gap-1">
      <p>{preset.name}:</p>
      <SourceList items={preset.provenance} />
      {#if current.routeShares !== null}
        <p>
          Route shares: your values (custom, not sourced). Observed: {sharesList(observedShares)}.
        </p>
        <SourceList items={[calibration.pathwayForNew.provenance]} />
      {:else if current.presetRouteShares !== null}
        <p>Route shares, from the preset:</p>
        <SourceList items={[...preset.provenance, calibration.pathwayForNew.provenance]} />
      {:else}
        <p>Route shares, as observed:</p>
        <SourceList items={[calibration.pathwayForNew.provenance]} />
      {/if}
      <p>Each stage's own source is in its details: select the stage in a timeline.</p>
    </div>
  </details>
</div>
