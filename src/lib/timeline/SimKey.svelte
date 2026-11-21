<!--
  /sim's key panel: the homes in each stage group at the playhead's month (`keyTally`), each
  label beside its swatch and count, under "Homes". '…' while the numbers are calculating. Then
  what the map draws over the buildings: the ring of a stage change (one labelled ring per tone),
  then the merged ring zoomed out and the glow at the edge for a change off screen, the mark of a
  project under the person's policy (only while one is in force; its claim behind a tap), and the
  stage bar.
-->
<script module lang="ts">
  import { STAGE_KEY, type StageGroup, type Swatch } from '$lib/map/key/rows';
  import { HALO_TOKEN } from '$lib/map/timelapse/halos';
  import { CITY_KIND_TOKEN } from '$lib/map/timelapse/city';

  type RingKind = keyof typeof HALO_TOKEN;
  const ring = (kind: RingKind, group: StageGroup) => ({
    kind,
    label: STAGE_KEY.find((r) => r.id === group)!.label,
    swatch: { kind: 'ring', tokens: [HALO_TOKEN[kind]] } satisfies Swatch
  });
  /**
   * The ring rows: each kind the halo layer rings in, in its token (`HALO_TOKEN`, the layer's
   * own), named by the tally's word for that stage, so the key speaks one vocabulary.
   */
  export const RING_ROWS = [
    ring('approved', 'approved'),
    ring('started', 'building'),
    ring('completed', 'completed')
  ];
  /** The city layer's tones (`CITY_KIND_TOKEN`): the ring tones and the policy accent. */
  const CITY_TONES = [...CITY_KIND_TOKEN];
  /** The merged ring the city layer draws zoomed out, one per area, in its tones. */
  export const AREA_SWATCH: Swatch = { kind: 'area', tokens: CITY_TONES };
  /** The glow the city layer draws at the map's edge for a change off screen, in its tones. */
  export const EDGE_SWATCH: Swatch = { kind: 'edge', tokens: CITY_TONES };
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
  <li data-key-extra="ring">
    <span>{KEY_COPY.ring}</span>
    <ul class="mt-1 space-y-1">
      {#each RING_ROWS as r (r.kind)}
        <li class="flex items-center gap-2" data-ring-kind={r.kind}>
          <KeySwatch swatch={r.swatch} />
          <span>{r.label}</span>
        </li>
      {/each}
      <li class="flex items-center gap-2" data-key-extra="area">
        <KeySwatch swatch={AREA_SWATCH} />
        <span>{KEY_COPY.area}</span>
      </li>
      <li class="flex items-center gap-2" data-key-extra="edge">
        <KeySwatch swatch={EDGE_SWATCH} />
        <span>{KEY_COPY.edge}</span>
      </li>
    </ul>
  </li>
  {#if inForce}
    <li class="sim-key-mark flex items-start gap-2" data-key-extra="mark">
      <span class="flex min-h-6 min-w-6 items-center"><KeySwatch swatch={MARK_SWATCH} /></span>
      <Explain text={KEY_COPY.markWhy} as="button">{KEY_COPY.mark}</Explain>
    </li>
  {/if}
  <li class="flex items-center gap-2" data-key-extra="bar">
    <KeySwatch swatch={BAR_SWATCH} />
    <span>{KEY_COPY.bar}</span>
  </li>
</ul>

<style>
  /* The mark's button is a target: 24 px on every pointer (SC 2.5.8). */
  .sim-key-mark :global(button) {
    min-height: 1.5rem;
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
