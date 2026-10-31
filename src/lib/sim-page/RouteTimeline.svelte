<!--
  One approval route's editable timeline (sim-timers plan, Task 5; Calls 13 and 14). The bar is a
  roving-tabindex group of segment buttons (Left and Right move, Home and End jump, Enter, Space
  or a click toggles the stage's details); each segment's width is its typical months' share of
  the route, at least 24 px (CSS flex does the redistribution). Under each boundary the chance of
  moving on is drawn `aria-hidden`: it is already in the segment's name.

  The keyboard and single-pointer path is the details editor: a "Typical months" input and − / +
  buttons, each committing one store change, coalesced per stage. Drag handles are a fine-pointer
  enhancement (WCAG 2.5.7): `aria-hidden`, 24 × 24 px, previewing in months (the route's px per
  month) clamped to `stageBounds`, and committing one store change on pointer-up. They sit in a
  row under the bar, centred on the boundaries, so they never cover a segment. A handle press
  that does not move toggles that stage's details. Losing the capture (or a cancel) before
  pointer-up drops the preview and commits nothing; after pointer-up it is a no-op, as the
  pointer-up already committed and cleared the drag.
-->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import type { TimedStage } from '$lib/sim/levers/types';
  import { MONTH_DAYS } from '$lib/timelapse/time';
  import type { Calibration, ExitReason, Pathway, Provenance } from '$lib/timelapse/types';
  import type { PolicyStore } from './policy-store.svelte';
  import { PRESETS, routeView, setStageMonths, type StageView } from './timing';

  interface Props {
    store: PolicyStore;
    calibration: Calibration;
    pathway: Pathway;
    /** Speaks a change (WCAG 4.1.3). */
    announce(msg: string): void;
  }
  let { store, calibration, pathway, announce }: Props = $props();

  const uid = $props.id();
  const ROUTE_NAMES: Record<Pathway, string> = {
    discretionary: 'Discretionary',
    streamlined: 'Streamlined',
    permitOnly: 'Permit only'
  };
  /** The order the details list the exit reasons in. */
  const EXITS: ExitReason[] = ['withdrawn', 'cancelled', 'expired', 'disapproved'];
  const STEP = 0.5;
  /** Pointer travel, in px, below which a handle press is a tap (it toggles the details). */
  const TAP_PX = 3;

  const fine = new MediaQuery('(pointer: fine)');
  const routeName = $derived(ROUTE_NAMES[pathway]);
  const current = $derived(store.policy.timing.current);
  const views = $derived(routeView(calibration, current, pathway));
  const observedProvenance = PRESETS.find((p) => p.id === 'observed')!.provenance;
  const preset = $derived(PRESETS.find((p) => p.id === current.preset)!);

  interface Drag {
    stage: TimedStage;
    startX: number;
    startMonths: number;
    pxPerMonth: number;
    /** The months the pointer asks for, unclamped (so the commit reports a bound). */
    want: number;
    /** The preview: `want` rounded to 0.5 and clamped to the bounds. */
    months: number;
    moved: boolean;
  }
  let drag = $state<Drag | null>(null);
  let trackPx = $state(0);
  let open = $state<string | null>(null);
  let active = $state(0);
  let buttons = $state<HTMLButtonElement[]>([]);

  const roundHalf = (x: number) => Math.round(x / STEP) * STEP;
  const pct = (x: number) => Math.round(x * 100);
  const monthsText = (m: number) => (m === 1 ? '1 month' : `${m} months`);

  function boundOf(v: StageView, m: number): 'min' | 'max' | null {
    if (!v.bounds) return null;
    if (m <= v.bounds.min) return 'min';
    if (m >= v.bounds.max) return 'max';
    return null;
  }

  /** The views with the drag preview applied to the dragged stage. */
  const shown = $derived(
    views.map((v) =>
      drag !== null && drag.stage === v.stage
        ? { ...v, months: drag.months, atBound: boundOf(v, drag.months) }
        : v
    )
  );

  function segmentName(v: StageView): string {
    const bound =
      v.atBound === 'min' ? ', at the minimum' : v.atBound === 'max' ? ', at the maximum' : '';
    return (
      `${v.label}, ${monthsText(v.months)}, ${pct(v.advance)}% move on` +
      `${v.editable ? '' : ', locked'}${bound}`
    );
  }

  const detailsId = (stage: string) => `${uid}-${stage}-details`;
  const hasEdit = (stage: string) =>
    current.edits.some((e) => e.pathway === pathway && e.stage === stage);

  function chancesText(v: StageView): string {
    const exits = EXITS.filter((r) => (v.exits[r] ?? 0) > 0).map(
      (r) => `${pct(v.exits[r]!)}% ${r}`
    );
    const head = `Of projects in this stage, ${pct(v.advance)}% move on`;
    return exits.length > 0 ? `${head}; ${exits.join(', ')}` : head;
  }

  function reachText(v: StageView): string | null {
    if (hasEdit(v.stage) || v.reach === 'all' || v.reach === 'mixed') {
      return 'Applies to every project, including those already in this stage';
    }
    if (v.reach === 'new') return 'Applies to projects filing after the policy starts';
    return null;
  }

  function minimumText(v: StageView): string {
    const b = v.bounds!;
    const f = v.floor;
    if (b.minBy === 'floor' && f && f.value !== null) {
      return `Minimum: ${monthsText(b.min)} (${f.provenance.label}, tier ${f.provenance.tier})`;
    }
    if (!f || f.value === null) return 'No sourced minimum; numerical limit ×0.05';
    return `Minimum: ${monthsText(b.min)} (numerical limit ×0.05)`;
  }

  /** The preset's sources when it sets this stage, else the calibration's own (observed). */
  function sourcesOf(v: StageView): Provenance[] {
    const touched =
      !hasEdit(v.stage) &&
      current.presetTimers.some((t) => t.pathway === pathway && t.stage === v.stage);
    return touched ? preset.provenance : observedProvenance;
  }

  const monthsNow = (stage: string) =>
    routeView(calibration, store.policy.timing.current, pathway).find((v) => v.stage === stage)!
      .months;

  /**
   * Sets a stage's months for every project: one store change (coalesced by `coalesce`), then
   * the announcement, which names a bound when the value reached one. No change, no entry.
   */
  function commit(v: StageView, months: number, coalesce?: string): void {
    const stage = v.stage as TimedStage;
    const before = monthsNow(stage);
    const { set, clamped } = setStageMonths(calibration, current, pathway, stage, months);
    const after = routeView(calibration, set, pathway).find((x) => x.stage === stage)!.months;
    const changed = after !== before;
    const label = `${v.label}, ${routeName.toLowerCase()} to ${monthsText(after)}`;
    if (changed) {
      store.apply((p) => ({ ...p, timing: { ...p.timing, current: set } }), label, coalesce);
    }
    const bound = clamped ?? (changed ? boundOf(v, after) : null);
    if (bound !== null) {
      const word = bound === 'min' ? 'minimum' : 'maximum';
      announce(`Reached the ${word} for ${v.label}: ${monthsText(after)}`);
    } else if (changed) {
      announce(label);
    }
  }

  const keyOf = (stage: string) => `stage:${pathway}:${stage}`;

  /** Commits on `change`; an empty or non-numeric entry restores the shown value. */
  function commitInput(v: StageView, input: HTMLInputElement): void {
    const text = input.value;
    const m = Number(text);
    if (text.trim() !== '' && Number.isFinite(m)) commit(v, m, keyOf(v.stage));
    input.value = String(monthsNow(v.stage));
  }

  function step(v: StageView, dir: 1 | -1): void {
    if (v.atBound === (dir > 0 ? 'max' : 'min')) return;
    commit(v, v.months + dir * STEP, keyOf(v.stage));
  }

  function toggle(stage: string): void {
    open = open === stage ? null : stage;
  }

  function onkeydown(e: KeyboardEvent, i: number): void {
    const last = buttons.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? Math.min(last, i + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    active = next;
    buttons[next]?.focus();
  }

  function onpointerdown(e: PointerEvent, v: StageView): void {
    if (e.button !== 0 || !v.bounds) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-released pointer cannot be captured; the drag still works.
    }
    const total = views.reduce((s, x) => s + x.months, 0);
    drag = {
      stage: v.stage as TimedStage,
      startX: e.clientX,
      startMonths: v.months,
      pxPerMonth: trackPx > 0 && total > 0 ? trackPx / total : 1,
      want: v.months,
      months: v.months,
      moved: false
    };
  }

  function onpointermove(e: PointerEvent, v: StageView): void {
    if (drag === null || drag.stage !== v.stage || !v.bounds) return;
    const dx = e.clientX - drag.startX;
    const moved = drag.moved || Math.abs(dx) >= TAP_PX;
    const want = drag.startMonths + dx / drag.pxPerMonth;
    const months = Math.min(v.bounds.max, Math.max(v.bounds.min, roundHalf(want)));
    drag = { ...drag, want, months, moved };
  }

  function onpointerup(v: StageView): void {
    const d = drag;
    if (d === null || d.stage !== v.stage) return;
    drag = null;
    if (!d.moved) toggle(v.stage);
    else commit(v, d.want);
  }

  const openView = $derived(shown.find((v) => v.stage === open) ?? null);
</script>

<div class="flex flex-col gap-1">
  <!-- The bound badges sit above the bar, centred over their segment and outside its clipped
       box, so "min" or "max" stays readable at the 24 px floor (colour is never the only
       signal). `aria-hidden`: the segment's name already says "at the minimum". -->
  <div class="flex h-4 w-full gap-px border-x border-transparent" aria-hidden="true">
    {#each shown as v (v.stage)}
      <div
        class="flex items-end justify-center"
        style:flex="{v.months} 1 0px"
        style:min-width="24px"
      >
        {#if v.atBound}
          <span
            data-testid="bound-{v.stage}"
            class="rounded-sm bg-amber-800 px-0.5 text-[9px] leading-3 font-bold text-white"
            >{v.atBound}</span
          >
        {/if}
      </div>
    {/each}
  </div>
  <div
    role="group"
    aria-label="{routeName} timeline"
    class="flex h-9 w-full gap-px overflow-hidden rounded-md border border-gray-400 bg-white pointer-coarse:h-11"
    bind:clientWidth={trackPx}
  >
    {#each shown as v, i (v.stage)}
      <button
        bind:this={buttons[i]}
        type="button"
        tabindex={i === active ? 0 : -1}
        aria-label={segmentName(v)}
        aria-expanded={open === v.stage}
        aria-controls={detailsId(v.stage)}
        style:flex="{v.months} 1 0px"
        style:min-width="24px"
        class={[
          'flex h-full items-center justify-center gap-0.5 overflow-hidden px-0 text-xs font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700',
          v.editable
            ? v.atBound
              ? 'bg-amber-100 text-gray-900'
              : 'bg-blue-100 text-gray-900'
            : 'bg-[repeating-linear-gradient(135deg,#e5e7eb_0_5px,#f3f4f6_5px_10px)] text-gray-700',
          open === v.stage && 'outline-2 -outline-offset-2 outline-blue-700'
        ]}
        onclick={() => toggle(v.stage)}
        onfocus={() => (active = i)}
        onkeydown={(e) => onkeydown(e, i)}
      >
        {#if !v.editable}
          <svg viewBox="0 0 16 16" class="h-3 w-3 flex-none" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" />
          </svg>
        {/if}
        <span>{v.months}</span>
      </button>
    {/each}
  </div>

  {#if fine.current}
    <!-- Handles sit under the bar, centred on each editable segment's right boundary, so they
         never cover a segment; boundaries are at least 24 px apart, so handles never overlap. -->
    <div class="flex h-6 w-full gap-px border-x border-transparent" aria-hidden="true">
      {#each shown as v (v.stage)}
        <div class="relative" style:flex="{v.months} 1 0px" style:min-width="24px">
          {#if v.editable && v.bounds}
            <div
              aria-hidden="true"
              data-testid="handle-{v.stage}"
              class="absolute top-0 right-0 flex h-6 w-6 translate-x-1/2 cursor-ew-resize touch-none items-start justify-center"
              onpointerdown={(e) => onpointerdown(e, v)}
              onpointermove={(e) => onpointermove(e, v)}
              onpointerup={() => onpointerup(v)}
              onpointercancel={() => (drag = null)}
              onlostpointercapture={() => (drag = null)}
            >
              <span class="mt-0.5 h-4 w-1.5 rounded-full bg-gray-600"></span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div
    class="flex w-full gap-px border-x border-transparent text-[11px] text-gray-700"
    aria-hidden="true"
  >
    {#each shown as v, i (v.stage)}
      <div class="relative h-4" style:flex="{v.months} 1 0px" style:min-width="24px">
        {#if i < shown.length - 1}
          <span class="absolute top-0 right-0 translate-x-1/2">{pct(v.advance)}%</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if openView}
    {@const v = openView}
    {@const reach = reachText(v)}
    <div
      id={detailsId(v.stage)}
      class="mt-1 flex flex-col gap-1 rounded-md border border-gray-300 bg-gray-50 p-2 text-xs"
    >
      <h5 class="text-sm font-semibold">
        {v.label} <span class="font-normal text-gray-700">· {routeName}</span>
      </h5>
      {#if v.editable && v.bounds}
        {@const inputId = `${detailsId(v.stage)}-months`}
        <div class="flex flex-wrap items-center gap-1">
          <label for={inputId} class="font-semibold">Typical months</label>
          <button
            type="button"
            aria-label="Shorten by 0.5 month"
            aria-disabled={v.atBound === 'min'}
            class="min-h-6 min-w-6 rounded-md border border-gray-300 bg-white px-2 font-bold aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onclick={() => step(v, -1)}>−</button
          >
          <input
            id={inputId}
            type="number"
            step={STEP}
            min={v.bounds.min}
            max={v.bounds.max}
            value={v.months}
            class="min-h-6 w-16 rounded-md border border-gray-400 px-1 text-center pointer-coarse:min-h-11"
            onchange={(e) => commitInput(v, e.currentTarget)}
          />
          <button
            type="button"
            aria-label="Lengthen by 0.5 month"
            aria-disabled={v.atBound === 'max'}
            class="min-h-6 min-w-6 rounded-md border border-gray-300 bg-white px-2 font-bold aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onclick={() => step(v, 1)}>+</button
          >
          <span class="text-gray-700">≈ {Math.round(v.months * MONTH_DAYS)} days</span>
        </div>
        {#if v.atBound}
          <p class="font-semibold text-amber-800">
            At the {v.atBound === 'min' ? 'minimum' : 'maximum'}
          </p>
        {/if}
        <p class="text-gray-700">{minimumText(v)}</p>
      {:else}
        <p>Typical: {monthsText(v.months)}</p>
        {#if v.lockReason}<p class="text-gray-700">{v.lockReason}</p>{/if}
      {/if}
      <p>{chancesText(v)}</p>
      {#if v.editable}
        {#if reach}<p>{reach}</p>{/if}
        {#if v.inFlightClamped}
          <p class="text-amber-800">
            Limited to ×0.05 (or ×10) for projects already in the pipeline
          </p>
        {/if}
        {#if v.presetLimitedByFloor}
          <p class="text-amber-800">The preset's value is below the minimum; the minimum is used</p>
        {/if}
        <div class="text-gray-700">
          <p>Sources:</p>
          <ul class="ml-4 list-disc">
            {#each sourcesOf(v) as pv, k (k)}
              <li>
                {pv.label} (tier {pv.tier}){#each pv.sources as s, j (j)}; <a
                    class="underline"
                    href={s.url}>{s.label}</a
                  >{/each}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
</div>
