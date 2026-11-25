<script lang="ts">
  import { onMount } from 'svelte';
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { formatCount } from '$lib/scoreboard/format';
  import { BUTTON_PRIMARY, SURFACE_POP } from '$lib/shell/ui';
  import AccountOffer from '../AccountOffer.svelte';
  import type { RunResult } from '../run-result';
  import { SIDE_GOALS } from '../side-goals';
  import { useGame } from '../store.svelte';
  import { total } from '../units';
  import { TALLY_ROLL_MS } from './motion';
  import {
    CONTINUE,
    SIDE_GOAL_FALLBACK,
    STAGE_ROWS,
    UNIT_MARK,
    WAITING_MONEY,
    changeText,
    collectedName,
    collectedText,
    homesOfText,
    lumpName,
    lumpText,
    notBuiltTitle,
    sideRewardName,
    sideRewardText,
    tallyTitle
  } from './words';

  interface TallyProps {
    result: RunResult;
    before: number | null;
    deadline: string;
    oncontinue(): void;
  }

  let { result, before, deadline, oncontinue }: TallyProps = $props();

  const game = useGame();
  const titleId = $props.id();
  const stagesId = `${titleId}-stages`;
  let continueButton: HTMLButtonElement | undefined = $state();

  const clamp = (x: number): number => Math.max(0, Math.min(1, x));
  const pct = (fill: number): number => Math.floor(fill * 100);

  const collected = $derived(total(result.collected));
  const dropped = $derived(total(result.dropped));

  // The rolls start from these and run to the result in onMount; with reduced motion they start
  // at the result, so no frame of a roll ever shows.
  // svelte-ignore state_referenced_locally
  const homes = new Tween(prefersReducedMotion.current ? result.homes : (before ?? result.homes), {
    easing: cubicOut
  });
  // svelte-ignore state_referenced_locally
  const units = new Tween(prefersReducedMotion.current ? total(result.collected) : 0, {
    easing: cubicOut
  });

  onMount(() => {
    const duration = prefersReducedMotion.current ? 0 : TALLY_ROLL_MS;
    void homes.set(result.homes, { duration });
    void units.set(collected, { duration });
    continueButton?.focus();
  });

  const shownHomes = $derived(Math.round(homes.current));
  const homesFirst = $derived(formatCount(shownHomes));
  const homesRest = $derived(homesOfText(shownHomes, result.amount).slice(homesFirst.length));
  const homesFill = $derived(result.amount > 0 ? clamp(homes.current / result.amount) : 0);

  const sideLines = $derived(
    result.side.map((e) => {
      const n = total(e.reward);
      const label = SIDE_GOALS.find((g) => g.id === e.id)?.label ?? SIDE_GOAL_FALLBACK;
      return { key: e.id, text: sideRewardText(n, label), name: sideRewardName(n, label) };
    })
  );
  const lump = $derived(result.lump === null ? null : total(result.lump));

  const stageRows = $derived(
    STAGE_ROWS.map((r) => ({
      id: r.id,
      label: r.label,
      count: r.stages.reduce((sum, s) => sum + result.stages[s], 0)
    }))
  );
  const largest = $derived(Math.max(0, ...stageRows.map((r) => r.count), result.waitingMoney ?? 0));
  const share = (count: number): number => (largest > 0 ? clamp(count / largest) : 0);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    oncontinue();
  }
</script>

{#snippet bar(fill: number)}
  <div aria-hidden="true" class="h-1 rounded-full bg-line dark:bg-line-dark" data-fill={pct(fill)}>
    <div
      class="h-full rounded-full bg-ink-muted dark:bg-ink-dark-muted"
      style:width="{fill * 100}%"
    ></div>
  </div>
{/snippet}

{#snippet row(label: string, count: number)}
  <span>{label}</span>
  {@render bar(share(count))}
  <span class="text-right tabular-nums">{formatCount(count)}</span>
{/snippet}

{#if !game.open}
  <!-- Escape is handled for focus inside the card; the dialog itself is not a tab stop. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    role="dialog"
    aria-modal="false"
    aria-labelledby={titleId}
    data-testid="tally"
    class="{SURFACE_POP} flex w-80 max-w-full flex-col gap-3"
    onkeydown={onKeydown}
  >
    <h2 id={titleId} class="text-base font-semibold">
      {tallyTitle(result.reachedOn, deadline)}
    </h2>
    <div data-testid="tally-homes" class="flex flex-col gap-1">
      <p>
        <span aria-hidden="true"><strong class="tabular-nums">{homesFirst}</strong>{homesRest}</span
        ><span class="sr-only">{homesOfText(result.homes, result.amount)}</span>
        {#if before !== null}
          <span data-testid="tally-change" class="ml-1 text-ink-muted dark:text-ink-dark-muted"
            >{changeText(result.homes - before)}</span
          >
        {/if}
      </p>
      <div
        aria-hidden="true"
        class="h-1 rounded-full bg-line dark:bg-line-dark"
        data-testid="tally-bar"
        data-fill={pct(homesFill)}
      >
        <div
          class="h-full rounded-full bg-accent dark:bg-accent-dark"
          style:width="{homesFill * 100}%"
        ></div>
      </div>
    </div>
    <div data-testid="tally-units" class="flex flex-col gap-1">
      <p>
        <span aria-hidden="true"
          >{UNIT_MARK} {collectedText(Math.round(units.current), dropped)}</span
        ><span class="sr-only">{collectedName(collected, dropped)}</span>
      </p>
      {#if lump !== null || sideLines.length > 0}
        <ul class="flex flex-col gap-1">
          {#if lump !== null}
            <li data-testid="tally-lump">
              <span aria-hidden="true">{UNIT_MARK} {lumpText(lump)}</span><span class="sr-only"
                >{lumpName(lump)}</span
              >
            </li>
          {/if}
          {#each sideLines as line, i (`${line.key}-${i}`)}
            <li data-testid="tally-side">
              <span aria-hidden="true">{UNIT_MARK} {line.text}</span><span class="sr-only"
                >{line.name}</span
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <section aria-labelledby={stagesId} class="flex flex-col gap-1">
      <h3 id={stagesId} class="font-semibold">{notBuiltTitle(deadline)}</h3>
      <ul class="flex flex-col gap-1">
        {#each stageRows as r (r.id)}
          <li
            data-testid="tally-stage"
            data-stage={r.id}
            class="grid grid-cols-[7rem_1fr_auto] items-center gap-2"
          >
            {@render row(r.label, r.count)}
          </li>
        {/each}
        {#if result.waitingMoney !== null}
          <li data-testid="tally-money" class="grid grid-cols-[7rem_1fr_auto] items-center gap-2">
            {@render row(WAITING_MONEY, result.waitingMoney)}
          </li>
        {/if}
      </ul>
    </section>
    <button
      type="button"
      class={BUTTON_PRIMARY}
      data-testid="tally-continue"
      onclick={() => oncontinue()}
      bind:this={continueButton}
    >
      {CONTINUE}
    </button>
    <AccountOffer />
  </div>
{/if}
