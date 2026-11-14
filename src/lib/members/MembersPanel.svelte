<script lang="ts">
  import LeaveSimConfirm from './LeaveSimConfirm.svelte';
  import {
    MEMBERS_COPY,
    membersRemoveConfirm,
    membersRemoveNamed,
    membersResendNamed,
    membersRevokeConfirm,
    membersRevokeNamed
  } from './copy';
  import { tick, type ComponentProps } from 'svelte';

  interface Member {
    userId: string;
    handle: string;
    role: string;
  }
  interface PendingInvite {
    id: string;
    display: string;
    invitedByEmail: boolean;
  }
  interface Props {
    members: Member[];
    isManager: boolean;
    /** False for a manager with no confirmed email: they can invite by handle only. */
    canInviteByEmail?: boolean;
    pending?: PendingInvite[];
    /** When set (plus simId/simTitle/enhance), renders the role-aware Leave control. */
    currentUserId?: string;
    simId?: string;
    simTitle?: string;
    /** `enhance` from `$app/forms`, for the Leave form. */
    enhance?: ComponentProps<typeof LeaveSimConfirm>['enhance'];
    onInvite?: (target: string) => void | Promise<void>;
    onRemove?: (userId: string) => void | Promise<void>;
    onResend?: (inviteId: string) => void | Promise<void>;
    onRevoke?: (inviteId: string) => void | Promise<void>;
    /** Fired when the current user successfully leaves the sim, before navigation. */
    onLeave?: () => void;
  }
  let {
    members,
    isManager,
    canInviteByEmail = true,
    pending = [],
    currentUserId,
    simId,
    simTitle,
    enhance,
    onInvite,
    onRemove,
    onResend,
    onRevoke,
    onLeave
  }: Props = $props();

  let root = $state<HTMLDivElement | null>(null);

  // Remove and Revoke confirm in place: the row's control becomes a short prompt with the
  // action and Cancel. Focus moves to the action; Cancel or Escape restores the control and
  // returns focus to it.
  type Confirm = { kind: 'remove' | 'revoke'; id: string };
  let confirming = $state<Confirm | null>(null);
  let confirmEl = $state<HTMLButtonElement | null>(null);
  const key = (c: Confirm) => `${c.kind}:${c.id}`;
  const isConfirming = (kind: Confirm['kind'], id: string) =>
    confirming?.kind === kind && confirming.id === id;

  async function ask(c: Confirm) {
    confirming = c;
    await tick();
    confirmEl?.focus();
  }
  async function cancel() {
    const was = confirming;
    confirming = null;
    if (!was) return;
    await tick();
    root?.querySelector<HTMLElement>(`[data-confirm-trigger="${key(was)}"]`)?.focus();
  }
  async function act() {
    const c = confirming;
    if (!c) return;
    confirming = null;
    if (c.kind === 'remove') await onRemove?.(c.id);
    else await onRevoke?.(c.id);
  }
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void cancel();
    }
  };

  const inviteLabel = $derived(
    canInviteByEmail ? MEMBERS_COPY.membersInviteLabel : MEMBERS_COPY.membersInviteHandleLabel
  );
  const invitePlaceholder = $derived(
    canInviteByEmail
      ? MEMBERS_COPY.membersInvitePlaceholder
      : MEMBERS_COPY.membersInviteHandlePlaceholder
  );

  let target = $state('');
  async function handleInvite() {
    const t = target.trim();
    if (!t) return;
    target = '';
    await onInvite?.(t);
  }
</script>

{#snippet confirmRow(prompt: string, action: string)}
  <span class="min-w-0 flex-1 truncate" id="members-confirm-prompt">{prompt}</span>
  <span class="flex gap-3">
    <button
      type="button"
      class="min-h-6 font-medium underline"
      aria-describedby="members-confirm-prompt"
      data-testid="members-confirm"
      bind:this={confirmEl}
      onkeydown={onEscape}
      onclick={act}>{action}</button
    >
    <button type="button" class="min-h-6 underline" onkeydown={onEscape} onclick={cancel}
      >{MEMBERS_COPY.membersConfirmCancel}</button
    >
  </span>
{/snippet}

<div class="text-sm" bind:this={root}>
  <ul class="mb-2 divide-y divide-current/20">
    {#each members as member (member.userId)}
      <li class="flex items-center justify-between gap-2 py-1">
        {#if isConfirming('remove', member.userId)}
          {@render confirmRow(membersRemoveConfirm(member.handle), MEMBERS_COPY.membersRemove)}
        {:else}
          <span class="min-w-0 flex-1 truncate">
            <span>@{member.handle}</span>
            {#if isManager}
              <span class="ml-1 text-xs opacity-70">· {member.role}</span>
            {/if}
          </span>
          {#if isManager && member.role !== 'manager'}
            <button
              type="button"
              class="min-h-6 min-w-6 px-2 py-1"
              aria-label={membersRemoveNamed(member.handle)}
              data-confirm-trigger={`remove:${member.userId}`}
              onclick={() => void ask({ kind: 'remove', id: member.userId })}>×</button
            >
          {/if}
        {/if}
      </li>
    {/each}
  </ul>

  {#if isManager && pending.length > 0}
    <h3 class="mt-3 mb-1 text-xs font-medium">{MEMBERS_COPY.membersPending}</h3>
    <ul class="mb-2 divide-y divide-current/20">
      {#each pending as inv (inv.id)}
        <li class="flex items-center justify-between gap-2 py-1">
          {#if isConfirming('revoke', inv.id)}
            {@render confirmRow(membersRevokeConfirm(inv.display), MEMBERS_COPY.membersRevoke)}
          {:else}
            <span class="min-w-0 flex-1 truncate">{inv.display}</span>
            <span class="flex gap-3">
              <button
                type="button"
                class="min-h-6 underline disabled:no-underline disabled:opacity-60"
                disabled={!inv.invitedByEmail}
                aria-label={membersResendNamed(inv.display)}
                onclick={() => void onResend?.(inv.id)}>{MEMBERS_COPY.membersResend}</button
              >
              <button
                type="button"
                class="min-h-6 underline"
                aria-label={membersRevokeNamed(inv.display)}
                data-confirm-trigger={`revoke:${inv.id}`}
                onclick={() => void ask({ kind: 'revoke', id: inv.id })}
                >{MEMBERS_COPY.membersRevoke}</button
              >
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if isManager}
    <div class="flex gap-1">
      <input
        type="text"
        bind:value={target}
        placeholder={invitePlaceholder}
        aria-label={inviteLabel}
        data-testid="invite-input"
        class="min-w-0 flex-1 rounded border border-current/40 bg-transparent px-2 py-1"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleInvite();
          }
        }}
      />
      <button
        type="button"
        class="rounded border border-current px-3 py-1"
        data-testid="invite-submit"
        onclick={handleInvite}>{MEMBERS_COPY.membersInvite}</button
      >
    </div>
  {/if}

  {#if currentUserId && simId && enhance}
    <LeaveSimConfirm
      {simId}
      simTitle={simTitle ?? ''}
      action={`/sims/${simId}?/leaveSim`}
      {members}
      {currentUserId}
      {enhance}
      {onLeave}
    />
  {/if}
</div>
