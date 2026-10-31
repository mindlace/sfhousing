<script lang="ts" generics="D">
  import { tick, untrack } from 'svelte';
  import { REPO_URL } from '$lib/config';
  import { MAX_PLAN_BYTES, TITLE_MAX_CHARS } from '$lib/plan';
  import { copyFor } from './copy';
  import type { DocCodec } from './doc-codec';
  import { sha256Hex } from './hash';
  import {
    isReportable,
    publishErrorMessage,
    publishDoc,
    type PublishFailure
  } from './publish-client';
  import { normalizeTitle } from './title';

  type Published = { id: string; hash: string; plan: D };

  const encoder = new TextEncoder();

  let {
    open = $bindable(false),
    codec,
    doc,
    mode,
    publishedId,
    onpublished,
    fetchFn,
    origin,
    now = () => Date.now()
  }: {
    open: boolean;
    codec: DocCodec<D>;
    doc: D;
    mode: 'form' | 'success';
    publishedId?: string;
    onpublished: (r: Published) => void;
    fetchFn?: typeof fetch;
    origin: string;
    now?: () => number;
  } = $props();

  const uid = $props.id();
  const ids = {
    heading: `${uid}-heading`,
    title: `${uid}-title`,
    link: `${uid}-link`,
    size: `${uid}-size`,
    preflight: `${uid}-preflight`
  };

  let dlg: HTMLDialogElement | undefined = $state();
  let titleEl: HTMLInputElement | undefined = $state();
  let linkEl: HTMLInputElement | undefined = $state();

  let view = $state<'form' | 'success'>('form');
  let id = $state<string | undefined>();
  let sentTitle = $state<string | undefined>();
  let title = $state('');
  let busy = $state(false);
  let inFlight = false; // synchronous guard: a second click before the DOM updates is ignored
  let failure = $state.raw<{ outcome: PublishFailure; bytes: number } | undefined>();
  // A server 413 blocks Publish until the plan or the title changes.
  let blockedFor = $state.raw<{ doc: D; title: string | undefined } | undefined>();
  let retryLeft = $state(0);
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const copy = $derived(copyFor(codec.kind));
  const candidate = $derived(codec.withTitle(doc, normalizeTitle(title)));
  // What Publish sends, and so what is measured and hashed.
  const payload = $derived(codec.publishable(candidate));
  const bytes = $derived(encoder.encode(codec.serialize(payload)).byteLength);
  const oversize = $derived(bytes > MAX_PLAN_BYTES);
  const blocked = $derived(
    blockedFor !== undefined && blockedFor.doc === doc && blockedFor.title === normalizeTitle(title)
  );
  const canPublish = $derived(!busy && !oversize && !blocked && retryLeft === 0);
  const url = $derived(id ? `${origin}${codec.path(id)}` : '');
  const shareable = typeof navigator !== 'undefined' && 'share' in navigator;
  const message = $derived.by(() => {
    if (!failure) return undefined;
    if (failure.outcome.code === 'too_large' && !blocked) return undefined;
    return publishErrorMessage(failure.outcome, failure.bytes, codec.kind);
  });

  function stopCountdown() {
    clearInterval(retryTimer);
    retryTimer = undefined;
  }

  function startCountdown(seconds: number) {
    stopCountdown();
    const deadline = now() + seconds * 1000;
    const update = () => {
      retryLeft = Math.max(0, Math.ceil((deadline - now()) / 1000));
      if (retryLeft === 0) {
        stopCountdown();
        if (failure?.outcome.code === 'rate_limited') failure = undefined;
      }
    };
    update();
    retryTimer = setInterval(update, 1000);
  }

  function reset() {
    view = mode;
    id = mode === 'success' ? publishedId : undefined;
    sentTitle = codec.title(doc);
    title = codec.title(doc) ?? '';
    failure = retryLeft > 0 ? failure : undefined;
    blockedFor = undefined;
    copied = false;
  }

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      untrack(reset);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  });

  $effect(() => () => {
    stopCountdown();
    clearTimeout(copiedTimer);
  });

  async function publish() {
    if (inFlight || !canPublish) return;
    inFlight = true;
    busy = true;
    failure = undefined;
    const sent = candidate;
    const sentPayload = payload;
    const sentBytes = bytes;
    try {
      const outcome = await publishDoc(codec, sentPayload, { fetchFn });
      if (outcome.ok) {
        const hash = await sha256Hex(codec.serialize(sentPayload));
        id = outcome.id;
        sentTitle = codec.title(sent);
        view = 'success';
        onpublished({ id: outcome.id, hash, plan: sent });
        await tick();
        linkEl?.focus();
        return;
      }
      failure = { outcome, bytes: sentBytes };
      if (outcome.code === 'too_large') blockedFor = { doc, title: codec.title(sent) };
      if (outcome.code === 'rate_limited') startCountdown(outcome.retryAfter ?? 60);
    } finally {
      busy = false;
      inFlight = false;
    }
    await tick();
    if (dlg?.open && !dlg.contains(document.activeElement)) titleEl?.focus();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      linkEl?.select();
      return;
    }
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 2000);
  }

  async function share() {
    try {
      await navigator.share({ url, title: sentTitle });
    } catch {
      // AbortError (the user closed the share sheet) and share failures need no UI:
      // the link field and Copy link remain.
    }
  }

  const btn =
    'min-h-6 min-w-6 rounded-md px-3 py-1.5 text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11 disabled:cursor-not-allowed disabled:opacity-50';
  const primary = `${btn} bg-blue-700 font-medium text-white`;
  const secondary = `${btn} border border-gray-400 bg-white text-gray-800`;
</script>

<dialog
  bind:this={dlg}
  aria-labelledby={ids.heading}
  oncancel={(e) => {
    if (busy) e.preventDefault();
  }}
  onclose={() => (open = false)}
  class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-lg bg-white p-5 text-gray-800 shadow-xl backdrop:bg-black/40"
>
  {#if view === 'success'}
    <h2 id={ids.heading} class="text-lg font-semibold">{copy.successHeading}</h2>
    <label for={ids.link} class="mt-4 block text-sm font-medium">Link</label>
    <input
      bind:this={linkEl}
      id={ids.link}
      type="text"
      readonly
      value={url}
      onfocus={(e) => e.currentTarget.select()}
      class="mt-1 w-full rounded-md border border-gray-400 px-2 py-1.5 text-sm"
    />
    <div class="mt-4 flex flex-wrap justify-end gap-2">
      <button type="button" class={secondary} onclick={copyLink}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      {#if shareable}
        <button type="button" class={secondary} onclick={share}>Share…</button>
      {/if}
      <a
        href={url}
        target="_blank"
        rel="noopener"
        class="{secondary} inline-flex items-center justify-center"
        >Open<span class="sr-only"> (opens in a new tab)</span></a
      >
      <button type="button" class={primary} onclick={() => (open = false)}>Done</button>
    </div>
    <p class="sr-only" role="status">{copied ? 'Link copied' : ''}</p>
  {:else}
    <h2 id={ids.heading} class="text-lg font-semibold">{copy.dialogHeading}</h2>
    <form
      class="mt-4"
      onsubmit={(e) => {
        e.preventDefault();
        void publish();
      }}
    >
      <label for={ids.title} class="block text-sm font-medium">Title</label>
      <input
        bind:this={titleEl}
        bind:value={title}
        id={ids.title}
        type="text"
        maxlength={TITLE_MAX_CHARS}
        disabled={busy}
        autocomplete="off"
        class="mt-1 w-full rounded-md border border-gray-400 px-2 py-1.5 text-sm disabled:opacity-50"
      />
      <p class="mt-3 text-sm">{copy.dialogBody}</p>
      <p id={ids.size} class="mt-2 text-sm text-gray-700">{copy.sizeLine(bytes)}</p>
      {#if oversize}
        <p id={ids.preflight} class="mt-2 text-sm text-red-800">{copy.tooLarge(bytes)}</p>
      {/if}
      <div role="alert" class="text-sm text-red-800">
        {#if message && failure}
          <p class="mt-2">
            {message}
            {#if isReportable(failure.outcome.code)}
              <a href="{REPO_URL}/issues" target="_blank" rel="noopener" class="underline"
                >Report an issue<span class="sr-only"> (opens in a new tab)</span></a
              >
            {/if}
          </p>
        {/if}
      </div>
      {#if retryLeft > 0}
        <p class="mt-1 text-sm text-gray-700">You can publish again in {retryLeft} s.</p>
      {/if}
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class={secondary} disabled={busy} onclick={() => (open = false)}>
          Cancel
        </button>
        <button
          type="submit"
          class={primary}
          disabled={!canPublish}
          aria-busy={busy}
          aria-describedby={oversize ? ids.preflight : undefined}
        >
          {busy ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </form>
  {/if}
</dialog>
