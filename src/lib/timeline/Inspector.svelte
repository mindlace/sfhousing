<!--
  The editor beside the timeline (rules 10 to 15, 17). It shows, first that applies:
  - "+" (`adding`, bound by the page): the add menu for that kind; a pick is added at the
    playhead's month as one store change "Added: {label}", announced and selected (rule 12).
    "Your own pool" opens a pool draft instead; the draft, once complete, is added the same way.
  - the open pool draft (where a new fund's debt terms are set);
  - a fixed row: what it is, read-only (rule 7);
  - a policy: its switch, Move up / Move down and Remove (rule 13), When (WhenEditor) and What
    (WhatEditor, today's editors on the selected span through `spanLens`). A refused edit's
    reason shows in the alert line.
  `limits` (what is bought): "+" offers only what they allow, adds fitted to them, and under closed
  limits a given measure's What is `PolicySummary`; its switch, order, Remove and When edit as
  today.
  Read-only (rule 17): When as text, What as `PolicySummary`; nothing edits. Selecting another
  policy, opening "+" or closing discards an unfinished funding draft and says so (rule 15). Close
  and Escape call `onclose` (the page focuses the selected bar) and then clear the selection.
  The Inspector never reconciles: the store's `normalize` does (Task 14).
-->
<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { isGiven, OPEN_LIMITS, type Limits } from '$lib/game/limits';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
  import { marketLevel } from '$lib/sim/world/input/market';
  import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import { DRAFT_DISCARDED, limitAlert } from '$lib/sim-page/funding-copy';
  import type { FundingDrafts } from '$lib/sim-page/funding-drafts.svelte';
  import { completeDraft, newOwnPool, type PoolDraft } from '$lib/sim-page/funding-edit';
  import { fundingPresets } from '$lib/sim-page/funding-presets';
  import FundingPoolRow from '$lib/sim-page/FundingPoolRow.svelte';
  import { DEFAULT_POLICY } from '$lib/sim-page/policy';
  import type { PolicyStore } from '$lib/sim-page/policy-store.svelte';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration } from '$lib/timelapse/types';
  import { addPolicy, AddLimitError, poolCount, type AddChoice, type AddOffer } from './add';
  import AddMenu from './AddMenu.svelte';
  import { spanLens, type EditStore } from './lens';
  import { viewMonthOf } from './playhead';
  import type { PolicyKind, SimPolicy4 } from './policy4';
  import type { PolicySync } from './policy-sync.svelte';
  import {
    FIXED_LABEL,
    FIXED_NOTE,
    isFixedRef,
    KIND_LABEL,
    MARKET_ID,
    MARKET_LABEL,
    marketText
  } from './rows';
  import {
    movePolicy,
    policyOf,
    removePolicy,
    setOn,
    type SpanRef,
    type TimelineWindow
  } from './spans';
  import WhatEditor from './WhatEditor.svelte';
  import WhenEditor from './WhenEditor.svelte';

  interface Props {
    store: PolicyStore<SimPolicy4>;
    sync: Pick<PolicySync, 'result' | 'retry'>;
    calibration: Calibration;
    catalog: BrushCatalog | null | undefined;
    drafts: FundingDrafts;
    selected: SpanRef | null;
    onselect(ref: SpanRef | null): void;
    playheadDay: Day;
    asOf: Day;
    readonly: boolean;
    announce(msg: string): void;
    /** Focus goes back to the selected bar when the editor closes. */
    onclose(): void;
    /** The page's PaintTab and tools for a painted policy. */
    paint: Snippet;
    /** The kind whose "+" menu is open (the timeline's "+" sets it), or null. */
    adding?: PolicyKind | null;
    /** What is bought: "+" offers only that, and a given measure's What is read-only. */
    limits?: Limits;
  }

  let {
    store,
    sync,
    calibration,
    catalog,
    drafts,
    selected,
    onselect,
    playheadDay,
    asOf,
    readonly,
    announce,
    onclose,
    paint,
    adding = $bindable(null),
    limits = OPEN_LIMITS
  }: Props = $props();

  const uid = $props.id();
  let root = $state<HTMLElement>();
  let title = $state<HTMLElement>();

  const w = $derived<TimelineWindow>({ asOf, months: WINDOW_MONTHS });
  const playheadMonth = $derived(viewMonthOf(asOf, playheadDay));
  // A fixed ref names no policy: tested before any lookup (rows.ts).
  const fixed = $derived(selected !== null && isFixedRef(selected) ? selected : null);
  const ref = $derived(selected !== null && !isFixedRef(selected) ? selected : null);
  const policy = $derived(ref ? policyOf(store.policy, ref.kind, ref.id) : undefined);
  const index = $derived(ref ? store.policy.kinds[ref.kind].findIndex((p) => p.id === ref.id) : -1);
  const count = $derived(ref ? store.policy.kinds[ref.kind].length : 0);
  const poolDraft = $derived(
    !readonly && adding === null && drafts.draft?.kind === 'pool' ? drafts.draft.pool : null
  );

  // ---- the span lens ----

  /**
   * The store the lens writes through. A transit edit through the lens switches its policy on
   * (an off policy projects as no rule); the switch is the Inspector's, so `on` is kept.
   */
  const through = {
    get policy() {
      return store.policy;
    },
    apply(c: (d: SimPolicy4) => SimPolicy4, label: string, coalesce?: string) {
      store.apply((d) => holdOn(d, c(d)), label, coalesce);
    },
    undo: () => store.undo(),
    redo: () => store.redo()
  };

  function holdOn(before: SimPolicy4, after: SimPolicy4): SimPolicy4 {
    const r = ref;
    if (!r || after === before) return after;
    const b = policyOf(before, r.kind, r.id);
    const a = policyOf(after, r.kind, r.id);
    if (!a || !b || b.where.tag !== 'transit' || a.on === b.on) return after;
    return setOn(after, r.kind, r.id, b.on);
  }

  const lens = spanLens(through, () => ref);
  /** A refused edit's reason (`SpanLens.refused`), shown in the alert line. */
  let refused = $state('');

  const edit: EditStore = {
    get policy() {
      return lens.policy;
    },
    apply(c, label, coalesce) {
      // A fund's pool row "Remove": the pool is the policy, so the policy goes.
      if (policy?.where.tag === 'fund') {
        const before = lens.policy;
        if (before.funding.pools.length > 0 && c(before).funding.pools.length === 0) {
          removeThis();
          return;
        }
      }
      const ok = lens.apply(c, label, coalesce);
      refused = ok ? '' : (lens.refused ?? '');
    }
  };

  // ---- leaving: rule 15 ----

  function discardDraft(): void {
    if (!drafts.isOpen) return;
    drafts.discard();
    announce(DRAFT_DISCARDED);
  }

  const policyKey = (r: SpanRef | null) => (r === null ? '' : `${r.kind}\u0000${r.id}`);
  let lastPolicy = untrack(() => policyKey(selected));
  let lastSpan = untrack(() => selected?.span ?? null);
  $effect.pre(() => {
    const k = policyKey(selected);
    const s = selected?.span ?? null;
    if (k === lastPolicy && s === lastSpan) return;
    const other = k !== lastPolicy;
    lastPolicy = k;
    lastSpan = s;
    untrack(() => {
      refused = '';
      addAlert = '';
      if (!other) return;
      adding = null;
      discardDraft();
    });
  });

  let lastAdding = untrack(() => adding);
  $effect.pre(() => {
    const a = adding;
    if (a === lastAdding) return;
    lastAdding = a;
    if (a === null || readonly) return;
    untrack(discardDraft);
    // Focus moves into the menu (WCAG 2.4.3).
    void tick().then(() => root?.querySelector<HTMLElement>('[data-add-menu] button')?.focus());
  });
  /** The menu, never in view mode (rule 17). */
  const menu = $derived(readonly ? null : adding);

  // The editor going away is a close too.
  $effect(() => () => untrack(discardDraft));

  // A selection the document no longer holds (an undo of an add) is dropped or moved in range.
  $effect(() => {
    const r = ref;
    if (!r) return;
    const p = policy;
    if (!p) onselect(null);
    else if (p.spans.length > 0 && r.span >= p.spans.length)
      onselect({ ...r, span: p.spans.length - 1 });
  });

  function close(): void {
    adding = null;
    discardDraft();
    onclose();
    onselect(null);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // An open explanation takes Escape first (Explain closes on the window's keydown).
    if (root?.querySelector('[role="tooltip"]')) return;
    e.preventDefault();
    close();
  }

  // ---- policy actions (rule 13) ----

  function act(change: (d: SimPolicy4) => SimPolicy4, label: string): void {
    const before = store.policy;
    store.apply(change, label);
    if (store.policy !== before) announce(label);
  }

  function toggleOn(): void {
    if (!ref || !policy) return;
    const { kind, id } = ref;
    const on = !policy.on;
    act((d) => setOn(d, kind, id, on), `${on ? 'Switched on' : 'Switched off'}: ${policy.label}`);
  }

  function move(dir: -1 | 1): void {
    if (!ref || !policy) return;
    const { kind, id } = ref;
    act(
      (d) => movePolicy(d, kind, id, dir),
      `${dir < 0 ? 'Moved up' : 'Moved down'}: ${policy.label}`
    );
  }

  function removeThis(): void {
    if (!ref || !policy) return;
    const { kind, id } = ref;
    act((d) => removePolicy(d, kind, id), `Removed: ${policy.label}`);
    discardDraft();
    onclose();
    onselect(null);
  }

  function whenEdit(change: (d: SimPolicy4) => SimPolicy4, label: string, span?: number): void {
    if (!ref) return;
    const before = store.policy;
    store.apply(change, label);
    if (store.policy === before) return;
    announce(label);
    if (span !== undefined && span !== ref.span) onselect({ ...ref, span });
  }

  // ---- adding (rule 12) ----

  /** A refused add's text (a funding limit), in the menu's alert line. */
  let addAlert = $state('');

  async function focusTitle(): Promise<void> {
    await tick();
    title?.focus();
  }

  /** Adds `choice` at the playhead's month and selects it; false when a limit refused it. */
  function add(choice: AddChoice, label: string): boolean {
    let r: ReturnType<typeof addPolicy>;
    try {
      r = addPolicy(store.policy, choice, {
        w,
        month: playheadMonth,
        cal: calibration,
        limits
      });
    } catch (e) {
      if (e instanceof AddLimitError) {
        addAlert = limitAlert(e.limit);
        return false;
      }
      throw e;
    }
    const msg = `Added: ${label}`;
    store.apply(() => r.doc, msg);
    announce(msg);
    addAlert = '';
    adding = null;
    onselect(r.ref);
    void focusTitle();
    return true;
  }

  /** Added pools in the document, counted as `addPolicy` counts them. */
  const ownPools = $derived(poolCount(store.policy));

  function pick(choice: AddOffer, label: string): void {
    if (choice.kind === 'money' && choice.what === 'ownPool') {
      if (ownPools >= FINANCE_LIMITS.pools) {
        addAlert = limitAlert('pools');
        return;
      }
      addAlert = '';
      // Recorded first, so the selection change below is not taken for leaving a draft.
      lastPolicy = '';
      lastSpan = null;
      adding = null;
      lastAdding = null;
      onselect(null);
      drafts.open({ kind: 'pool', pool: newOwnPool(asOf) });
      void tick().then(() =>
        root?.querySelector<HTMLElement>('[data-funding-editor] [data-field="kind"]')?.focus()
      );
      return;
    }
    add(choice, label);
  }

  /** The pool draft's next state: kept while incomplete, else added as a fund policy. */
  function ondraft(d: PoolDraft): void {
    const next = { kind: 'pool' as const, pool: d };
    const e = completeDraft(next, DEFAULT_POLICY, calibration.baselineFunding);
    if (e === null) {
      drafts.open(next);
      return;
    }
    const pool = e.change(DEFAULT_POLICY).funding.pools[0];
    const { id: _id, ...rest } = pool;
    void _id;
    drafts.discard();
    if (!add({ kind: 'money', what: 'fund', pool: rest }, pool.label)) drafts.open(next);
  }

  function ondiscard(): void {
    drafts.discard();
  }

  const heading = $derived(
    menu !== null
      ? `Add to ${KIND_LABEL[menu]}`
      : poolDraft !== null
        ? 'Your own pool'
        : fixed !== null
          ? fixed.id === MARKET_ID
            ? MARKET_LABEL
            : FIXED_LABEL[fixed.kind]
          : (policy?.label ?? '')
  );
  const shown = $derived(
    menu !== null || poolDraft !== null || fixed !== null || policy !== undefined
  );

  const btn =
    'min-h-6 min-w-6 rounded-md border border-control-line px-2 font-semibold text-ink hover:bg-surface-raised aria-disabled:opacity-40 dark:border-control-line-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised';
  const muted = 'text-ink-muted dark:text-ink-dark-muted';
  const alertClass = (t: string) => `text-sm text-red-800 dark:text-red-300 ${t ? '' : 'sr-only'}`;
</script>

{#if shown}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    bind:this={root}
    data-testid="inspector"
    aria-labelledby="{uid}-title"
    class="flex flex-col gap-3 bg-surface p-3 text-sm text-ink dark:bg-surface-dark dark:text-ink-dark"
    {onkeydown}
  >
    <div class="flex items-start justify-between gap-2">
      <h2 bind:this={title} id="{uid}-title" tabindex="-1" class="text-base font-semibold">
        {heading}
      </h2>
      <button
        type="button"
        aria-label="Close editor"
        class="flex min-h-6 min-w-6 items-center justify-center rounded-md hover:bg-surface-raised dark:hover:bg-surface-dark-raised"
        onclick={close}><span aria-hidden="true">×</span></button
      >
    </div>

    {#if menu !== null}
      <AddMenu kind={menu} {calibration} doc={store.policy} {limits} onpick={pick} />
      <p role="alert" class={alertClass(addAlert)}>{addAlert}</p>
    {:else if poolDraft !== null}
      <ul class="flex flex-col">
        <FundingPoolRow
          pool={poolDraft}
          id={null}
          selected={true}
          policy={DEFAULT_POLICY}
          presets={fundingPresets(calibration)}
          past={{ pool: false, inflows: [] }}
          {asOf}
          onselect={() => {}}
          onedit={() => {}}
          {ondraft}
          {ondiscard}
        />
      </ul>
      <p role="alert" class={alertClass(addAlert)}>{addAlert}</p>
    {:else if fixed !== null}
      <p class={muted}>{KIND_LABEL[fixed.kind]} · whole window</p>
      {#if fixed.id === MARKET_ID}
        <p>{marketText(calibration, marketLevel(calibration))}</p>
      {:else}
        <p>{FIXED_NOTE[fixed.kind]}</p>
      {/if}
    {:else if policy && ref}
      <p class={muted}>{KIND_LABEL[ref.kind]}{policy.on ? '' : ' · off'}</p>
      {#if !readonly}
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={policy.on}
            class="{btn} aria-checked:bg-accent-tint dark:aria-checked:bg-accent-dark/30"
            onclick={toggleOn}>On</button
          >
          <!-- aria-disabled, not disabled: a press that reaches the end keeps focus (2.4.3). -->
          <button
            type="button"
            class={btn}
            aria-disabled={index <= 0 ? 'true' : undefined}
            onclick={() => move(-1)}>Move up</button
          >
          <button
            type="button"
            class={btn}
            aria-disabled={index < 0 || index >= count - 1 ? 'true' : undefined}
            onclick={() => move(1)}>Move down</button
          >
          <button type="button" class={btn} onclick={removeThis}>Remove policy</button>
        </div>
        <WhatEditor
          part="policy"
          {policy}
          at={ref}
          {edit}
          {sync}
          {calibration}
          {catalog}
          {drafts}
          {playheadDay}
          {readonly}
          {limits}
          {announce}
          onremove={removeThis}
          {paint}
        />
      {/if}
      <WhenEditor
        doc={store.policy}
        kind={ref.kind}
        id={ref.id}
        span={ref.span}
        {asOf}
        {playheadMonth}
        {readonly}
        onspan={(i) => onselect({ ...ref, span: i })}
        onedit={whenEdit}
      />
      <section aria-labelledby="{uid}-what" class="flex flex-col gap-2">
        <h3 id="{uid}-what" class="font-semibold">What</h3>
        <WhatEditor
          part="span"
          {policy}
          at={ref}
          {edit}
          {sync}
          {calibration}
          {catalog}
          {drafts}
          {playheadDay}
          readonly={readonly || (!limits.open && isGiven(policy))}
          {limits}
          {announce}
          onremove={removeThis}
          {paint}
        />
      </section>
      {#if !readonly}
        <p role="alert" class={alertClass(refused)}>{refused}</p>
      {/if}
    {/if}
  </section>
{/if}
