<script lang="ts">
  import { ACCOUNT_COPY, deleteConfirmLine } from '$lib/account/account-copy';
  import FieldError from '$lib/account/FieldError.svelte';
  import { BARE, BTN_DANGER, HINT, INPUT, LABEL } from '$lib/account/ui';

  interface Props {
    user: { handle: string };
    /** Called once the account is deleted and the session is gone. */
    onDeleted: () => void | Promise<void>;
  }
  let { user, onDeleted }: Props = $props();

  let triggerEl = $state<HTMLButtonElement | null>(null);
  let confirmInputEl = $state<HTMLInputElement | null>(null);

  let showDelete = $state(false);
  let confirmHandle = $state('');
  let deleting = $state(false);
  let deleteError = $state('');
  const handleMatches = $derived(confirmHandle.trim() === user.handle);

  function reveal() {
    showDelete = true;
    queueMicrotask(() => confirmInputEl?.focus());
  }

  function cancel() {
    showDelete = false;
    confirmHandle = '';
    deleteError = '';
    queueMicrotask(() => triggerEl?.focus());
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!handleMatches) return;
    deleting = true;
    deleteError = '';
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmHandle })
      });
      if (res.ok) {
        await onDeleted();
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { deleteError?: string } | null;
        deleteError = body?.deleteError ?? ACCOUNT_COPY.handleMismatch;
      } else {
        deleteError = ACCOUNT_COPY.networkError;
      }
    } catch {
      deleteError = ACCOUNT_COPY.networkError;
    }
    deleting = false;
  }
</script>

<div class="flex flex-col gap-2">
  {#if !showDelete}
    <p class={HINT}>{ACCOUNT_COPY.deleteDescription}</p>
    <button type="button" class="{BTN_DANGER} self-start" bind:this={triggerEl} onclick={reveal}>
      {ACCOUNT_COPY.deleteButton}
    </button>
  {:else}
    <p>{deleteConfirmLine(user.handle)}</p>
    <form class="flex flex-col gap-2" onsubmit={submit}>
      <label for="confirmHandle" class={LABEL}>{ACCOUNT_COPY.deleteConfirmLabel}</label>
      <div class="flex items-center gap-1">
        <span aria-hidden="true">@</span>
        <input
          id="confirmHandle"
          name="confirmHandle"
          class="{INPUT} min-w-0 flex-1"
          bind:this={confirmInputEl}
          bind:value={confirmHandle}
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          aria-invalid={deleteError ? 'true' : undefined}
          aria-describedby={deleteError ? 'confirmHandle-error' : undefined}
        />
      </div>
      {#if deleteError}
        <FieldError id="confirmHandle-error" forId="confirmHandle" message={deleteError} />
      {/if}
      <div class="flex items-center gap-4">
        <button type="button" class={BARE} onclick={cancel}>{ACCOUNT_COPY.cancel}</button>
        <button
          type="submit"
          class={BTN_DANGER}
          disabled={!handleMatches || deleting}
          aria-busy={deleting ? 'true' : undefined}>{ACCOUNT_COPY.deletePermanently}</button
        >
      </div>
    </form>
  {/if}
</div>
