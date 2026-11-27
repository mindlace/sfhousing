<!--
  The pane of a policy the game keeps fixed (a "New" row): its values in words, with no control.
  An h2 with the policy's label and Close, "Zoning · off · New", the entry's line, a list of its
  values (zoning: the stop types and each band; others: the rules), When, how it becomes editable
  and the source. Escape closes. The row's switch is the only control the policy has.
-->
<script lang="ts">
  import { formatShortMonthYear } from '$lib/fzp/format';
  import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
  import { rulesText, type RoundEntry } from '$lib/game/catalogue/rounds';
  import { STOP_LABELS } from '$lib/sim-page/brush-summary';
  import { bandsInnermostFirst } from '$lib/sim-page/policy';
  import type { Day } from '$lib/timelapse/time';
  import type { Policy, PolicyKind } from './policy4';
  import { KIND_LABEL } from './rows';
  import { spanMonths } from './spans';

  interface Props {
    kind: PolicyKind;
    policy: Policy;
    entry: RoundEntry | undefined;
    asOf: Day;
    onclose: () => void;
  }

  let { kind, policy, entry, asOf, onclose }: Props = $props();

  const uid = $props.id();
  const metres = (m: number): string => m.toLocaleString('en-US');

  /** Each band of the policy's first bands span: its distance and its height in words. */
  const bandRows = $derived.by(() => {
    const span = policy.spans.find((s) => s.what.tag === 'bands');
    if (span === undefined || span.what.tag !== 'bands') return [];
    const sorted = bandsInnermostFirst(span.what.bands);
    const fixed = entry?.kind === 'zoning' ? entry.bands : [];
    return sorted.map((b, i) => {
      const same = fixed[i]?.maxM === b.maxM && fixed[i]?.stories === b.stories;
      const stories = `${b.stories} ${b.stories === 1 ? 'story' : 'stories'}`;
      return {
        term:
          i === 0
            ? `Within ${metres(b.maxM)} m`
            : `${metres(sorted[i - 1].maxM)} to ${metres(b.maxM)} m`,
        text: same ? `${stories} (${fixed[i].ft} ft)` : stories
      };
    });
  });
  const stops = $derived(
    policy.where.tag === 'transit'
      ? policy.where.stopTypes.map((t) => STOP_LABELS[t]).join(', ')
      : ''
  );
  const when = $derived.by(() => {
    const s = policy.spans[0];
    if (s === undefined) return '';
    const m = spanMonths(s, asOf);
    const from = formatShortMonthYear(monthFirstDay(asOf, m.from));
    return m.to === null
      ? `${from}, no end`
      : `${from} to ${formatShortMonthYear(monthLastDay(asOf, m.to))}`;
  });
  const rules = $derived(entry === undefined ? '' : rulesText(entry, policy));

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    onclose();
  }

  const term = 'text-ink-muted dark:text-ink-dark-muted';
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  data-testid="policy-details"
  aria-labelledby="{uid}-title"
  class="flex flex-col gap-3 bg-surface p-3 text-sm text-ink dark:bg-surface-dark dark:text-ink-dark"
  {onkeydown}
>
  <div class="flex items-start justify-between gap-2">
    <h2 id="{uid}-title" tabindex="-1" class="text-base font-semibold">{policy.label}</h2>
    <button
      type="button"
      aria-label="Close details"
      class="flex min-h-6 min-w-6 items-center justify-center rounded-md hover:bg-surface-raised dark:hover:bg-surface-dark-raised"
      onclick={onclose}><span aria-hidden="true">×</span></button
    >
  </div>
  <p class={term}>{KIND_LABEL[kind]} · {policy.on ? 'on' : 'off'} · New</p>
  {#if entry}<p>{entry.line}</p>{/if}
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
    {#if kind === 'zoning'}
      <dt class={term}>Stops</dt>
      <dd>{stops}</dd>
      {#each bandRows as b (b.term)}
        <dt class={term}>{b.term}</dt>
        <dd>{b.text}</dd>
      {/each}
    {:else if rules !== ''}
      <dt class={term}>Rules</dt>
      <dd>{rules.charAt(0).toUpperCase() + rules.slice(1)}</dd>
    {/if}
    <dt class={term}>When</dt>
    <dd>{when}</dd>
  </dl>
  <p class={term}>Editable after a win with it on.</p>
  {#if entry?.source}
    {#if entry.source.href}
      <a
        class="self-start font-semibold underline"
        href={entry.source.href}
        target="_blank"
        rel="noopener">{entry.source.text}</a
      >
    {:else}
      <p class={term}>{entry.source.text}</p>
    {/if}
  {/if}
</section>
