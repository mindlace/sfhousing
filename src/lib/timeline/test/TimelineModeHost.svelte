<!--
  Test host: TimelineMode under the real SiteHeader, wired as the root layout wires it, and the
  page's part of the document: `policy`, `lots`, `lotsFailed` and the selection live here, and
  `ctl` lets a test set them as the page's store and PolicySync would, and call `showDetails` and
  `showActivity`. `onedit` applies the change; `onundoto` (rule 34) sets the document unless the
  test passes its own. With `withInspector` the inspector renders the Details face (or `face`'s).
  `readonly` is the page's (default false). `regionHeight` is the mode box's height (700 px unless given). With
  `saveStatus` the status is the real SaveIndicator, as SimPage renders it (`ctl.setSaveStatus`),
  and `saveOff` follows it as SimPage passes it (autosave off) unless the test gives its own.
-->
<script lang="ts">
  import { untrack, type ComponentProps, type Snippet } from 'svelte';
  import type { SaveStatus } from '$lib/sharing/autosave.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
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
    face?: 'details' | 'activity';
    readonly?: boolean;
    regionHeight?: number;
    saveStatus?: SaveStatus;
    /** Overrides the page's rule (`saveOff` while the save state is 'off'). */
    saveOff?: boolean;
    initialPolicy: SimPolicy4;
    initialLots: Lots | null;
    ctl: {
      setSaveStatus?: (s: SaveStatus) => void;
      setPolicy?: (p: SimPolicy4) => void;
      setLots?: (l: Lots | null) => void;
      setLotsFailed?: (f: boolean) => void;
      showDetails?: () => Promise<void>;
      showActivity?: () => Promise<void>;
    };
  }

  let {
    initialPolicy,
    initialLots,
    ctl,
    onundoto = undefined,
    withInspector = false,
    face = 'details',
    readonly = false,
    regionHeight = 700,
    saveStatus: initialSave = undefined,
    saveOff = undefined,
    ...rest
  }: Props = $props();
  const slot = provideHeaderActions();
  let save = $state<SaveStatus | undefined>(untrack(() => initialSave));
  let policy = $state.raw<SimPolicy4>(untrack(() => initialPolicy));
  let lots = $state.raw<Lots | null>(untrack(() => initialLots));
  let lotsFailed = $state(false);
  let selected = $state.raw<SpanRef | null>(null);
  let mode = $state<ReturnType<typeof TimelineMode>>();
  untrack(() => {
    ctl.showDetails = () => mode!.showDetails();
    ctl.showActivity = () => mode!.showActivity();
    ctl.setSaveStatus = (s) => (save = s);
    ctl.setPolicy = (p) => (policy = p);
    ctl.setLots = (l) => (lots = l);
    ctl.setLotsFailed = (f) => (lotsFailed = f);
  });
</script>

{#snippet inspector({ activity, details }: { activity: Snippet; details: Snippet })}
  <div data-testid="host-inspector">
    {#if face === 'activity'}{@render activity()}{:else}{@render details()}{/if}
  </div>
{/snippet}

{#snippet saveState(covered: boolean)}
  {#if save}
    <SaveIndicator status={save} {covered} align="start" />
  {/if}
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
    {readonly}
    saveOff={saveOff ?? save === 'off'}
    {selected}
    onselect={(r) => (selected = r)}
    onedit={(change) => (policy = change(policy))}
    onadd={() => {}}
    onundoto={onundoto ?? ((p) => (policy = p))}
    inspector={withInspector ? inspector : undefined}
    {...initialSave ? { status: saveState } : {}}
  />
</div>
