<script lang="ts">
  import { serializePlan, type Plan } from '$lib/plan';
  import { COPY } from './copy';
  import { sha256Hex } from './hash';
  import PublishDialog from './PublishDialog.svelte';

  type Published = { id: string; hash: string; plan: Plan };

  let {
    plan,
    lastPublished,
    onpublished,
    fetchFn,
    origin
  }: {
    plan: Plan;
    lastPublished?: { id: string; hash: string };
    onpublished: (r: Published) => void;
    fetchFn?: typeof fetch;
    origin?: string;
  } = $props();

  const uid = $props.id();
  const hintId = `${uid}-hint`;

  let hashed = $state.raw<{ plan: Plan; hash: string } | undefined>();
  let open = $state(false);
  let mode = $state<'form' | 'success'>('form');

  $effect(() => {
    const p = plan;
    let live = true;
    void sha256Hex(serializePlan(p)).then((hash) => {
      if (live) hashed = { plan: p, hash };
    });
    return () => {
      live = false;
    };
  });

  const empty = $derived(plan.ops.length === 0);
  const hashReady = $derived(hashed !== undefined && hashed.plan === plan);
  const alreadyPublished = $derived(
    !empty && hashReady && lastPublished !== undefined && hashed?.hash === lastPublished.hash
  );
  const resolvedOrigin = $derived(
    origin ?? (typeof location === 'undefined' ? '' : location.origin)
  );

  function onclick() {
    mode = alreadyPublished ? 'success' : 'form';
    open = true;
  }
</script>

<button
  type="button"
  data-testid="publish-open"
  data-hashed={hashReady}
  disabled={empty}
  aria-describedby={empty ? hintId : undefined}
  aria-haspopup="dialog"
  {onclick}
  class="min-h-6 min-w-6 rounded-md bg-blue-700 px-2 text-sm font-medium whitespace-nowrap text-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-700 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
>
  {alreadyPublished ? 'Share link' : 'Publish'}
</button>
{#if empty}
  <span id={hintId} class="sr-only">{COPY.disabledHint}</span>
{/if}

<PublishDialog
  bind:open
  {plan}
  {mode}
  publishedId={lastPublished?.id}
  {onpublished}
  {fetchFn}
  origin={resolvedOrigin}
/>
