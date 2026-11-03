<!--
  "Protections" (plan 3, Task 10): protection means "not redevelopable". Three categories
  (rent control, historic status, buildings newer than N years), each a labelled store change, so
  Undo names and undoes it. The years input applies on change; 0 or a value out of 1 to 200 is
  refused with an announced error and leaves the policy as it was.
-->
<script lang="ts">
  import type { SimPolicy } from './policy';
  import type { PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    /** Speaks a change's label (WCAG 4.1.3). */
    announce?: (msg: string) => void;
  }
  let { store, announce = undefined }: Props = $props();

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
  /**
   * The text last refused. The error stands only while the field still shows it, so an undo or
   * redo that rewrites the field (or new typing) clears the error and `aria-invalid` with it.
   */
  let rejected = $state<string | null>(null);
  const yearsError = $derived(rejected !== null && rejected === yearsText ? YEARS_ERROR : null);

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
    rejected = null;
    if (on) change((pr) => ({ ...pr, newerThanYears: lastYears }), newerLabel(lastYears));
    else change((pr) => ({ ...pr, newerThanYears: null }), 'Unprotected newer buildings');
  }

  function commitYears(text: string): void {
    const y = Number(text);
    if (text.trim() === '' || !Number.isInteger(y) || y < YEARS_MIN || y > YEARS_MAX) {
      rejected = text;
      return;
    }
    rejected = null;
    lastYears = y;
    if (protect.newerThanYears !== y) change((pr) => ({ ...pr, newerThanYears: y }), newerLabel(y));
  }
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
          class="min-h-6 w-20 rounded-md border border-control-line bg-surface px-2 text-ink disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark pointer-coarse:min-h-11"
          value={yearsText}
          oninput={(e) => (yearsText = e.currentTarget.value)}
          onchange={(e) => commitYears(e.currentTarget.value)}
        />
        <span aria-hidden="true">years</span>
      </label>
    </div>
    <!-- Always present and in the accessibility tree (sr-only while empty, never display:none),
         so the error is spoken when it appears (WCAG 4.1.3). -->
    <p
      id="{uid}-years-error"
      role="alert"
      class="text-red-800 dark:text-red-300 {yearsError ? '' : 'sr-only'}"
    >
      {yearsError ?? ''}
    </p>
  </fieldset>

  <p class="text-ink-muted dark:text-ink-dark-muted">
    Protected lots get no new housing in the simulation. Projects already in the pipeline continue.
  </p>
</div>
