<!--
  The screen between runs: "Current law", the branches of nested node cards, one open node's
  detail (in its row below 1024 px, in a fifth column from there), and the footer (Task 7).
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import { MediaQuery } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import type { Day } from '$lib/timelapse/time';
  import { BUTTON, BUTTON_PRIMARY, BUTTON_QUIET, SURFACE_POP } from '$lib/shell/ui';
  import type { Rung } from '../ladder';
  import type { NodeId, Units } from '../state';
  import type { NodeView } from '../tree';
  import { total } from '../units';
  import { branchRows, type BranchRows, type TreeRow } from './layout';
  import { REVEAL_MS } from './motion';
  import {
    BOUGHT,
    BRANCH_NAMES,
    CURRENT_LAW,
    EDIT,
    OFF,
    ON,
    SOURCE,
    TREE_TITLE,
    boughtLive,
    buyName,
    buyText,
    editName,
    nextPriceName,
    nextPriceText,
    nextStepText,
    priceName,
    priceText,
    shortText,
    switchName
  } from './words';

  interface TreeProps {
    nodes: NodeView[];
    on: Record<NodeId, boolean>;
    units: Units;
    busy: boolean;
    next: Rung | null;
    ending: { reachedOn: Day; stateBy: Day; perAddedHome: number | null } | null;
    onbuy(id: NodeId): void;
    onedit(id: NodeId): void;
    ontoggle(id: NodeId, on: boolean): void;
    onrun(): void;
    onnext(): void;
    onpublish(): void;
  }

  // The footer's and the ending's props (units, busy, next, ending, onrun, onnext, onpublish)
  // are declared now and read when the footer and the ending are drawn.
  // eslint-disable-next-line svelte/no-unused-props
  const props: TreeProps = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const wide = new MediaQuery('(min-width: 1024px)');

  // A node's fade is global, so a node whose list or branch is new fades too (a local intro skips
  // a block created with its parent); until mount its duration is 0, so nodes present then do not.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });

  let openId: NodeId | null = $state(null);
  /** What the live region says: the last purchase seen in the props. */
  let spoken = $state('');
  /** The node Buy was pressed on and its level then; cleared when the props show it rose. */
  let pending: { id: NodeId; level: number } | null = null;

  const branches = $derived(branchRows(props.nodes));
  const openView = $derived(
    openId === null ? null : (props.nodes.find((v) => v.node.id === openId) ?? null)
  );

  const CONTROL =
    'min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:focus-visible:outline-accent-dark';
  const LOOK_BOUGHT =
    'border border-ink bg-surface-raised dark:border-ink-dark dark:bg-surface-dark-raised';
  const LOOK_OFF =
    'border border-dashed border-control-line text-ink-muted dark:border-control-line-dark dark:text-ink-dark-muted';
  const LOOK_READY = 'border-2 border-accent dark:border-accent-dark';
  const LOOK_SHORT =
    'border border-line text-ink-muted dark:border-line-dark dark:text-ink-dark-muted';

  /** A node id made safe for an element id. */
  const safe = (id: NodeId): string => id.replace(/[^A-Za-z0-9_-]/g, '_');
  const branchId = (b: BranchRows): string => `${uid}-b-${b.branch}`;
  const openButtonId = (id: NodeId): string => `${uid}-open-${safe(id)}`;
  const subId = (id: NodeId): string => `${uid}-sub-${safe(id)}`;
  const detailId = (id: NodeId): string => `${uid}-detail-${safe(id)}`;
  const detailTitleId = (id: NodeId): string => `${uid}-title-${safe(id)}`;
  const shortId = (id: NodeId): string => `${uid}-short-${safe(id)}`;

  const hasSwitch = (id: NodeId): boolean => Object.hasOwn(props.on, id);
  const isOff = (v: NodeView): boolean => hasSwitch(v.node.id) && props.on[v.node.id] === false;

  function look(v: NodeView): string {
    if (v.level > 0) return isOff(v) ? LOOK_OFF : LOOK_BOUGHT;
    return v.state === 'short' ? LOOK_SHORT : LOOK_READY;
  }

  /** The card's second line as drawn (`text`) and as read (`name`, the …Name words). */
  function sub(v: NodeView): { text: string; name: string } {
    const next = v.node.levels[v.level];
    const p = next === undefined ? null : total(next.price);
    const text: string[] = [];
    const name: string[] = [];
    const both = (s: string) => {
      text.push(s);
      name.push(s);
    };
    if (v.level === 0) {
      text.push(priceText(p ?? 0));
      name.push(priceName(p ?? 0));
    } else {
      both(v.node.levels[v.level - 1].step);
      if (isOff(v)) both(OFF);
      if (p !== null) {
        text.push(nextPriceText(p));
        name.push(nextPriceName(p));
      }
    }
    if (v.state === 'short' && v.short !== null) both(shortText(total(v.short)));
    return { text: text.join(' · '), name: name.join(' · ') };
  }

  function toggleOpen(id: NodeId): void {
    openId = openId === id ? null : id;
  }

  function buy(v: NodeView): void {
    if (v.state !== 'ready') return;
    pending = { id: v.node.id, level: v.level };
    props.onbuy(v.node.id);
  }

  // A purchase shows as the node's level rising in the props: say so, and when the node is
  // bought out (Buy is gone) move focus to the detail's heading. Otherwise focus stays on Buy.
  $effect(() => {
    const nodes = props.nodes;
    const p = pending;
    if (p === null) return;
    const v = nodes.find((n) => n.node.id === p.id);
    if (v === undefined || v.level <= p.level) return;
    pending = null;
    spoken = boughtLive(v.node.label, v.node.levels[v.level - 1].step);
    if (v.state !== 'done') return;
    const heading = detailTitleId(v.node.id);
    void tick().then(() => document.getElementById(heading)?.focus());
  });

  async function onKeydown(e: KeyboardEvent): Promise<void> {
    if (e.key !== 'Escape' || openId === null || e.defaultPrevented) return;
    // Handled, not stopped: the header's overlays ignore an Escape already handled.
    e.preventDefault();
    const id = openId;
    openId = null;
    await tick();
    document.getElementById(openButtonId(id))?.focus();
  }
</script>

{#snippet detail(v: NodeView)}
  {@const id = v.node.id}
  {@const next = v.node.levels[v.level]}
  <div
    id={detailId(id)}
    data-testid="tree-detail"
    class="{SURFACE_POP} mt-2 flex flex-col gap-2 lg:sticky lg:top-0 lg:mt-0"
  >
    <h4 id={detailTitleId(id)} tabindex="-1" class="font-semibold">{v.node.label}</h4>
    <p>{v.node.line}</p>
    {#if v.node.levels.length > 1 && next !== undefined}<p>{nextStepText(next.step)}</p>{/if}
    {#if v.node.source}
      {#if v.node.source.href}
        <a
          class="{BUTTON_QUIET} self-start"
          href={v.node.source.href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="tree-source">{v.node.source.text}</a
        >
      {:else}
        <p>{SOURCE}: {v.node.source.text}</p>
      {/if}
    {/if}
    {#if next !== undefined}
      {@const p = total(next.price)}
      {@const short = v.state === 'short'}
      <button
        type="button"
        class="{BUTTON_PRIMARY} self-start"
        data-testid="tree-buy"
        aria-disabled={short ? 'true' : undefined}
        aria-describedby={short ? shortId(id) : undefined}
        onclick={() => buy(v)}
        ><span aria-hidden="true">{buyText(p)}</span><span class="sr-only">{buyName(p)}</span
        ></button
      >
      {#if short && v.short !== null}
        <p id={shortId(id)} class="text-ink-muted dark:text-ink-dark-muted">
          {shortText(total(v.short))}
        </p>
      {/if}
    {:else}
      <p class="font-semibold">{BOUGHT}</p>
    {/if}
  </div>
{/snippet}

{#snippet row(r: TreeRow)}
  {@const v = r.view}
  {@const id = v.node.id}
  {@const open = openId === id}
  {@const sw = hasSwitch(id)}
  {@const line = sub(v)}
  <li
    data-testid="tree-node"
    data-node={id}
    data-state={v.state}
    data-level={v.level}
    data-on={sw ? String(props.on[id]) : undefined}
    in:fade|global={{ duration: !mounted || prefersReducedMotion.current ? 0 : REVEAL_MS }}
  >
    <div class="flex flex-wrap items-center gap-1 rounded-md px-2 py-1 text-sm {look(v)}">
      <button
        type="button"
        id={openButtonId(id)}
        data-testid="tree-node-open"
        aria-expanded={open}
        aria-controls={detailId(id)}
        aria-describedby={subId(id)}
        class="{CONTROL} flex-1 text-left"
        onclick={() => toggleOpen(id)}
      >
        <span class="block font-semibold">{v.node.label}</span>
        <span aria-hidden="true" class="block text-xs">{line.text}</span>
      </button>
      <span id={subId(id)} class="sr-only">{line.name}</span>
      {#if v.level > 0}
        <button
          type="button"
          class={BUTTON}
          data-testid="tree-node-edit"
          aria-label={editName(v.node.label)}
          onclick={() => props.onedit(id)}>{EDIT}</button
        >
      {/if}
      {#if v.level > 0 && sw}
        <button
          type="button"
          role="switch"
          aria-checked={props.on[id]}
          aria-label={switchName(v.node.label)}
          class="{BUTTON} aria-checked:bg-accent-tint dark:aria-checked:bg-accent-dark/30"
          data-testid="tree-node-on"
          onclick={() => props.ontoggle(id, !props.on[id])}>{ON}</button
        >
      {/if}
    </div>
    {#if !wide.current && open}{@render detail(v)}{/if}
    {#if r.children.length}
      <ul class="mt-2 ml-2 flex flex-col gap-2 border-l border-line pl-4 dark:border-line-dark">
        {#each r.children as c (c.view.node.id)}{@render row(c)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<!-- Escape closes an open detail for focus anywhere inside; the section is not a tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  aria-labelledby={titleId}
  data-testid="tree"
  class="flex h-full min-h-0 flex-col bg-surface text-ink dark:bg-surface-dark dark:text-ink-dark"
  onkeydown={onKeydown}
>
  <h2 id={titleId} class="sr-only">{TREE_TITLE}</h2>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <p
      data-testid="tree-root"
      class="mb-4 rounded-md border border-ink bg-surface-raised px-2 py-1 text-sm font-semibold dark:border-ink-dark dark:bg-surface-dark-raised"
    >
      {CURRENT_LAW}
    </p>
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_18rem]">
      {#each branches as b (b.branch)}
        <section aria-labelledby={branchId(b)} data-testid="tree-branch" data-branch={b.branch}>
          <h3 id={branchId(b)} class="mb-2 text-sm font-semibold">{BRANCH_NAMES[b.branch]}</h3>
          <ul class="flex flex-col gap-2">
            {#each b.rows as r (r.view.node.id)}{@render row(r)}{/each}
          </ul>
        </section>
      {/each}
      {#if wide.current && openView !== null}
        <div class="lg:col-start-5 lg:row-start-1">{@render detail(openView)}</div>
      {/if}
    </div>
  </div>
  <div
    class="flex flex-wrap items-center gap-2 border-t border-line p-3 dark:border-line-dark"
  ></div>
  <div class="sr-only" aria-live="polite" data-testid="tree-live">{spoken}</div>
</section>
