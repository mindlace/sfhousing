<script lang="ts">
  import { BUTTON } from '$lib/shell/ui';
  import { YOUR_GAME, copyFor, formatPublished } from './copy';
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
    kind
  }: {
    title?: string;
    id: string;
    createdAt: string;
    datasetNotice: DatasetNotice;
    planVersion: string;
    currentVersion: string;
    kind: DocKind;
  } = $props();

  const copy = $derived(copyFor(kind));

  const notice = $derived(
    datasetNotice === 'remix'
      ? copy.n5(planVersion, currentVersion)
      : datasetNotice === 'gone'
        ? copy.n6(planVersion, currentVersion)
        : undefined
  );
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
      <a href="/" class={BUTTON}>{YOUR_GAME}</a>
    </div>
  </div>
  {#if notice}
    <p class="mt-2">{notice}</p>
  {/if}
</section>
