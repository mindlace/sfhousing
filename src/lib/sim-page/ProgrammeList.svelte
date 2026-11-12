<!--
  The programme rows of a pool's or a baseline group's "What it pays for" (funding-ui spec 4.5
  item 4, 4.8, 4.6): one ProgrammeEditor per programme on `pools` (an open draft of one shown in
  its place), a new programme's draft after them, then "+ What it pays for", named
  `addProgrammeName` and aria-disabled with its reason while a draft is open or the policy holds
  24 programmes. One programme row is selected at a time (page memory of this list).
  Focus: after an add, the new row's "Pays from" (City group) or "For"; after a remove, the row
  now at its index, else "+ What it pays for"; after a discard, the programme's row or the button.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Pool } from '$lib/timelapse/types';
  import type { FundingEdit, Refused } from './funding-edit';
  import type { SimPolicy } from './policy';
  import ProgrammeEditor, { type ProgrammeHost } from './ProgrammeEditor.svelte';

  interface Props {
    /** The pools whose programmes are listed. */
    pools: Pool[];
    /** The pool a new programme pays from (the City group's first pool in dataset order). */
    addPool: Pool;
    /** "Pays from" choices (the City group), or null. */
    poolChoices: Pool[] | null;
    /** "+ What it pays for"'s accessible name. */
    addName: string;
    /** "Added" before each sentence (programmes on a baseline group's pools). */
    added?: boolean;
    policy: SimPolicy;
    host: ProgrammeHost;
    onedit: (e: FundingEdit | Refused) => void;
  }

  let {
    pools,
    addPool,
    poolChoices,
    addName,
    added = false,
    policy,
    host,
    onedit
  }: Props = $props();

  const uid = $props.id();
  let root = $state<HTMLDivElement>();

  const ids = $derived(new Set(pools.map((p) => p.id)));
  const progs = $derived(policy.funding.programmes.filter((g) => ids.has(g.pool)));
  const draft = $derived(host.draft !== null && ids.has(host.draft.pool) ? host.draft : null);
  const newDraft = $derived(draft !== null && draft.replaces === null ? draft : null);
  const poolOf = (id: string): Pool => pools.find((p) => p.id === id) ?? addPool;

  let picked = $state<string | null>(null);
  /**
   * The selected programme, while it still exists: an undo that removes it clears the selection
   * in the same render, and the effect forgets it, so a redo does not bring it back (SimPage's
   * rule for layers).
   */
  const selected = $derived(picked !== null && progs.some((g) => g.id === picked) ? picked : null);
  $effect(() => {
    if (picked !== null && selected === null) picked = null;
  });
  // A selection change ends the tab's coalesce run, so a later edit is its own undo step (4.9).
  $effect.pre(() => {
    void selected;
    untrack(() => host.onpick());
  });

  const rowOf = (key: string): HTMLElement | null =>
    root?.querySelector<HTMLElement>(`[data-prog-row="${key}"]`) ?? null;
  const addButton = (): HTMLElement | null =>
    root?.querySelector<HTMLElement>('[data-prog-add]') ?? null;

  async function focusFirst(key: string): Promise<void> {
    await tick();
    const r = rowOf(key);
    (
      r?.querySelector<HTMLElement>('[data-field="prog-pool"]') ??
      r?.querySelector<HTMLElement>('[data-field^="prog-reach-"]:checked')
    )?.focus();
  }

  function add(): void {
    if (host.addDisabled !== null) return;
    const key = host.onadd(addPool);
    if (key === null) return;
    if (key !== 'draft') picked = key;
    void focusFirst(key);
  }

  function ondraft(d: Parameters<ProgrammeHost['ondraft']>[0], field: string): void {
    const key = host.ondraft(d, field);
    if (key !== null) picked = key;
  }

  function discard(replaces: string | null): void {
    host.ondiscard();
    void tick().then(() =>
      (
        (replaces === null ? null : rowOf(replaces)?.querySelector<HTMLElement>('button')) ??
        addButton()
      )?.focus()
    );
  }

  function edit(i: number, id: string, e: FundingEdit | Refused): void {
    onedit(e);
    if (policy.funding.programmes.some((g) => g.id === id)) return;
    // Removed: the row now at its index, else "+ What it pays for" (4.9).
    if (picked === id) picked = null;
    void tick().then(() => {
      const next = progs[i];
      (
        (next === undefined ? null : rowOf(next.id)?.querySelector<HTMLElement>('button')) ??
        addButton()
      )?.focus();
    });
  }

  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
  const muted = 'text-ink-muted dark:text-ink-dark-muted';
</script>

<div bind:this={root} class="flex flex-col gap-1">
  {#if progs.length > 0 || newDraft !== null}
    <ul class="flex flex-col gap-1">
      {#each progs as g, i (g.id)}
        {@const d = draft !== null && draft.replaces === g.id ? draft : null}
        <ProgrammeEditor
          prog={d === null ? g : d.prog}
          id={g.id}
          pool={poolOf(d === null ? g.pool : d.pool)}
          {poolChoices}
          {policy}
          baseline={host.baseline}
          asOf={host.asOf}
          slope={host.slope}
          presets={host.presets}
          selected={selected === g.id}
          {added}
          onselect={() => (picked = selected === g.id ? null : g.id)}
          onedit={(e) => edit(i, g.id, e)}
          {ondraft}
          ondiscard={() => discard(g.id)}
          ongoterms={host.ongoterms}
        />
      {/each}
      {#if newDraft !== null}
        <ProgrammeEditor
          prog={newDraft.prog}
          id={null}
          pool={poolOf(newDraft.pool)}
          {poolChoices}
          {policy}
          baseline={host.baseline}
          asOf={host.asOf}
          slope={host.slope}
          presets={host.presets}
          selected={true}
          {added}
          onselect={() => {}}
          {onedit}
          {ondraft}
          ondiscard={() => discard(null)}
          ongoterms={host.ongoterms}
        />
      {/if}
    </ul>
  {/if}
  <div class="flex flex-col items-start gap-0.5">
    <!-- aria-disabled, not disabled: it keeps focus, and its reason is its description. -->
    <button
      type="button"
      data-prog-add
      class={link}
      aria-label={addName}
      aria-disabled={host.addDisabled !== null ? 'true' : undefined}
      aria-describedby={host.addDisabled !== null ? `${uid}-add-off` : undefined}
      onclick={add}><span aria-hidden="true">+</span> What it pays for</button
    >
    {#if host.addDisabled !== null}
      <span id="{uid}-add-off" class={muted}>{host.addDisabled}</span>
    {/if}
  </div>
</div>
