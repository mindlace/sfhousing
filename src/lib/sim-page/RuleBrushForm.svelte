<!--
  A zoning rule's form (Transit, Street, Commercial corridor). It is seeded once from `initial`
  (an edit keeps the rule's id) and calls `onsave` with a complete rule; pressing Save with a
  problem shows the reason beside it instead, until the rule would select something and its
  numbers are in range. A transit rule's bands never get taller with distance (partner ruling):
  compared by distance, whatever order they were entered in. A commercial corridor is a Street
  rule preset to arterial frontage zoned NC or NCT.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { newOpId } from '$lib/brush/ids';
  import { STORIES_MAX, STORIES_MIN } from '$lib/plan/constants';
  import {
    STOP_TYPES,
    type BrushCatalog,
    type StopType,
    type StreetClass
  } from '$lib/sim/levers/brushes';
  import { STREET_CLASSES } from '$lib/data/frontage-codec';
  import {
    CORRIDOR_TEXT,
    FORM_STREET_CLASSES,
    RULE_KINDS,
    STOP_LABELS,
    count,
    type RuleKind
  } from './brush-summary';
  import { DEFAULT_BANDS, bandProblem, type TransitBand, type ZoningRule } from './policy';

  interface Props {
    kind: RuleKind;
    catalog: BrushCatalog;
    initial?: ZoningRule;
    onsave(r: ZoningRule): void;
    oncancel(): void;
  }
  let { kind, catalog, initial = undefined, onsave, oncancel }: Props = $props();

  const MAX_BANDS = 3;
  const DEFAULT_STORIES = 6;

  const uid = $props.id();
  // The form is seeded once: later prop changes do not reset what the user has entered.
  const init = untrack(() => initial);
  const k = untrack(() => kind);
  const kindName = RULE_KINDS.find((r) => r.id === k)!.label.toLowerCase();
  // "an" before a vowel sound: every kind label starts with its sound's letter.
  const article = /^[aeiou]/.test(kindName) ? 'an' : 'a';
  const title = `${init ? 'Edit' : 'Add'} ${article} ${kindName} rule`;

  let stories = $state<number | null>(init?.kind === 'street' ? init.stories : DEFAULT_STORIES);

  // Transit
  let stopTypes = $state<StopType[]>(init?.kind === 'transit' ? [...init.stopTypes] : []);
  let bands = $state<{ maxM: number | null; stories: number | null }[]>(
    (init?.kind === 'transit' ? init.bands : DEFAULT_BANDS).map((b) => ({ ...b }))
  );

  // Street
  let classes = $state<StreetClass[]>(init?.kind === 'street' ? [...init.classes] : []);
  let names = $state<string[]>(init?.kind === 'street' ? [...init.names] : []);
  let depth = $state<0 | 1>(init?.kind === 'street' ? init.depth : 0);
  let nameInput = $state('');
  let nameError = $state<string | null>(null);

  let heading = $state<HTMLHeadingElement>();
  onMount(() => heading?.focus());

  const toggle = <T,>(xs: T[], x: T, on: boolean): T[] =>
    on ? (xs.includes(x) ? xs : [...xs, x]) : xs.filter((y) => y !== x);

  const okStories = (n: number | null) =>
    typeof n === 'number' && Number.isInteger(n) && n >= STORIES_MIN && n <= STORIES_MAX;
  const okMetres = (n: number | null) => typeof n === 'number' && Number.isFinite(n) && n > 0;

  function addName(): void {
    const want = nameInput.trim().toLowerCase();
    if (want === '') return;
    const hit = catalog.streetNames.find((s) => s.toLowerCase() === want);
    if (!hit) {
      nameError = `No street named “${nameInput.trim()}” in this dataset.`;
      return;
    }
    nameError = null;
    names = toggle(names, hit, true);
    nameInput = '';
  }

  /** Two bands at one distance: the later one would select nothing (shown at once). */
  const DUPLICATE_BANDS = 'Each band needs a different distance.';
  /** An outer band taller than the band inside it (shown at once). */
  const TALLER_BAND = "An outer band can't be taller than the band inside it";
  /** The band rule, over the bands whose numbers are complete (`bandProblem`). */
  const bandRule = $derived(
    bandProblem(
      bands
        .filter((b) => okMetres(b.maxM) && okStories(b.stories))
        .map((b) => ({ maxM: b.maxM!, stories: b.stories! }))
    )
  );
  const duplicateBands = $derived.by(() => {
    const ds = bands.map((b) => b.maxM).filter(okMetres);
    return new Set(ds).size < ds.length;
  });

  const problem = $derived.by((): string | null => {
    const storiesMsg = `Stories must be a whole number from ${STORIES_MIN} to ${STORIES_MAX}.`;
    switch (k) {
      case 'transit':
        if (duplicateBands) return DUPLICATE_BANDS;
        if (bandRule === 'taller') return TALLER_BAND;
        if (stopTypes.length === 0) return 'Choose at least one stop type.';
        if (bands.some((b) => !okMetres(b.maxM))) return 'Each band needs a distance above 0 m.';
        if (bands.some((b) => !okStories(b.stories))) return storiesMsg;
        return null;
      case 'street':
        if (classes.length === 0 && names.length === 0)
          return 'Choose a street class or add a street.';
        return okStories(stories) ? null : storiesMsg;
      case 'corridor':
        return okStories(stories) ? null : storiesMsg;
    }
  });

  function build(): ZoningRule {
    const id = init?.id ?? newOpId();
    switch (k) {
      case 'transit':
        return {
          id,
          kind: 'transit',
          stopTypes: STOP_TYPES.filter((t) => stopTypes.includes(t)),
          bands: bands.map((b): TransitBand => ({ maxM: b.maxM!, stories: b.stories! }))
        };
      case 'street':
        return {
          id,
          kind: 'street',
          classes: STREET_CLASSES.filter((c) => classes.includes(c)),
          names: [...names],
          depth,
          ncOnly: false,
          stories: stories!
        };
      case 'corridor':
        return {
          id,
          kind: 'street',
          classes: ['arterial'],
          names: [],
          depth: 0,
          ncOnly: true,
          stories: stories!
        };
    }
  }

  /**
   * Save stays enabled (a disabled button hides its reason from keyboard users). Pressing it with a
   * problem shows the reason in the form's live region (WCAG 4.1.3); from then on the reason
   * follows the fields. A duplicate band distance or a taller outer band is shown as soon as it
   * is entered.
   */
  let attempted = $state(false);
  const shown = $derived(
    problem !== null && (attempted || problem === DUPLICATE_BANDS || problem === TALLER_BAND)
      ? problem
      : null
  );

  function onsubmit(e: SubmitEvent): void {
    e.preventDefault();
    if (problem !== null) {
      attempted = true;
      return;
    }
    onsave(build());
  }

  const field = 'rounded-md border border-gray-400 px-2 min-h-11';
  const check = 'flex min-h-6 items-center gap-1.5';
  const smallBtn =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<form class="flex flex-col gap-3 text-sm" aria-labelledby="{uid}-title" {onsubmit} novalidate>
  <h4 bind:this={heading} id="{uid}-title" tabindex="-1" class="font-semibold focus:outline-none">
    {title}
  </h4>

  {#if k === 'transit'}
    <fieldset class="flex flex-col gap-1">
      <legend class="font-semibold">Near these stops</legend>
      {#each STOP_TYPES as t (t)}
        <label class={check}>
          <input
            type="checkbox"
            class="size-6"
            checked={stopTypes.includes(t)}
            onchange={(e) => (stopTypes = toggle(stopTypes, t, e.currentTarget.checked))}
          />
          {STOP_LABELS[t]} · {count(catalog.stops[t], 'stop', 'stops')}
        </label>
      {/each}
    </fieldset>

    <fieldset class="flex flex-col gap-2">
      <legend class="font-semibold">Bands</legend>
      <p class="text-gray-700">
        Each band allows a height on the lots within its distance. The innermost band wins, and an
        outer band is never taller than the band inside it.
      </p>
      {#each bands as band, i (i)}
        <div class="flex flex-wrap items-end gap-2">
          <label class="flex flex-col">
            <span>Band {i + 1} distance (m)</span>
            <input type="number" min="1" step="1" class="{field} w-28" bind:value={band.maxM} />
          </label>
          <label class="flex flex-col">
            <span>Band {i + 1} stories</span>
            <input
              type="number"
              min={STORIES_MIN}
              max={STORIES_MAX}
              step="1"
              class="{field} w-24"
              bind:value={band.stories}
            />
          </label>
          <button
            type="button"
            class={smallBtn}
            aria-label="Remove band {i + 1}"
            disabled={bands.length === 1}
            onclick={() => (bands = bands.filter((_, j) => j !== i))}>Remove</button
          >
        </div>
      {/each}
      <button
        type="button"
        class="{smallBtn} self-start"
        disabled={bands.length >= MAX_BANDS}
        onclick={() => (bands = [...bands, { maxM: null, stories: null }])}>Add a band</button
      >
    </fieldset>
  {:else if k === 'street'}
    <fieldset class="flex flex-col gap-1">
      <legend class="font-semibold">Street classes</legend>
      {#each FORM_STREET_CLASSES as c (c.id)}
        <label class={check}>
          <input
            type="checkbox"
            class="size-6"
            checked={classes.includes(c.id)}
            onchange={(e) => (classes = toggle(classes, c.id, e.currentTarget.checked))}
          />
          {c.label}
        </label>
      {/each}
    </fieldset>

    <div class="flex flex-col gap-1">
      <label for="{uid}-name" class="font-semibold">Street name</label>
      <div class="flex flex-wrap gap-2">
        <input
          id="{uid}-name"
          type="text"
          list="{uid}-names"
          autocomplete="off"
          class="{field} min-w-0 flex-1"
          aria-describedby={nameError ? `${uid}-name-error` : undefined}
          aria-invalid={nameError ? 'true' : undefined}
          bind:value={nameInput}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addName();
            }
          }}
        />
        <button
          type="button"
          class="min-h-11 rounded-md border border-gray-300 px-3 font-medium"
          onclick={addName}>Add street</button
        >
      </div>
      <datalist id="{uid}-names">
        {#each catalog.streetNames as s (s)}
          <option value={s}></option>
        {/each}
      </datalist>
      <!-- Always present and in the accessibility tree (sr-only while empty, never display:none),
           so the error is spoken when it appears (WCAG 4.1.3). -->
      <p id="{uid}-name-error" role="alert" class="text-red-800 {nameError ? '' : 'sr-only'}">
        {nameError ?? ''}
      </p>
      {#if names.length > 0}
        <ul aria-label="Chosen streets" class="flex flex-col gap-1">
          {#each names as s (s)}
            <li class="flex items-center gap-2">
              <span>{s}</span>
              <button
                type="button"
                class={smallBtn}
                aria-label="Remove {s}"
                onclick={() => (names = names.filter((x) => x !== s))}>Remove</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <label class={check}>
      <input
        type="checkbox"
        class="size-6"
        checked={depth === 1}
        onchange={(e) => (depth = e.currentTarget.checked ? 1 : 0)}
      />
      Include the lots one lot deep
    </label>
  {:else if k === 'corridor'}
    <p>{CORRIDOR_TEXT}</p>
  {/if}

  {#if k !== 'transit'}
    <label class="flex flex-col">
      <span>Stories</span>
      <input
        type="number"
        min={STORIES_MIN}
        max={STORIES_MAX}
        step="1"
        class="{field} w-24"
        bind:value={stories}
      />
    </label>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="submit"
      class="min-h-11 rounded-md bg-black px-3 font-semibold text-white"
      aria-describedby={shown ? `${uid}-problem` : undefined}>Save rule</button
    >
    <button
      type="button"
      class="min-h-11 rounded-md border border-gray-300 px-3 font-medium"
      onclick={() => oncancel()}>Cancel</button
    >
  </div>
  <!-- Always present and in the accessibility tree (sr-only while empty, never display:none),
       so a reason appearing or changing is spoken (WCAG 4.1.3). -->
  <p id="{uid}-problem" role="status" class="text-red-800 {shown ? '' : 'sr-only'}">
    {shown ?? ''}
  </p>
</form>
