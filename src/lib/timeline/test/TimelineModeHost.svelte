<!--
  Test host: TimelineMode under the real SiteHeader, wired as the root layout wires it, and the
  page's part of the document: `policy`, `lots`, `lotsFailed` and the selection live here, and
  `ctl` lets a test set them as the page's store and PolicySync would, and call `showResults`. `onedit` applies the change; `onundoto`
  (rule 34) sets the document unless the test passes its own. With `withInspector` the inspector
  renders the Results face. `regionHeight` is the mode box's height (700 px unless given).
-->
<script lang="ts">
  import { untrack, type ComponentProps, type Snippet } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import type { SimPolicy4 } from '../policy4';
  import type { Lots } from '../session.svelte';
  import type { SpanRef } from '../spans';
  import TimelineMode from '../TimelineMode.svelte';

  type Rest = Omit<
    ComponentProps<typeof TimelineMode>,
    | 'policy'
    | 'lots'
    | 'lotsFailed'
    | 'selected'
    | 'onselect'
    | 'onedit'
    | 'onadd'
    | 'readonly'
    | 'onundoto'
  >;
  interface Props extends Rest {
    onundoto?: (p: SimPolicy4) => void;
    withInspector?: boolean;
    regionHeight?: number;
    initialPolicy: SimPolicy4;
    initialLots: Lots | null;
    ctl: {
      setPolicy?: (p: SimPolicy4) => void;
      setLots?: (l: Lots | null) => void;
      setLotsFailed?: (f: boolean) => void;
      showResults?: () => Promise<void>;
    };
  }

  let {
    initialPolicy,
    initialLots,
    ctl,
    onundoto = undefined,
    withInspector = false,
    regionHeight = 700,
    ...rest
  }: Props = $props();
  const slot = provideHeaderActions();
  let policy = $state.raw<SimPolicy4>(untrack(() => initialPolicy));
  let lots = $state.raw<Lots | null>(untrack(() => initialLots));
  let lotsFailed = $state(false);
  let selected = $state.raw<SpanRef | null>(null);
  let mode = $state<ReturnType<typeof TimelineMode>>();
  untrack(() => {
    ctl.showResults = () => mode!.showResults();
    ctl.setPolicy = (p) => (policy = p);
    ctl.setLots = (l) => (lots = l);
    ctl.setLotsFailed = (f) => (lotsFailed = f);
  });
</script>

{#snippet inspector({ results }: { results: Snippet })}
  <div data-testid="host-inspector">{@render results()}</div>
{/snippet}

<SiteHeader
  actions={slot.current ?? undefined}
  pinned={slot.pinned ?? undefined}
  status={slot.status ?? undefined}
  routeId="/sim"
/>
<div id="map-region" class="relative" style:height="{regionHeight}px">
  <TimelineMode
    bind:this={mode}
    {...rest}
    {policy}
    {lots}
    {lotsFailed}
    readonly={false}
    {selected}
    onselect={(r) => (selected = r)}
    onedit={(change) => (policy = change(policy))}
    onadd={() => {}}
    onundoto={onundoto ?? ((p) => (policy = p))}
    inspector={withInspector ? inspector : undefined}
  />
</div>
