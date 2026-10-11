<script lang="ts">
  import { formatPublished, n5, n6, remixConfirm } from './copy';

  // Mirrors DatasetNotice in $lib/server/sharing/shared-page (kept local: client code).
  type DatasetNotice = 'none' | 'remix' | 'gone';

  // eslint-disable-next-line svelte/no-unused-props -- id: part of the banner contract
  let {
    title,
    createdAt,
    datasetNotice,
    planVersion,
    currentVersion,
    localOpCount,
    onremix
  }: {
    title?: string;
    id: string;
    createdAt: string;
    datasetNotice: DatasetNotice;
    planVersion: string;
    currentVersion: string;
    localOpCount: () => number;
    onremix: () => void;
  } = $props();

  const uid = $props.id();
  const confirmId = `${uid}-confirm`;

  let dlg: HTMLDialogElement | undefined = $state();
  let cancelEl: HTMLButtonElement | undefined = $state();
  let pending = $state(0);

  const notice = $derived(
    datasetNotice === 'remix'
      ? n5(planVersion, currentVersion)
      : datasetNotice === 'gone'
        ? n6(planVersion, currentVersion)
        : undefined
  );

  /** Spec §4.7 Remix: confirm only when the local plan has at least one op. */
  function startRemix() {
    const n = localOpCount();
    if (n >= 1) {
      pending = n;
      dlg?.showModal();
      cancelEl?.focus(); // the non-destructive choice takes focus
      return;
    }
    onremix();
  }

  function replace() {
    dlg?.close();
    onremix();
  }

  const btn =
    'min-h-6 min-w-6 rounded-md px-3 py-1.5 text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11';
  const primary = `${btn} bg-blue-700 font-medium text-white hover:bg-blue-800`;
  const secondary = `${btn} border border-gray-400 bg-white text-gray-800 hover:bg-gray-50`;
</script>

<!-- Sticky at the top of the /p/:id page column; every row wraps at 375 px. -->
<section
  aria-label="Shared plan"
  class="sticky top-0 z-30 border-b border-gray-300 bg-white px-4 py-2 text-sm text-gray-900"
>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <p class="min-w-0 flex-1 basis-64 break-words">
      <strong>{title ?? 'Untitled plan'}</strong> · Shared plan · published
      {formatPublished(createdAt)}
    </p>
    <div class="flex flex-wrap gap-2">
      <button type="button" class={primary} onclick={startRemix}>Remix</button>
      <a href="/" class="{secondary} inline-flex items-center justify-center">Start your own</a>
    </div>
  </div>
  {#if notice}
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p class="min-w-0 flex-1 basis-64 text-gray-800">{notice}</p>
      <button type="button" class={secondary} onclick={startRemix}>Open with current data</button>
    </div>
  {/if}
</section>

<dialog
  bind:this={dlg}
  aria-labelledby={confirmId}
  class="m-auto w-[calc(100vw-2rem)] max-w-md rounded-lg bg-white p-5 text-gray-800 shadow-xl backdrop:bg-black/40"
>
  <p id={confirmId} class="text-sm">{remixConfirm(pending)}</p>
  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <button type="button" class={primary} onclick={replace}>Replace</button>
    <button bind:this={cancelEl} type="button" class={secondary} onclick={() => dlg?.close()}>
      Cancel
    </button>
  </div>
</dialog>
