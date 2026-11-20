<!--
  /sim's key panel: the homes in each stage group at the playhead's month (`keyTally`), each
  label beside its swatch and count, under "Homes". '…' while the numbers are calculating. Then
  what the map draws over the buildings: the ring of a stage change, the mark of a project under
  the person's policy (only while one is in force; its claim behind a tap), and the stage bar.
-->
<script module lang="ts">
  import type { Swatch } from '$lib/map/key/rows';

  /** The ring row: one ring per tone a stage change rings in. */
  export const RING_SWATCH: Swatch = {
    kind: 'ring',
    tokens: ['tl-halo-approved', 'tl-halo-started', 'tl-halo-complete']
  };
  /** The mark row: the diamond in the accent, inside the accent ring its projects carry. */
  export const MARK_SWATCH: Swatch = { kind: 'mark', tokens: ['tl-halo-policy'] };
  /** The bar row: a bar from unlikely to likely. */
  export const BAR_SWATCH: Swatch = {
    kind: 'bar',
    tokens: ['tl-bar-unlikely', 'tl-bar-uncertain', 'tl-bar-likely']
  };
</script>

<script lang="ts">
  import KeySwatch from '$lib/map/key/KeySwatch.svelte';
  import { KEY_COPY } from '$lib/map/key/copy';
  import { STAGE_KEY } from '$lib/map/key/rows';
  import { formatCount } from '$lib/scoreboard/format';
  import Explain from './Explain.svelte';
  import type { KeyTally } from './key';

  interface Props {
    tally: KeyTally | null;
    /** A policy of the person's is in force in the document the numbers on show came from. */
    inForce: boolean;
  }
  let { tally, inForce }: Props = $props();

  const id = $props.id();
</script>

<p id="{id}-homes" class="text-xs font-semibold">{KEY_COPY.homes}</p>
<dl aria-labelledby="{id}-homes" class="mt-1 space-y-1">
  {#each STAGE_KEY as row (row.id)}
    <div class="flex items-center gap-2" data-key-row={row.id}>
      <KeySwatch swatch={row.swatch} />
      <dt>{row.label}</dt>
      <dd class="ml-auto tabular-nums">{tally ? formatCount(tally[row.id]) : '…'}</dd>
    </div>
  {/each}
</dl>
<ul class="mt-2 space-y-1 border-t border-line pt-2 dark:border-line-dark">
  <li class="flex items-center gap-2" data-key-extra="ring">
    <KeySwatch swatch={RING_SWATCH} />
    <span>{KEY_COPY.ring}</span>
  </li>
  {#if inForce}
    <li class="sim-key-mark flex items-start gap-2" data-key-extra="mark">
      <span class="flex min-h-6 items-center pointer-coarse:min-h-11"
        ><KeySwatch swatch={MARK_SWATCH} /></span
      >
      <Explain text={KEY_COPY.markWhy} as="button">{KEY_COPY.mark}</Explain>
    </li>
  {/if}
  <li class="flex items-center gap-2" data-key-extra="bar">
    <KeySwatch swatch={BAR_SWATCH} />
    <span>{KEY_COPY.bar}</span>
  </li>
</ul>

<style>
  /* The mark's button is a target: 24 px, 44 on a coarse pointer (SC 2.5.8). */
  .sim-key-mark :global(button) {
    min-height: 1.5rem;
  }
  @media (pointer: coarse) {
    .sim-key-mark :global(button) {
      min-height: 2.75rem;
    }
  }
  /* The panel scrolls on y and sits at the map's right edge: the explanation is a line under the
     mark at every width, never a popover beside it. */
  .sim-key-mark :global([data-explain-open]) {
    position: static;
    display: block;
    width: auto;
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
    background: none;
  }
</style>
