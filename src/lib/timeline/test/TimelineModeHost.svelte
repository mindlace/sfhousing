<!--
  Test host: TimelineMode with the root layout's header slots beside it (as FzpModeHost) and the
  page's part of the document: `policy`, `lots` and the selection live here, and `ctl` lets a test
  set them as the page's store and PolicySync would. `onedit` applies the change.
-->
<script lang="ts">
  import { untrack, type ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import type { SimPolicy4 } from '../policy4';
  import type { Lots } from '../session.svelte';
  import type { SpanRef } from '../spans';
  import TimelineMode from '../TimelineMode.svelte';

  type Rest = Omit<
    ComponentProps<typeof TimelineMode>,
    'policy' | 'lots' | 'selected' | 'onselect' | 'onedit' | 'onadd' | 'readonly'
  >;
  interface Props extends Rest {
    initialPolicy: SimPolicy4;
    initialLots: Lots | null;
    ctl: { setPolicy?: (p: SimPolicy4) => void; setLots?: (l: Lots | null) => void };
  }

  let { initialPolicy, initialLots, ctl, ...rest }: Props = $props();
  const slot = provideHeaderActions();
  let policy = $state.raw<SimPolicy4>(untrack(() => initialPolicy));
  let lots = $state.raw<Lots | null>(untrack(() => initialLots));
  let selected = $state.raw<SpanRef | null>(null);
  untrack(() => {
    ctl.setPolicy = (p) => (policy = p);
    ctl.setLots = (l) => (lots = l);
  });
</script>

<div class="relative flex h-12 items-center justify-end gap-2 px-4">
  <div data-testid="header-status">{@render slot.status?.()}</div>
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<div id="map-region" class="relative" style="height: 700px">
  <TimelineMode
    {...rest}
    {policy}
    {lots}
    readonly={false}
    {selected}
    onselect={(r) => (selected = r)}
    onedit={(change) => (policy = change(policy))}
    onadd={() => {}}
  />
</div>
