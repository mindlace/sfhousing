<!--
  One transit layer in the Transit tab: a select button (pressed = the layer selected) holding the
  neutral swatch (its tallest band), its name ("Near Muni Metro") and its lot count, named
  "name · N stories · lots"; the lot count is also a sibling polite status (a button's children
  are presentational, so a change inside it is not announced: WCAG 4.1.3). Retry when its lot
  lookup failed. Selected, the editor follows in place: stop-type chips, per band (innermost
  first) its distance and a stories stepper, + Band and Remove layer. Every control hands
  `onedit` a rule the band rule accepts (transit-edit.ts clamps it): a control that would break it
  is aria-disabled with focus kept on it. Nothing waits as a draft: there is no Save.
-->
<script lang="ts">
  import { STOP_TYPES, type BrushCatalog, type StopType } from '$lib/sim/levers/brushes';
  import { STOP_LABELS, count, lotsText, type LotStatus } from './brush-summary';
  import { bandsInnermostFirst, type ZoningRule } from './policy';
  import {
    addBand,
    distanceRange,
    layerName,
    layerTop,
    removeBand,
    setBandDistance,
    setBandStories,
    storiesRange,
    toggleStop
  } from './transit-edit';

  interface Props {
    rule: ZoningRule;
    status: LotStatus;
    /** The chips' stop counts: undefined while loading, null when unavailable. */
    catalog: BrushCatalog | null | undefined;
    selected: boolean;
    /** Toggles this layer's selection. */
    onselect(): void;
    /** An edit; `coalesce` merges a run of the same edit into one undo step. */
    onedit(next: ZoningRule, coalesce?: string): void;
    onremove(): void;
    onretry(keys: string[]): void;
  }

  let { rule, status, catalog, selected, onselect, onedit, onremove, onretry }: Props = $props();

  const uid = $props.id();
  let addBandBtn = $state<HTMLButtonElement>();

  const bands = $derived(bandsInnermostFirst(rule.bands));
  const name = $derived(layerName(rule));
  const top = $derived(layerTop(rule));
  const lots = $derived(lotsText(status));
  const label = $derived(`${name} · ${count(top, 'story', 'stories')} · ${lots}`);
  const canAddBand = $derived(addBand(rule) !== null);

  /** The same rule, bands compared innermost first (a saved rule may list them otherwise). */
  function same(a: ZoningRule, b: ZoningRule): boolean {
    return (
      JSON.stringify(a.stopTypes) === JSON.stringify(b.stopTypes) &&
      JSON.stringify(bandsInnermostFirst(a.bands)) === JSON.stringify(bandsInnermostFirst(b.bands))
    );
  }

  /** Hands on an edit that changed something (null: the helper refused it). */
  function edit(next: ZoningRule | null, coalesce?: string): void {
    if (next === null || same(next, rule)) return;
    onedit(next, coalesce);
  }

  const lastStop = (t: StopType) => rule.stopTypes.length === 1 && rule.stopTypes[0] === t;

  function chipText(t: StopType): string {
    return catalog
      ? `${STOP_LABELS[t]} · ${count(catalog.stops[t], 'stop', 'stops')}`
      : STOP_LABELS[t];
  }

  function stories(i: number, delta: 1 | -1): void {
    const { min, max } = storiesRange(bands, i);
    const n = bands[i].stories + delta;
    if (n < min || n > max) return;
    edit(setBandStories(rule, i, n), `rule:${rule.id}:stories:${i}`);
  }

  /** Commits a typed distance: clamped between its neighbours; a non-number reverts. */
  function commitDistance(input: HTMLInputElement, i: number): void {
    const typed = input.value.trim() === '' ? NaN : Number(input.value);
    const next = setBandDistance(rule, i, typed);
    // Show what was kept (the clamp, or the old value for a non-number), changed or not.
    input.value = String(bandsInnermostFirst(next.bands)[i].maxM);
    edit(next, `rule:${rule.id}:distance:${i}`);
  }

  function dropBand(i: number): void {
    const next = removeBand(rule, i);
    if (next === null) return;
    edit(next);
    // The band's controls are gone: focus stays in the editor (WCAG 2.4.3).
    addBandBtn?.focus();
  }

  const control =
    'min-h-11 min-w-11 rounded-md border border-control-line bg-surface px-2 text-ink hover:bg-surface-raised aria-disabled:opacity-40 aria-disabled:hover:bg-surface dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:aria-disabled:hover:bg-surface-dark';
  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<li
  data-layer-row={rule.id}
  class="flex flex-col gap-1 rounded-md border p-1 {selected
    ? 'border-accent bg-surface-raised dark:border-accent-dark dark:bg-surface-dark-raised'
    : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'}"
>
  <button
    type="button"
    aria-pressed={selected}
    aria-label={label}
    class="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-surface-raised dark:hover:bg-surface-dark-raised"
    onclick={() => onselect()}
  >
    <!-- The same neutral ink tile as the Paint tab: the tallest band's stories. -->
    <span
      aria-hidden="true"
      class="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-sm font-medium text-surface dark:bg-ink-dark dark:text-surface-dark"
      >{top}</span
    >
    <span class="flex min-w-0 flex-col">
      <span class="font-semibold">{name}</span>
      <span class="text-ink-muted dark:text-ink-dark-muted">{lots}</span>
    </span>
  </button>
  <span role="status" class="sr-only">{lots}</span>
  {#if status.kind === 'failed'}
    {@const keys = status.keys}
    <div class="flex flex-wrap gap-x-2 gap-y-1">
      <button type="button" aria-label="Retry: {label}" class={link} onclick={() => onretry(keys)}
        >Retry</button
      >
    </div>
  {/if}

  {#if selected}
    <div class="flex flex-col gap-3 px-1 pt-1 pb-2">
      <div role="group" aria-label="Stop types" class="flex flex-wrap gap-1">
        {#each STOP_TYPES as t (t)}
          {@const on = rule.stopTypes.includes(t)}
          {@const locked = on && lastStop(t)}
          <!-- The last stop type on stays pressed: aria-disabled (not disabled), so it keeps
               focus and its reason is its description. -->
          <button
            type="button"
            aria-pressed={on}
            aria-disabled={locked ? 'true' : undefined}
            aria-describedby={locked ? `${uid}-last-stop` : undefined}
            class="min-h-11 rounded-full border border-control-line bg-surface px-3 text-left text-ink hover:bg-surface-raised aria-pressed:border-accent aria-pressed:bg-accent-tint aria-pressed:font-semibold aria-pressed:text-ink dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:aria-pressed:border-accent-dark dark:aria-pressed:bg-accent-dark/30 dark:aria-pressed:text-ink-dark"
            onclick={() => {
              if (!locked) edit(toggleStop(rule, t));
            }}>{chipText(t)}</button
          >
        {/each}
        <span id="{uid}-last-stop" class="sr-only">A layer needs at least one stop type</span>
      </div>

      {#each bands as b, i (i)}
        {@const dist = distanceRange(bands, i)}
        {@const st = storiesRange(bands, i)}
        <div
          role="group"
          aria-label="Band {i + 1}"
          class="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <span class="flex items-center gap-1">
            <label for="{uid}-d{i}">Within <span class="sr-only">metres</span></label>
            <input
              id="{uid}-d{i}"
              type="number"
              inputmode="numeric"
              step="1"
              min={dist.min}
              max={dist.max}
              value={b.maxM}
              class="min-h-11 w-24 rounded-md border border-control-line bg-surface px-2 text-ink dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark"
              onchange={(e) => commitDistance(e.currentTarget, i)}
              onkeydown={(e) => {
                if (e.key === 'Enter') commitDistance(e.currentTarget, i);
              }}
            />
            <span aria-hidden="true">m</span>
          </span>
          <span class="flex items-center gap-1">
            <button
              type="button"
              aria-label="Fewer stories"
              aria-disabled={b.stories <= st.min ? 'true' : undefined}
              class={control}
              onclick={() => stories(i, -1)}><span aria-hidden="true">−</span></button
            >
            <output aria-live="polite" class="min-w-20 text-center"
              >{count(b.stories, 'story', 'stories')}</output
            >
            <button
              type="button"
              aria-label="More stories"
              aria-disabled={b.stories >= st.max ? 'true' : undefined}
              class={control}
              onclick={() => stories(i, 1)}><span aria-hidden="true">+</span></button
            >
          </span>
          <button
            type="button"
            aria-disabled={bands.length <= 1 ? 'true' : undefined}
            class={link}
            onclick={() => dropBand(i)}>Remove band</button
          >
        </div>
      {/each}

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          bind:this={addBandBtn}
          type="button"
          aria-disabled={canAddBand ? undefined : 'true'}
          class={link}
          onclick={() => edit(addBand(rule))}
          ><span class="sr-only">Add</span> <span aria-hidden="true">+</span> Band</button
        >
        <button type="button" class={link} onclick={() => onremove()}>Remove layer</button>
      </div>
    </div>
  {/if}
</li>
