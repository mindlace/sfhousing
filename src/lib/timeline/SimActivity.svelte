<!--
  Activity, the detail column's rest face on /sim: what has happened up to the playhead. At today
  it names the goal and offers the starter policies (or says to press Play); after today, the totals
  so far at the playhead's month, and cost while a Public money policy is in force. The heading row
  carries Details. While the numbers are stale only the body dims; the heading and its button keep
  their contrast (status apart from controls).
-->
<script lang="ts">
  import { formatDollars } from '$lib/fzp/format';
  import { CALCULATING } from '$lib/fzp/copy';
  import { goalName, type Goal } from '$lib/goal/goal';
  import { formatCount } from '$lib/scoreboard/format';
  import { ACTIVITY_COPY as C, type ActivityTotals, type Starter } from './activity-view';

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
  }

  let { goal, totals, atToday, starters, onstarter, ondetails, stale }: Props = $props();

  const uid = $props.id();
  const signed = (n: number) => `${n < 0 ? '' : '+'}${formatCount(n)}`;
  const BUTTON =
    'inline-flex min-h-6 min-w-6 items-center rounded-md border border-control-line px-2 text-sm font-semibold text-ink hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:border-control-line-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:focus-visible:outline-accent-dark pointer-coarse:min-h-11';
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
              <button type="button" class={BUTTON} onclick={() => onstarter(s)}>{s.text}</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-3">{C.play}</p>
      {/if}
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
      <!-- Task 6: the latest stage changes go here, under an h3. -->
    {:else}
      <p>{CALCULATING}</p>
    {/if}
  </div>
</div>
