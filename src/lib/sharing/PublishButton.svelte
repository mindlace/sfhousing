<script lang="ts" generics="D">
  import { BUTTON_PRIMARY } from '$lib/shell/ui';
  import Explain from '$lib/timeline/Explain.svelte';
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

  const uid = $props.id();
  const hintId = `${uid}-hint`;

  function onclick(e: MouseEvent) {
    // aria-disabled, not `disabled`, so it stays focusable and shows its reason: a press (click,
    // Enter or Space, which all arrive here) does nothing but focus it, so the reason shows where
    // a tap does not focus (iOS Safari, a VoiceOver double-tap).
    if (empty) {
      (e.currentTarget as HTMLElement).focus();
      return;
    }
    mode = alreadyPublished ? 'success' : 'form';
    open = true;
  }
</script>

<!-- One button in both states, so focus on it survives the switch (undo or redo from the
     keyboard). While empty the reason shows under it on hover and focus; the hidden hint describes
     it at rest too (a browse-mode screen reader moves no focus), so Explain adds no description
     of its own and the reason is read once. -->
<span class="explain-under relative inline-block">
  <Explain as="wrap" text={copy.disabledHint} off={!empty} describes={false}>
    <button
      type="button"
      data-testid="publish-open"
      data-hashed={hashReady}
      aria-disabled={empty ? 'true' : undefined}
      aria-describedby={empty ? hintId : undefined}
      aria-haspopup="dialog"
      {onclick}
      class={BUTTON_PRIMARY}
    >
      {alreadyPublished ? 'Share link' : 'Publish'}
    </button>
  </Explain>
  {#if empty}<span id={hintId} class="sr-only">{copy.disabledHint}</span>{/if}
</span>

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
