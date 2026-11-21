<!--
  About, part 2: the assumptions (docs/dev/about.md). Live (the dialog on /sim): the run's sections
  at once; the dialog starts the data checks with `loadChecks()` on each open. On the page: a disclosure whose first open fetches the calibration and shows
  `modelSections`; nothing is fetched until then. A hash naming this part or a `src-` id opens it
  on mount and scrolls to the target once it exists. Colours only from --about-muted and
  --about-line, which the container sets.
-->
<script lang="ts">
  import type { ManifestSources } from '$lib/data/manifest';
  import ProvenanceBody from '$lib/fzp/ProvenanceBody.svelte';
  import { fetchCalibration } from '$lib/fzp/load';
  import { modelSections, type ProvSection } from '$lib/fzp/provenance';
  import Message from '$lib/shell/Message.svelte';
  import { BUTTON_QUIET, TARGET } from '$lib/shell/ui';
  import { onMount, untrack } from 'svelte';
  import { ABOUT_ID, ASSUMPTIONS_FAILED, ASSUMPTIONS_SHOW, PART_HEADING } from './copy';

  interface Props {
    level: 2 | 3;
    /** The dialog: the run's sections, shown at once. */
    live?: { sections: ProvSection[]; projectsUrl: string | null };
    /** In the interface for the caller; the files' URLs come from the manifest. */
    datasetVersion?: string;
    manifest?: ManifestSources | null;
    fetchFn?: typeof fetch;
  }

  // eslint-disable-next-line svelte/no-unused-props
  let { level, live, manifest = null, fetchFn }: Props = $props();

  type Model =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'ready'; sections: ProvSection[] };

  const fzp = $derived(manifest?.scenarios?.fzp ?? null);
  const bodyLevel = $derived((level + 1) as 3 | 4);

  /** Not bound: `bind:open` would close a disclosure pressed before hydration. */
  let details = $state<HTMLDetailsElement | null>(null);
  let open = $state(false);
  let model = $state<Model>({ kind: 'idle' });
  /** The id a hash named on mount, until it has been scrolled to. */
  let landing = $state<string | null>(null);
  let body = $state<ProvenanceBody | null>(null);

  /**
   * The one way to start the data checks: a no-op while they load or once loaded, a retry after a
   * failure. The dialog calls it on every open; the page on every open of the disclosure.
   */
  export function loadChecks(): void {
    body?.loadChecks();
  }

  function load() {
    if (fzp === null || model.kind === 'loading' || model.kind === 'ready') return;
    model = { kind: 'loading' };
    const f = fetchFn ?? ((...a) => fetch(...a));
    fetchCalibration(fzp.calibration, (u) => f(u)).then(
      (cal) => {
        model = { kind: 'ready', sections: modelSections(cal) };
      },
      () => {
        model = { kind: 'failed' };
      }
    );
  }

  onMount(() => {
    if (live) return;
    // Pressed before hydration: take the disclosure's own state.
    if (details?.open) open = true;
    // Taken as written: the ids are ASCII, and decoding throws on a stray '%'.
    const id = location.hash.slice(1);
    if (id !== ABOUT_ID.assumptions && !id.startsWith('src-')) return;
    landing = id;
    if (details !== null) {
      details.open = true;
      open = true;
    }
  });

  // The first open loads; closing and opening again keeps what loaded.
  $effect(() => {
    if (open && model.kind === 'idle') load();
  });

  // The page: each open of the disclosure (and the body's first showing) starts the data checks,
  // so a failed load tries again on the next open.
  $effect(() => {
    if (!live && open && body !== null) untrack(loadChecks);
  });

  // Scroll to the hash's target once it exists, once. Effects run after the DOM updates.
  $effect(() => {
    if (landing === null) return;
    void model.kind;
    const el = document.getElementById(landing);
    if (el === null) return;
    el.scrollIntoView({ block: 'start' });
    landing = null;
  });
</script>

{#snippet retry()}
  <button type="button" class={BUTTON_QUIET} onclick={load}>Retry</button>
{/snippet}

<section id={ABOUT_ID.assumptions}>
  <svelte:element this={`h${level}`} class="text-lg font-semibold"
    >{PART_HEADING.assumptions}</svelte:element
  >
  {#if live}
    <ProvenanceBody
      bind:this={body}
      sections={live.sections}
      projectsUrl={live.projectsUrl}
      level={bodyLevel}
      {fetchFn}
    />
  {:else if fzp === null}
    <div class="mt-2"><Message text={ASSUMPTIONS_FAILED} /></div>
  {:else}
    <details bind:this={details} ontoggle={() => (open = details?.open ?? false)} class="mt-2">
      <summary class="{TARGET} cursor-pointer font-semibold">{ASSUMPTIONS_SHOW}</summary>
      <!-- One status region, mounted with the disclosure: what it says changes, so it is
           announced once per change. -->
      <div role="status" class="contents">
        {#if model.kind === 'loading'}
          <div class="mt-2"><Message text="Loading…" /></div>
        {:else if model.kind === 'failed'}
          <div class="mt-2"><Message text={ASSUMPTIONS_FAILED} actions={retry} /></div>
        {/if}
      </div>
      {#if model.kind === 'ready'}
        <ProvenanceBody
          bind:this={body}
          sections={model.sections}
          projectsUrl={fzp.projects}
          level={bodyLevel}
          {fetchFn}
        />
      {/if}
    </details>
  {/if}
</section>
