<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and hands FzpMode each new SimLevers, which FzpMode sends with setLevers. `start=fzp` (the /fzp
  redirect) opens the Family Zoning Plan comparison, otherwise current law (Calls 14 and 16).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Manifest } from '$lib/data/manifest';
  import FzpMode, { type SimClientApi } from '$lib/fzp/FzpMode.svelte';
  import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS } from '$lib/sim/levers/types';
  import type { BrushLotsResult } from '$lib/sim/scenario/types';
  import type { Calibration } from '$lib/timelapse/types';
  import { policyFromLevers } from './policy';
  import { LeverSync, PolicyStore } from './policy-store.svelte';

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

  /** The scenario client's brush requests; null before mount and after unmount. */
  let api: SimClientApi | null = null;

  const noSession = (): BrushLotsResult => ({
    ok: false,
    reason: 'no-session',
    message: 'the simulation is not running'
  });
  const sync = new LeverSync({
    resolve: (q) => (api ? api.resolveBrush(q) : Promise.resolve(noSession())),
    // FzpMode reads `sync.levers` (reactive) and sends each new object with setLevers.
    send: () => {},
    setTimeout,
    clearTimeout
  });

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
  levers={sync.levers ?? initial}
  onclient={(a) => (api = a)}
/>
