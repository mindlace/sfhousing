<!--
  Activity, the detail column's rest face on /sim: what has happened up to the playhead. At today
  it names the goal and offers the starter policies (or says to press Play); after today, the totals
  so far at the playhead's month, cost while a Public money policy is in force, and under "Latest"
  the newest stage changes citywide up to the playhead (one line each). The heading row
  carries Details. While the numbers are stale only the body dims; the heading and its button keep
  their contrast (status apart from controls).
-->
<script lang="ts">
  import { formatDollars } from '$lib/fzp/format';
  import { CALCULATING } from '$lib/fzp/copy';
  import { goalName, type Goal } from '$lib/goal/goal';
  import { formatCount } from '$lib/scoreboard/format';
  import Message from '$lib/shell/Message.svelte';
  import {
    ACTIVITY_COPY as C,
    type ActivityItem,
    type ActivityTotals,
    type Starter
  } from './activity-view';

  interface Props {
    goal: Goal;
    /** Null at today and while the playhead's month is not filled. */
    totals: ActivityTotals | null;
    atToday: boolean;
    /** Offered at today with nothing in force and the sim editable; empty otherwise. */
    starters: Starter[];
    onstarter: (s: Starter) => void;
    ondetails: () => void;
    /** The numbers on show are from before the latest change: the body dims. */
    stale: boolean;
    /** The latest stage changes up to the playhead, newest first (after today). */
    events?: ActivityItem[];
    /** Why the last starter added nothing: a card under the starters at today while set. */
    refusal?: string | null;
    /** The refusal card's Dismiss. */
    ondismissrefusal?: () => void;
    /** Where the refusal's Dismiss puts focus when the starter pressed is gone (the page's
     *  Activity box, focusable by script). */
    fallbackfocus?: () => HTMLElement | null | undefined;
  }

  let {
    goal,
    totals,
    atToday,
    starters,
    onstarter,
    ondetails,
    stale,
    events = [],
    refusal = null,
    ondismissrefusal = undefined,
    fallbackfocus = undefined
  }: Props = $props();

  const uid = $props.id();
  /** The starter last pressed: the refusal's Dismiss puts focus back on it. */
  let pressed: HTMLButtonElement | null = null;
  /**
   * Dismissing removes the focused ×: focus goes to the starter that was pressed, else to the
   * page's `fallbackfocus` (Activity itself), never to the body.
   */
  function dismissRefusal() {
    const to = pressed?.isConnected ? pressed : fallbackfocus?.();
    to?.focus();
    ondismissrefusal?.();
  }
  const signed = (n: number) => `${n < 0 ? '' : '+'}${formatCount(n)}`;
  const BUTTON =
    'inline-flex min-h-6 min-w-6 items-center rounded-md border border-control-line px-2 text-sm font-semibold text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:border-control-line-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:focus-visible:outline-accent-dark';
</script>

{#snippet item(term: string, value: string)}
  <div class="flex items-baseline justify-between gap-4">
    <dt>{term}</dt>
    <dd class="tabular-nums">{value}</dd>
  </div>
{/snippet}

<div class="text-ink dark:text-ink-dark">
  <div class="flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold">{C.heading}</h2>
    <button type="button" class={BUTTON} onclick={ondetails}>{C.details}</button>
  </div>
  <div
    class={['mt-2 text-sm', stale && 'text-ink-muted dark:text-ink-dark-muted']}
    data-testid="tl-activity-body"
    data-stale={stale ? 'true' : undefined}
  >
    {#if atToday}
      <p data-testid="tl-activity-goal">{goalName(goal)}</p>
      {#if starters.length > 0}
        <p class="mt-3 font-semibold" id="{uid}-try">{C.tryOne}</p>
        <ul class="mt-1 flex flex-wrap gap-2" aria-labelledby="{uid}-try">
          {#each starters as s (s.text)}
            <li>
              <button
                type="button"
                class={BUTTON}
                onclick={(e) => {
                  pressed = e.currentTarget;
                  onstarter(s);
                }}>{s.text}</button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-3">{C.play}</p>
      {/if}
      <!-- A refused starter's words, as the "+" menu says them. The region is mounted empty at
           today, so the card is announced once, by it alone; nothing takes focus. -->
      <div role="status" data-testid="tl-activity-refusal" class="contents">
        {#if refusal}
          <div class="mt-3">
            <Message text={refusal} ondismiss={dismissRefusal} />
          </div>
        {/if}
      </div>
    {:else if totals}
      <dl class="flex flex-col gap-1" data-testid="tl-totals">
        {@render item(C.approved, formatCount(totals.approved))}
        {@render item(C.completed, formatCount(totals.completed))}
        {@render item(C.stopped, formatCount(totals.stopped))}
        {#if totals.affordable !== null}
          {@render item(C.affordable, formatCount(totals.affordable))}
        {/if}
        {#if totals.effect !== null}
          {@render item(C.effect, signed(totals.effect))}
        {/if}
        {#if totals.cost}
          {@render item(C.spent, formatDollars(totals.cost.spent))}
          {@render item(
            C.perHome,
            totals.cost.perAddedHome === null
              ? C.noneAdded
              : formatDollars(totals.cost.perAddedHome)
          )}
        {/if}
      </dl>
      <h3 class="mt-3 font-semibold" id="{uid}-latest">{C.latest}</h3>
      {#if events.length > 0}
        <!-- One line each: the place gives way (ellipsis), its full text stays in the DOM. -->
        <ol class="mt-1 flex flex-col gap-1" aria-labelledby="{uid}-latest">
          {#each events as e (e.key)}
            <li class="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
              <span class="w-3 shrink-0 text-accent dark:text-accent-dark">
                {#if e.policy}<span aria-hidden="true">{C.policyMark}</span><span class="sr-only"
                    >{C.underPolicy}</span
                  >{/if}
              </span>
              <span class="shrink-0 font-semibold">{e.stage}</span>
              <span class="shrink-0 tabular-nums">{e.homes}</span>
              {#if e.place}<span class="min-w-0 truncate" title={e.place}>{e.place}</span>{/if}
              <span class="shrink-0 text-ink-muted dark:text-ink-dark-muted"
                >{e.place ? '· ' : ''}{e.when}</span
              >
            </li>
          {/each}
        </ol>
      {:else}
        <p class="mt-1">{C.noEvents}</p>
      {/if}
    {:else}
      <p>{CALCULATING}</p>
    {/if}
  </div>
</div>
