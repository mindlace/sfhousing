<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and sends each new SimLevers to FzpMode's `levers`, which FzpMode passes on with setLevers. `start=fzp` (the /fzp
  redirect) opens the Family Zoning Plan comparison, otherwise current law (Calls 14 and 16).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Manifest } from '$lib/data/manifest';
  import FzpMode, { type SimClientApi } from '$lib/fzp/FzpMode.svelte';
  import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS } from '$lib/sim/levers/types';
  import type { BrushLotsResult } from '$lib/sim/scenario/types';
  import type { Calibration } from '$lib/timelapse/types';
  import { policyFromLevers } from './policy';
  import { focusHeaderMenu } from '$lib/shell/header-actions.svelte';
  import { LeverSync, PolicyStore } from './policy-store.svelte';
  import PolicyPanel from './PolicyPanel.svelte';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    calibration: Calibration | null;
    calibrationError: boolean;
    noScenario: boolean;
    datasetVersion: string;
    /** 'fzp' when the /fzp redirect opened the page. */
    start: 'fzp' | null;
    /** `?seed=N`, or null for the representative future. */
    urlSeed: number | null;
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    onurlseed?: (seed: number | null) => void;
  }

  let {
    manifest,
    manifestError,
    calibration,
    calibrationError,
    noScenario,
    datasetVersion,
    start,
    urlSeed,
    reload,
    onurlseed
  }: Props = $props();

  /** The document the session opens with; a remount (new load) starts over. */
  const initial = untrack(() => (start === 'fzp' ? FZP_COMPAT_LEVERS : DEFAULT_LEVERS));
  const initialPolicy = policyFromLevers(initial);
  const store = new PolicyStore(initialPolicy);

  /** The scenario client's brush requests; null before mount, after a crash and after unmount. */
  let api: SimClientApi | null = null;
  /** What FzpMode runs: `initial`, then each document LeverSync sends. */
  let levers = $state.raw(initial);

  const noSession = (): BrushLotsResult => ({
    ok: false,
    reason: 'no-session',
    message: 'the simulation is not running'
  });
  const sync = new LeverSync({
    resolve: (q) => (api ? api.resolveBrush(q) : Promise.resolve(noSession())),
    send: (l) => (levers = l),
    setTimeout,
    clearTimeout
  });

  const uid = $props.id();
  const panelId = `${uid}-policy`;
  let policyOpen = $state(false);
  /** Opening moves focus into the panel only when the user opened it (WCAG 2.4.3). */
  let policyFocus = $state(true);
  let policyButton = $state<HTMLButtonElement>();

  // The panel starts open, docked, from md and closed below (the controller's ruling); read once,
  // on the client. With no scenario there is no panel.
  onMount(() => {
    if (noScenario || !matchMedia('(min-width: 768px)').matches) return;
    policyFocus = false;
    policyOpen = true;
  });

  function openPolicy(): void {
    policyFocus = true;
    policyOpen = true;
  }

  /**
   * Closing the panel returns focus to the Policy button, or, when it sits in the closed phone
   * Menu, to the Menu button. Focus elsewhere on the page (a press on the map) stays put.
   */
  async function closePolicy(): Promise<void> {
    const a = document.activeElement;
    const panel = document.getElementById(panelId);
    const restore = !a || a === document.body || !!panel?.contains(a);
    policyOpen = false;
    await tick();
    if (!restore) return;
    if (policyButton?.checkVisibility()) policyButton.focus();
    else focusHeaderMenu();
  }

  // Every policy change after the first goes to LeverSync. The initial policy is `initial`, which
  // FzpMode sends with initScenario; an undo back to it is a change like any other.
  let first = true;
  $effect(() => {
    const p = store.policy;
    if (first) {
      first = false;
      return;
    }
    untrack(() => sync.update(p));
  });
</script>

{#snippet actions()}
  <button
    bind:this={policyButton}
    type="button"
    aria-expanded={policyOpen}
    aria-controls={panelId}
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    onclick={() => (policyOpen ? void closePolicy() : openPolicy())}>Policy</button
  >
{/snippet}

{#snippet panel()}
  <PolicyPanel
    {store}
    id={panelId}
    open={policyOpen}
    focusOnOpen={policyFocus}
    onclose={() => void closePolicy()}
  />
{/snippet}

<FzpMode
  {manifest}
  {manifestError}
  {calibration}
  {calibrationError}
  {noScenario}
  {datasetVersion}
  {urlSeed}
  {reload}
  {onurlseed}
  {levers}
  {actions}
  {panel}
  onclient={(a) => {
    api = a;
    // A new session: brush queries answered `no-session` can be asked again.
    if (a) sync.resume();
  }}
/>
