<!--
  A rule brush's form (Transit, Street, Commercial corridor, Area). It is seeded once from
  `initial` (an edit keeps the brush's id) and calls `onsave` with a complete brush; Save stays
  disabled, with the reason beside it, until the brush would select something and its numbers are
  in range. A commercial corridor is a Street brush preset to arterial frontage zoned NC or NCT.
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
  import {
    DEFAULT_BANDS,
    defaultEffect,
    type BrushMode,
    type TransitBand,
    type ZoningBrush
  } from './policy';

  interface Props {
    kind: RuleKind;
    catalog: BrushCatalog;
    initial?: ZoningBrush;
    onsave(b: ZoningBrush): void;
    oncancel(): void;
  }
  let { kind, catalog, initial = undefined, onsave, oncancel }: Props = $props();

  const MAX_BANDS = 3;
  const DEFAULT_STORIES = 6;
  const MODES: { id: BrushMode; label: string }[] = [
    { id: 'raise', label: 'Raise' },
    { id: 'lower', label: 'Lower' },
    { id: 'set', label: 'Set to' }
  ];

  const uid = $props.id();
  // The form is seeded once: later prop changes do not reset what the user has entered.
  const init = untrack(() => initial);
  const k = untrack(() => kind);
  const title = `${init ? 'Edit' : 'Add'} a ${RULE_KINDS.find((r) => r.id === k)!.label.toLowerCase()} brush`;

  const initEffect =
    init && init.kind !== 'transit' && init.kind !== 'erase' ? init.effect : undefined;
  const initMode: BrushMode = init?.kind === 'transit' ? init.mode : (initEffect?.mode ?? 'raise');

  let mode = $state<BrushMode>(initMode);
  let stories = $state<number | null>(initEffect?.stories ?? DEFAULT_STORIES);
  let densityLimits = $state(
    init?.kind === 'transit'
      ? init.densityLimits
      : (initEffect?.densityLimits ?? defaultEffect(initMode, DEFAULT_STORIES).densityLimits)
  );

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

  // Area
  let districts = $state<string[]>(init?.kind === 'area' ? [...init.districts] : []);
  let neighborhoods = $state<string[]>(init?.kind === 'area' ? [...init.neighborhoods] : []);
  let openFamilies = $state<Record<string, boolean>>({});

  let heading = $state<HTMLHeadingElement>();
  onMount(() => heading?.focus());

  function setMode(m: BrushMode): void {
    mode = m;
    densityLimits = defaultEffect(m, stories ?? DEFAULT_STORIES).densityLimits;
  }

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
  const duplicateBands = $derived.by(() => {
    const ds = bands.map((b) => b.maxM).filter(okMetres);
    return new Set(ds).size < ds.length;
  });

  const problem = $derived.by((): string | null => {
    const storiesMsg = `Stories must be a whole number from ${STORIES_MIN} to ${STORIES_MAX}.`;
    switch (k) {
      case 'transit':
        if (duplicateBands) return DUPLICATE_BANDS;
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
      case 'area':
        if (districts.length === 0 && neighborhoods.length === 0)
          return 'Choose a district or a neighborhood.';
        return okStories(stories) ? null : storiesMsg;
    }
  });

  function build(): ZoningBrush {
    const id = init?.id ?? newOpId();
    const effect = { mode, stories: stories!, densityLimits };
    switch (k) {
      case 'transit':
        return {
          id,
          kind: 'transit',
          stopTypes: STOP_TYPES.filter((t) => stopTypes.includes(t)),
          bands: bands.map((b): TransitBand => ({ maxM: b.maxM!, stories: b.stories! })),
          mode,
          densityLimits
        };
      case 'street':
        return {
          id,
          kind: 'street',
          classes: STREET_CLASSES.filter((c) => classes.includes(c)),
          names: [...names],
          depth,
          ncOnly: false,
          effect
        };
      case 'corridor':
        return {
          id,
          kind: 'street',
          classes: ['arterial'],
          names: [],
          depth: 0,
          ncOnly: true,
          effect
        };
      case 'area': {
        const order = catalog.districts.flatMap((f) => f.codes.map((c) => c.code));
        const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
        return {
          id,
          kind: 'area',
          districts: [...districts].sort((a, b) => rank(a) - rank(b)),
          neighborhoods: catalog.neighborhoods
            .filter((n) => neighborhoods.includes(n))
            .concat(neighborhoods.filter((n) => !catalog.neighborhoods.includes(n))),
          effect
        };
      }
    }
  }

  /**
   * Save stays enabled (a disabled button hides its reason from keyboard users). Pressing it with a
   * problem shows the reason in the form's live region (WCAG 4.1.3); from then on the reason
   * follows the fields. A duplicate band distance is shown as soon as it is entered.
   */
  let attempted = $state(false);
  const shown = $derived(
    problem !== null && (attempted || problem === DUPLICATE_BANDS) ? problem : null
  );

  function onsubmit(e: SubmitEvent): void {
    e.preventDefault();
    if (problem !== null) {
      attempted = true;
      return;
    }
    onsave(build());
  }

  const famCodes = (f: BrushCatalog['districts'][number]) => f.codes.map((c) => c.code);
  const famLots = (f: BrushCatalog['districts'][number]) => f.codes.reduce((s, c) => s + c.lots, 0);
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
      <p class="text-gray-700">Each band sets the height of the lots within its distance.</p>
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
      <!-- Always present, so the error is spoken when it appears (WCAG 4.1.3). -->
      <p id="{uid}-name-error" role="alert" class="text-red-800 empty:hidden">{nameError ?? ''}</p>
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
  {:else}
    <fieldset class="flex flex-col gap-1">
      <legend class="font-semibold">Zoning districts</legend>
      <ul class="flex flex-col gap-1">
        {#each catalog.districts as f, fi (f.family)}
          {@const codes = famCodes(f)}
          {@const on = codes.filter((c) => districts.includes(c)).length}
          {@const codesId = `${uid}-fam-${fi}`}
          <li>
            <div class="flex flex-wrap items-center gap-x-2">
              <label class={check}>
                <input
                  type="checkbox"
                  class="size-6"
                  checked={on === codes.length}
                  indeterminate={on > 0 && on < codes.length}
                  onchange={(e) => {
                    const ticked = e.currentTarget.checked;
                    districts = ticked
                      ? [...districts, ...codes.filter((c) => !districts.includes(c))]
                      : districts.filter((c) => !codes.includes(c));
                  }}
                />
                {f.family} family · {count(famLots(f), 'lot', 'lots')}
              </label>
              <button
                type="button"
                class={smallBtn}
                aria-expanded={!!openFamilies[f.family]}
                aria-controls={codesId}
                onclick={() => (openFamilies[f.family] = !openFamilies[f.family])}
                >{f.family} codes</button
              >
            </div>
            {#if openFamilies[f.family]}
              <ul id={codesId} class="ml-8 flex flex-col gap-1">
                {#each f.codes as c (c.code)}
                  <li>
                    <label class={check}>
                      <input
                        type="checkbox"
                        class="size-6"
                        checked={districts.includes(c.code)}
                        onchange={(e) =>
                          (districts = toggle(districts, c.code, e.currentTarget.checked))}
                      />
                      {c.code} · {count(c.lots, 'lot', 'lots')}
                    </label>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    </fieldset>

    <fieldset class="flex flex-col gap-1">
      <legend class="font-semibold">Neighborhoods</legend>
      {#if catalog.has.neighborhoods}
        {#each catalog.neighborhoods as nb (nb)}
          <label class={check}>
            <input
              type="checkbox"
              class="size-6"
              checked={neighborhoods.includes(nb)}
              onchange={(e) => (neighborhoods = toggle(neighborhoods, nb, e.currentTarget.checked))}
            />
            {nb}
          </label>
        {/each}
      {:else}
        <p class="text-gray-700">This dataset has no neighborhood boundaries.</p>
      {/if}
    </fieldset>
  {/if}

  <fieldset class="flex flex-wrap gap-x-3 gap-y-1">
    <legend class="w-full font-semibold">Mode</legend>
    {#each MODES as m (m.id)}
      <label class={check}>
        <input
          type="radio"
          name="{uid}-mode"
          class="size-6"
          checked={mode === m.id}
          onchange={() => setMode(m.id)}
        />
        {m.label}
      </label>
    {/each}
  </fieldset>

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

  <label class={check}>
    <input type="checkbox" class="size-6" bind:checked={densityLimits} />
    Density limits
  </label>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="submit"
      class="min-h-11 rounded-md bg-black px-3 font-semibold text-white"
      aria-describedby={shown ? `${uid}-problem` : undefined}>Save brush</button
    >
    <button
      type="button"
      class="min-h-11 rounded-md border border-gray-300 px-3 font-medium"
      onclick={() => oncancel()}>Cancel</button
    >
  </div>
  <!-- Always present, so a reason appearing or changing is spoken (WCAG 4.1.3). -->
  <p id="{uid}-problem" role="status" class="text-red-800 empty:hidden">{shown ?? ''}</p>
</form>
