<script module lang="ts">
  export type RemixState =
    { kind: 'ready'; note: string | null } | { kind: 'locked' } | { kind: 'full' } | null;
</script>

<script lang="ts">
  import { FULL_TEXT } from '$lib/game/copy';
  import { BUTTON, BUTTON_PRIMARY } from '$lib/shell/ui';
  import { REMIX_LOCKED, YOUR_GAME, copyFor, formatPublished } from './copy';
  import type { DocKind } from './doc-codec';

  // Mirrors DatasetNotice in $lib/server/sharing/shared-page (kept local: client code).
  type DatasetNotice = 'none' | 'remix' | 'gone';

  // eslint-disable-next-line svelte/no-unused-props -- id: part of the banner contract
  let {
    title,
    createdAt,
    datasetNotice,
    planVersion,
    currentVersion,
    kind,
    remix,
    error = null,
    gameHref,
    onremix
  }: {
    title?: string;
    id: string;
    createdAt: string;
    datasetNotice: DatasetNotice;
    planVersion: string;
    currentVersion: string;
    kind: DocKind;
    remix: RemixState;
    error?: string | null;
    /** The current game's page. */
    gameHref: string;
    onremix: () => void;
  } = $props();

  const copy = $derived(copyFor(kind));

  const notice = $derived(
    datasetNotice === 'remix'
      ? copy.n5(planVersion, currentVersion)
      : datasetNotice === 'gone'
        ? copy.n6(planVersion, currentVersion)
        : undefined
  );

  const disabled = $derived(remix?.kind === 'locked' || remix?.kind === 'full');

  function press() {
    if (remix?.kind === 'ready') onremix();
  }
</script>

<!-- Sticky at the top of the /p/:id and /s/:id page column; every row wraps at 375 px. -->
<section
  aria-label={copy.shared}
  class="sticky top-0 z-30 border-b border-line bg-surface px-4 py-2 text-sm text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <p class="min-w-0 flex-1 basis-64 break-words">
      <strong>{title ?? copy.untitled}</strong> · {copy.shared} · published
      {formatPublished(createdAt)}
    </p>
    <div class="flex flex-wrap gap-2">
      {#if remix}
        <button type="button" class={BUTTON_PRIMARY} aria-disabled={disabled} onclick={press}>
          {remix.kind === 'locked' ? REMIX_LOCKED : 'Remix'}
        </button>
      {/if}
      <a href={gameHref} class={BUTTON}>{YOUR_GAME}</a>
    </div>
  </div>
  {#if remix?.kind === 'ready' && remix.note}
    <p class="mt-2">{remix.note}</p>
  {:else if remix?.kind === 'full'}
    <p class="mt-2">{FULL_TEXT}</p>
  {/if}
  {#if error}
    <p role="alert" class="mt-2">{error}</p>
  {/if}
  {#if notice}
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p class="min-w-0 flex-1 basis-64">{notice}</p>
      {#if remix}
        <button type="button" class={BUTTON} aria-disabled={disabled} onclick={press}>
          Open with current data
        </button>
      {/if}
    </div>
  {/if}
</section>
