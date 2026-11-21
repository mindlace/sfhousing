<!--
  One goal row: the label and its percentage, a meter on a shared track with a tick at the goal,
  then the remainder with its date. TargetRow's markup, read from GoalRowData, with no caption
  under the tick (the label names the goal).
-->
<script lang="ts">
  import { formatPercent } from '$lib/scoreboard/format';
  import { fillPercent, remainderText, tickPercent } from '$lib/scoreboard/view';
  import { atDeadlineText, type GoalRowData } from './goal';

  interface Props {
    row: GoalRowData;
    /** Shared track full-scale (trackMax over the rows). */
    max: number;
    primary: boolean;
  }
  let { row, max, primary }: Props = $props();
  // The light and dark surface tokens: the row sits on the detail column on every page.
  const TRACK = 'bg-gray-200 dark:bg-line-dark';
  const FILL = 'bg-accent dark:bg-accent-dark';
  const TICK = 'bg-ink dark:bg-ink-dark';
  const MUTED = 'text-ink-muted dark:text-ink-dark-muted';
  const BODY = 'text-ink dark:text-ink-dark';
  const tick = $derived(tickPercent(max));
  /** 'by …' follows the remainder; 'Held at …' gets its own line. */
  const inline = $derived(row.note !== null && row.note.startsWith('by'));
</script>

<div class="mt-3" data-testid="goal-row-{row.id}" data-primary={String(primary)}>
  <div class="flex items-baseline justify-between gap-2">
    <span class={primary ? 'text-sm font-semibold' : 'text-sm'}>{row.label}</span>
    <span class={primary ? 'text-lg font-bold tabular-nums' : 'text-sm tabular-nums'}
      >{formatPercent(row.fraction)}</span
    >
  </div>
  <div
    role="meter"
    aria-label={row.label}
    aria-valuemin={0}
    aria-valuemax={max * row.amount}
    aria-valuenow={row.value}
    aria-valuetext="{formatPercent(row.fraction)} of {row.label}"
    class="relative mt-1 mb-1.5 overflow-visible rounded-sm {TRACK} {primary ? 'h-4' : 'h-2.5'}"
  >
    <div
      data-testid="bar-fill"
      class="absolute inset-y-0 left-0 rounded-sm {FILL}"
      style:width="{fillPercent(row.fraction, max)}%"
    ></div>
    <div
      data-testid="bar-tick"
      class="absolute -inset-y-1 w-0.5 -translate-x-1/2 {TICK}"
      style:left="{tick}%"
    ></div>
  </div>
  <p class="text-sm tabular-nums {BODY}">
    {remainderText(row.value, row.amount)}{inline ? ` ${row.note}` : ''}
  </p>
  {#if row.note !== null && !inline}
    <p class="text-sm {MUTED}">{row.note}</p>
  {/if}
  {#if row.atDeadline !== null}
    <p class="text-sm tabular-nums {MUTED}">{atDeadlineText(row.atDeadline)}</p>
  {/if}
</div>
