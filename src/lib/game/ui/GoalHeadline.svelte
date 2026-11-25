<!--
  The header's pinned goal: line 1 the homes of the amount by the deadline (a rolling count), a bar,
  line 2 what the goal unlocks and the side goals met. The button opens the side goals pop-over,
  placed under the box against the header (the nearest positioned ancestor).
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import { SURFACE_POP } from '$lib/shell/ui';
  import type { SideGoal } from '../side-goals';
  import { useGame } from '../store.svelte';
  import { total } from '../units';
  import { MET_MS, ROLL_MS } from './motion';
  import {
    GOAL_MET,
    HOMES_WORD,
    LAST_GOAL,
    MET,
    NO_SIDE_GOALS,
    SIDE_GOALS_TITLE,
    goalLine,
    goalMetLive,
    priceText,
    progressText,
    sideMetLive,
    sideMetText,
    unitsName,
    unlocksText
  } from './words';

  interface GoalHeadlineProps {
    homes: number | null;
    amount: number;
    deadline: string;
    unlocks: string | null;
    met: boolean;
    side: { goal: SideGoal; value: number; target: number; met: boolean }[];
  }

  let { homes, amount, deadline, unlocks, met, side }: GoalHeadlineProps = $props();

  const game = useGame();
  const uid = $props.id();
  const popId = `${uid}-side`;
  const line2Id = `${uid}-line2`;

  let open = $state(false);
  /** The pop-over's left edge in the header's box, measured at open. */
  let left = $state(16);
  let root = $state<HTMLSpanElement>();
  let box = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();

  const clamp = (x: number): number => Math.max(0, Math.min(1, x));
  const pct = (fill: number): number => Math.floor(fill * 100);

  // The rolling count. It starts at the count given; each later change rolls over ROLL_MS, or
  // jumps with reduced motion or when the count comes from null.
  // svelte-ignore state_referenced_locally
  const tween = new Tween(homes ?? 0, { easing: cubicOut });
  /** The count last seen; undefined until the first run. */
  let homesBefore: number | null | undefined;
  $effect(() => {
    const h = homes;
    const was = homesBefore;
    homesBefore = h;
    if (was === undefined || h === null || h === was) return;
    untrack(() => {
      const duration = was === null || prefersReducedMotion.current ? 0 : ROLL_MS;
      void tween.set(h, { duration });
    });
  });

  const shownHomes = $derived(homes === null ? null : Math.round(tween.current));
  const shownLine = $derived(goalLine(shownHomes, amount, deadline));
  const cut = $derived(shownLine.indexOf(HOMES_WORD));
  const fill = $derived(shownHomes === null || amount <= 0 ? 0 : clamp(shownHomes / amount));

  const sideMet = $derived(side.filter((e) => e.met).length);
  const line2 = $derived(
    [
      met ? GOAL_MET : unlocks !== null ? unlocksText(unlocks) : LAST_GOAL,
      ...(sideMet > 0 ? [sideMetText(sideMet)] : [])
    ].join(' · ')
  );

  // What a screen reader is told: a goal met and side goals met after mount, never at mount.
  let spoken = $state('');
  let seen: { met: boolean; side: Map<string, boolean> } | null = null;
  $effect(() => {
    const now = { met, side: new Map(side.map((e) => [e.goal.id, e.met])) };
    const prev = seen;
    seen = now;
    if (prev === null) return;
    const parts: string[] = [];
    if (met && !prev.met) parts.push(goalMetLive(amount, deadline));
    for (const e of side) {
      if (e.met && prev.side.get(e.goal.id) === false) parts.push(sideMetLive(e.goal.label));
    }
    if (parts.length > 0) spoken = parts.join(' · ');
  });

  // The goal met moment: data-flash for MET_MS when met turns true after mount.
  let flash = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let metBefore: boolean | undefined;
  $effect(() => {
    const was = metBefore;
    metBefore = met;
    if (was !== false || !met) return;
    flash = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = false), MET_MS);
  });
  $effect(() => () => clearTimeout(flashTimer));

  const openOnly = headerOverlay('goal-side', () => (open = false));

  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    if (box) {
      const header = box.closest('header');
      const h = header?.getBoundingClientRect() ?? { left: 0, width: innerWidth };
      const b = box.getBoundingClientRect();
      const width = Math.min(288, h.width - 32);
      const centre = b.left + b.width / 2 - h.left;
      left = Math.max(16, Math.min(centre - width / 2, h.width - width - 16));
    }
    open = true;
    openOnly();
  }

  async function onkeydown(e: KeyboardEvent): Promise<void> {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog:modal')) return;
    e.preventDefault();
    open = false;
    await tick();
    button?.focus();
  }

  function onpointerdown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (!open || !t || root?.contains(t)) return;
    open = false;
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

{#snippet bar(f: number, testid?: string)}
  <span
    aria-hidden="true"
    data-testid={testid}
    data-fill={pct(f)}
    class="block h-1 w-full rounded-full bg-line dark:bg-line-dark"
    ><span class="block h-full rounded-full bg-accent dark:bg-accent-dark" style:width="{f * 100}%"
    ></span></span
  >
{/snippet}

{#if !game.open}
  <span class="inline-flex" data-testid="goal-headline" bind:this={root}>
    <div
      bind:this={box}
      data-testid="goal-box"
      data-met={met || undefined}
      data-flash={flash || undefined}
      style:--goal-met-ms="{MET_MS}ms"
      class="relative flex max-w-80 min-w-6 flex-col justify-center gap-0.5 rounded-md border border-gray-300 bg-surface px-2 text-sm leading-tight whitespace-nowrap text-ink tabular-nums hover:bg-surface-raised has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-accent dark:border-gray-600 dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:has-[button:focus-visible]:outline-accent-dark"
    >
      <!-- At most 44 px: line 1 17.5, the bar 4, line 2 15 (text-xs sets its own 16 px line
           height, hence leading-tight), two 2 px gaps and the border; no vertical padding, which
           would bring it to 46.5. -->
      <!-- The box is the button's target (its ::before covers it). Line 1 as drawn rolls; the
           sr-only copy names the button with the true count. -->
      <button
        bind:this={button}
        type="button"
        data-testid="goal-headline-button"
        aria-expanded={open}
        aria-controls={popId}
        aria-describedby={line2Id}
        class="text-left font-semibold before:absolute before:inset-0 before:content-[''] focus-visible:outline-none"
        onclick={toggle}
        ><span aria-hidden="true"
          >{#if cut < 0}{shownLine}{:else}{shownLine.slice(0, cut)}<span class="max-sm:sr-only"
              >{HOMES_WORD}</span
            >{shownLine.slice(cut + HOMES_WORD.length)}{/if}</span
        ><span class="sr-only">{goalLine(homes, amount, deadline)}</span></button
      >
      {@render bar(fill, 'goal-bar')}
      <span
        aria-hidden="true"
        data-testid="goal-line2"
        class="pointer-events-none truncate text-xs leading-tight font-medium text-ink-muted max-sm:hidden dark:text-ink-dark-muted"
        >{line2}</span
      >
      <span id={line2Id} class="sr-only">{line2}</span>
      {#if sideMet > 0}<span
          aria-hidden="true"
          data-testid="goal-side-mark"
          class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent dark:bg-accent-dark"
        ></span>{/if}
    </div>
    {#if open}
      <div
        id={popId}
        data-testid="side-goals"
        class="{SURFACE_POP} absolute top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)]"
        style:left="{left}px"
      >
        <h2 class="text-base font-semibold">{SIDE_GOALS_TITLE}</h2>
        {#if side.length === 0}
          <p class="mt-1 text-ink-muted dark:text-ink-dark-muted">{NO_SIDE_GOALS}</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-3">
            {#each side as e (e.goal.id)}
              {@const reward = total(e.goal.reward)}
              <li
                data-testid="side-goal"
                data-goal={e.goal.id}
                data-met={e.met || undefined}
                class="flex flex-col gap-1"
              >
                <span class="font-semibold">{e.goal.label}</span>
                {@render bar(clamp(e.value / e.target))}
                <span class="flex justify-between gap-2 tabular-nums">
                  <span>{progressText(e.value, e.target)}</span>
                  <span
                    ><span aria-hidden="true">{priceText(reward)}</span><span class="sr-only"
                      >{unitsName(reward)}</span
                    ></span
                  >
                </span>
                {#if e.met}<span class="font-semibold">{MET}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </span>
  <span class="sr-only" aria-live="polite" data-testid="goal-live">{spoken}</span>
{/if}

<style>
  [data-flash] {
    --goal-flash: var(--color-accent);
    outline: 2px solid var(--goal-flash);
  }
  @media (prefers-color-scheme: dark) {
    [data-flash] {
      --goal-flash: var(--color-accent-dark);
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    [data-flash] {
      animation: goal-met var(--goal-met-ms) ease-out 1 forwards;
    }
  }
  @keyframes goal-met {
    from {
      outline-color: var(--goal-flash);
    }
    to {
      outline-color: transparent;
    }
  }
</style>
