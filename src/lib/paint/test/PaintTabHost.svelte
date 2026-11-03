<!--
  Test host for PaintTab: owns `tool`, `selected` and `rows` the way a page does, applies a
  Remove to its rows, and records the callbacks.
-->
<script lang="ts">
  import type { BrushState } from '$lib/brush/state.svelte';
  import type { BrushTool } from '$lib/brush/sampler';
  import PaintTab from '../PaintTab.svelte';
  import type { PaintRow } from '../rows';

  interface Props {
    brush: BrushState;
    rows: PaintRow[];
    eraseHint?: string;
    readonly?: boolean;
    tool?: BrushTool;
    selected?: string | null;
    ontool?: (t: BrushTool) => void;
    onremove?: (id: string) => void;
    onretry?: (keys: string[]) => void;
  }

  let {
    brush,
    rows: initial,
    eraseHint = 'Erase has no height.',
    readonly = false,
    tool: initialTool = 'move',
    selected: initialSelected = null,
    ontool = undefined,
    onremove = undefined,
    onretry = undefined
  }: Props = $props();

  // The props only seed the host's own state, as a page's would.
  // svelte-ignore state_referenced_locally
  let tool = $state<BrushTool>(initialTool);
  // svelte-ignore state_referenced_locally
  let selected = $state<string | null>(initialSelected);
  // svelte-ignore state_referenced_locally
  let rows = $state<PaintRow[]>(initial);
</script>

<PaintTab
  {brush}
  {tool}
  ontool={(t) => {
    tool = t;
    ontool?.(t);
  }}
  {rows}
  {selected}
  onselect={(id) => (selected = id)}
  onremove={(id) => {
    onremove?.(id);
    rows = rows.filter((r) => r.id !== id);
    if (selected === id) selected = null;
  }}
  {eraseHint}
  {readonly}
  onretry={onretry ? (keys) => onretry(keys) : undefined}
/>

<span data-testid="selected" hidden>{selected ?? ''}</span>
