<!--
  "Protections" (plan 3, Task 10): protection means "not redevelopable". Three categories
  (rent control, historic status, buildings newer than N years), each a labelled store change, so
  Undo names and undoes it; then the brushed protections: "Protect lots with the brush" picks the
  Protect tool (through SimPage, which on a phone closes the sheet for the floating tool bar), and
  a row counts the compiled `protect.lots` with Clear, one change that a single undo reverses
  (ruling 6). The years input applies on change; 0 or a value out of 1 to 200 is refused with an
  announced error and leaves the policy as it was.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { SimBrushTools, SimTool } from './brush-tools.svelte';
  import { lotsText, protectLotStatus } from './brush-summary';
  import type { SimPolicy } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    tools: SimBrushTools;
    /** Choose a tool (SimPage routes it through the controller and, on a phone, the tool bar). */
    ontool(t: SimTool): void;
    /** Speaks a change's label (WCAG 4.1.3). */
    announce?: (msg: string) => void;
  }
  let { store, sync, tools, ontool, announce = undefined }: Props = $props();

  /** Tier 4 UI default for "Buildings newer than". */
  const DEFAULT_YEARS = 30;
  const YEARS_MIN = 1;
  const YEARS_MAX = 200;
  const YEARS_ERROR = `Enter a whole number of years from ${YEARS_MIN} to ${YEARS_MAX}.`;

  const uid = $props.id();
  const protect = $derived(store.policy.protect);
  const newer = $derived(protect.newerThanYears !== null);
  /** The last valid year count, offered again when "newer than" is checked. */
  let lastYears = $state(DEFAULT_YEARS);
  /** The input's text: the policy's years while set, else the last valid count. */
  let yearsText = $derived(String(protect.newerThanYears ?? lastYears));
  let yearsError = $state<string | null>(null);

  const status = $derived(protectLotStatus(store.policy, (k) => sync.result(k)));
  const ready = $derived(tools.brush.phase === 'ready');
  let protectBtn = $state<HTMLButtonElement>();

  function change(edit: (pr: SimPolicy['protect']) => SimPolicy['protect'], label: string): void {
    store.apply((p) => ({ ...p, protect: edit(p.protect) }), label);
    announce?.(label);
  }

  function setRentControl(on: boolean): void {
    change(
      (pr) => ({ ...pr, rentControl: on }),
      `${on ? 'Protected' : 'Unprotected'} rent-controlled buildings`
    );
  }

  function setHistoric(on: boolean): void {
    change(
      (pr) => ({ ...pr, historic: on }),
      `${on ? 'Protected' : 'Unprotected'} historic buildings`
    );
  }

  const newerLabel = (y: number) => `Protected buildings newer than ${y} years`;

  function setNewer(on: boolean): void {
    yearsError = null;
    if (on) change((pr) => ({ ...pr, newerThanYears: lastYears }), newerLabel(lastYears));
    else change((pr) => ({ ...pr, newerThanYears: null }), 'Unprotected newer buildings');
  }

  function commitYears(text: string): void {
    const y = Number(text);
    if (text.trim() === '' || !Number.isInteger(y) || y < YEARS_MIN || y > YEARS_MAX) {
      yearsError = YEARS_ERROR;
      return;
    }
    yearsError = null;
    lastYears = y;
    if (protect.newerThanYears !== y) change((pr) => ({ ...pr, newerThanYears: y }), newerLabel(y));
  }

  function clearStrokes(): void {
    const label = 'Cleared brush protections';
    change((pr) => ({ ...pr, strokes: [] }), label);
    // The row (and its Clear button) is gone: keep focus in the section.
    void tick().then(() => protectBtn?.focus());
  }

  const btn =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<div class="flex flex-col gap-3 text-sm">
  <fieldset class="flex flex-col gap-1">
    <legend class="font-semibold">Protect by category</legend>
    <label class="flex min-h-6 items-center gap-1.5">
      <input
        type="checkbox"
        class="size-6"
        checked={protect.rentControl}
        onchange={(e) => setRentControl(e.currentTarget.checked)}
      />
      Rent-controlled buildings (likely)
    </label>
    <label class="flex min-h-6 items-center gap-1.5">
      <input
        type="checkbox"
        class="size-6"
        checked={protect.historic}
        onchange={(e) => setHistoric(e.currentTarget.checked)}
      />
      Historic buildings (status A or A*)
    </label>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label class="flex min-h-6 items-center gap-1.5">
        <input
          type="checkbox"
          class="size-6"
          checked={newer}
          onchange={(e) => setNewer(e.currentTarget.checked)}
        />
        Buildings newer than
      </label>
      <label class="flex min-h-6 items-center gap-1.5">
        <span class="sr-only">Buildings newer than, in years</span>
        <input
          type="number"
          inputmode="numeric"
          min={YEARS_MIN}
          max={YEARS_MAX}
          step="1"
          disabled={!newer}
          aria-invalid={yearsError ? 'true' : undefined}
          aria-describedby={yearsError ? `${uid}-years-error` : undefined}
          class="min-h-6 w-20 rounded-md border border-gray-400 px-2 disabled:opacity-40 pointer-coarse:min-h-11"
          value={yearsText}
          oninput={(e) => (yearsText = e.currentTarget.value)}
          onchange={(e) => commitYears(e.currentTarget.value)}
        />
        <span aria-hidden="true">years</span>
      </label>
    </div>
    <!-- Always present and in the accessibility tree (sr-only while empty, never display:none),
         so the error is spoken when it appears (WCAG 4.1.3). -->
    <p id="{uid}-years-error" role="alert" class="text-red-800 {yearsError ? '' : 'sr-only'}">
      {yearsError ?? ''}
    </p>
  </fieldset>

  <p class="text-gray-700">
    Protected lots get no new housing in the simulation. Projects already in the pipeline continue.
  </p>

  <div class="flex flex-col gap-2">
    <button
      bind:this={protectBtn}
      type="button"
      disabled={!ready}
      class="min-h-11 self-start rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40"
      onclick={() => ontool('protect')}>Protect lots with the brush</button
    >
    {#if protect.strokes.length > 0}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <!-- The count is its own polite region, kept across states, so a count arriving is
             spoken (WCAG 4.1.3). -->
        <p id="{uid}-brushed">
          Protected with the brush · <span role="status">{lotsText(status)}</span>
        </p>
        {#if status.kind === 'failed'}
          {@const keys = status.keys}
          <button
            type="button"
            aria-describedby="{uid}-brushed"
            class={btn}
            onclick={() => keys.forEach((k) => sync.retry(k))}>Retry</button
          >
        {/if}
        <button
          type="button"
          aria-label="Clear brush protections"
          class={btn}
          onclick={clearStrokes}>Clear</button
        >
      </div>
    {/if}
  </div>
</div>
