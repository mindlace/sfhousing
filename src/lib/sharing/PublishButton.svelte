<script lang="ts" generics="D">
  import { copyFor } from './copy';
  import type { DocCodec } from './doc-codec';
  import { sha256Hex } from './hash';
  import PublishDialog from './PublishDialog.svelte';

  type Published = { id: string; hash: string; plan: D };

  let {
    codec,
    doc,
    lastPublished,
    onpublished,
    fetchFn,
    origin
  }: {
    codec: DocCodec<D>;
    doc: D;
    lastPublished?: { id: string; hash: string };
    onpublished: (r: Published) => void;
    fetchFn?: typeof fetch;
    origin?: string;
  } = $props();

  const uid = $props.id();
  const hintId = `${uid}-hint`;

  let hashed = $state.raw<{ doc: D; hash: string } | undefined>();
  const copy = $derived(copyFor(codec.kind));
  let open = $state(false);
  let mode = $state<'form' | 'success'>('form');

  $effect(() => {
    const d = doc;
    const c = codec;
    let live = true;
    void sha256Hex(c.serialize(c.publishable(d))).then((hash) => {
      if (live) hashed = { doc: d, hash };
    });
    return () => {
      live = false;
    };
  });

  const empty = $derived(codec.isEmpty(doc));
  const hashReady = $derived(hashed !== undefined && hashed.doc === doc);
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
  <span id={hintId} class="sr-only">{copy.disabledHint}</span>
{/if}

<PublishDialog
  bind:open
  {codec}
  {doc}
  {mode}
  publishedId={lastPublished?.id}
  {onpublished}
  {fetchFn}
  origin={resolvedOrigin}
/>
