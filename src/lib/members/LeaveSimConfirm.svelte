<script lang="ts">
  import type { ActionResult } from '@sveltejs/kit';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { MEMBERS_COPY, memberErrorText } from './copy';

  interface Member {
    userId: string;
    handle: string;
    role: string;
  }

  /** The shape of SvelteKit's `enhance` (from `$app/forms`), which the route passes in. */
  type SubmitCallback = (
    input: unknown
  ) => (opts: { result: ActionResult; update: () => Promise<void> }) => void | Promise<void>;
  type Enhance = (form: HTMLFormElement, submit: SubmitCallback) => { destroy(): void };

  let {
    simId,
    simTitle,
    action,
    members,
    currentUserId,
    enhance,
    onsubmit,
    onLeave
  }: {
    simId: string;
    simTitle: string;
    /** Form action URL, e.g. "/sims/{id}?/leaveSim". */
    action: string;
    members: Member[];
    currentUserId: string;
    /** `enhance` from `$app/forms`, passed by the route. */
    enhance: Enhance;
    /** Called on a non-failure result; when omitted the result is applied (honors redirects). */
    onsubmit?: (result: ActionResult) => void | Promise<void>;
    /** Fired on a successful leave, before navigation. */
    onLeave?: () => void;
  } = $props();

  const me = $derived(members.find((m) => m.userId === currentUserId));
  const others = $derived(members.filter((m) => m.userId !== currentUserId));
  const managers = $derived(members.filter((m) => m.role === 'manager'));
  const isLastManager = $derived(me?.role === 'manager' && managers.length === 1);
  // A departing manager who is NOT the last manager types the title to confirm.
  const needsTitle = $derived(me?.role === 'manager' && managers.length > 1);

  let confirmTitle = $state('');
  let successorUserId = $state('');
  let confirming = $state(false);
  let error = $state('');

  let triggerEl = $state<HTMLButtonElement | null>(null);
  let firstControlEl = $state<HTMLElement | null>(null);

  // A manager with other managers needs a matching title; the other cases are always
  // submittable (the sole member is gated by `confirming`, a last manager's empty
  // successor means auto-pick).
  const canSubmit = $derived(needsTitle ? confirmTitle === simTitle : true);

  function reveal() {
    confirming = true;
    queueMicrotask(() => firstControlEl?.focus());
  }

  function cancel() {
    confirming = false;
    error = '';
    queueMicrotask(() => triggerEl?.focus());
  }

  const submit: SubmitCallback =
    () =>
    async ({ result, update }) => {
      if (result.type === 'failure' || result.type === 'error') {
        // The action answers a code; never show text from the server.
        error = memberErrorText(result.type === 'failure' ? result.data?.code : undefined);
        return;
      }
      error = '';
      confirming = false;
      onLeave?.();
      if (onsubmit) await onsubmit(result);
      else await update();
    };
</script>

{#snippet status()}
  <!-- Always mounted above the controls: only the text changes. -->
  <FormStatus testid="leave-status" tone="error" message={error} />
{/snippet}

{#if me && others.length === 0}
  <!-- Sole member: leaving deletes the sim and its pending invitations. Simple confirm,
       no title typing; posts to the same leaveSim action, which redirects to /sims. -->
  <div class="mt-4 border-t border-current/20 pt-3">
    {@render status()}
    {#if confirming}
      <form method="POST" {action} class="space-y-2" use:enhance={submit}>
        <input type="hidden" name="simId" value={simId} />
        <p class="text-sm">{MEMBERS_COPY.leaveSoleMemberWarning}</p>
        <div class="flex items-center gap-2">
          <button
            type="submit"
            class="rounded border border-current px-3 py-1 font-medium"
            bind:this={firstControlEl}
          >
            {MEMBERS_COPY.leaveDeleteButton}
          </button>
          <button type="button" class="underline" onclick={cancel}>
            {MEMBERS_COPY.leaveCancel}
          </button>
        </div>
      </form>
    {:else}
      <button
        type="button"
        class="rounded border border-current px-3 py-1"
        bind:this={triggerEl}
        onclick={reveal}
      >
        {MEMBERS_COPY.leaveButton}
      </button>
    {/if}
  </div>
{:else if me && others.length > 0}
  <div class="mt-4 border-t border-current/20 pt-3">
    {@render status()}
    {#if isLastManager}
      <form method="POST" {action} class="space-y-2" use:enhance={submit}>
        <input type="hidden" name="simId" value={simId} />
        <label class="block text-sm">
          <span class="block">{MEMBERS_COPY.leaveSuccessorLabel}</span>
          <select
            name="successorUserId"
            bind:value={successorUserId}
            class="mt-1 rounded border border-current/40 bg-transparent px-2 py-1"
          >
            <option value="">{MEMBERS_COPY.leaveSuccessorAuto}</option>
            {#each others as o (o.userId)}
              <option value={o.userId}>@{o.handle}</option>
            {/each}
          </select>
        </label>
        <button type="submit" class="rounded border border-current px-3 py-1 font-medium"
          >{MEMBERS_COPY.leaveHandoffButton}</button
        >
      </form>
    {:else if needsTitle}
      <form method="POST" {action} class="space-y-2" use:enhance={submit}>
        <input type="hidden" name="simId" value={simId} />
        <label class="block text-sm">
          <span class="block">{MEMBERS_COPY.leaveConfirmTitleLabel}</span>
          <input
            name="confirmTitle"
            type="text"
            autocomplete="off"
            bind:value={confirmTitle}
            class="mt-1 rounded border border-current/40 bg-transparent px-2 py-1"
            placeholder={simTitle}
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          class="rounded border border-current px-3 py-1 font-medium disabled:opacity-60"
        >
          {MEMBERS_COPY.leaveButton}
        </button>
      </form>
    {:else if confirming}
      <form method="POST" {action} class="flex items-center gap-2" use:enhance={submit}>
        <input type="hidden" name="simId" value={simId} />
        <span class="text-sm">{MEMBERS_COPY.leaveSimplePrompt}</span>
        <button
          type="submit"
          class="rounded border border-current px-3 py-1 font-medium"
          bind:this={firstControlEl}
        >
          {MEMBERS_COPY.leaveSimpleButton}
        </button>
        <button type="button" class="underline" onclick={cancel}>
          {MEMBERS_COPY.leaveCancel}
        </button>
      </form>
    {:else}
      <button
        type="button"
        class="rounded border border-current px-3 py-1"
        bind:this={triggerEl}
        onclick={reveal}
      >
        {MEMBERS_COPY.leaveButton}
      </button>
    {/if}
  </div>
{/if}
