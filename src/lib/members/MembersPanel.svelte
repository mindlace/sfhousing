<script lang="ts">
  import LeaveSimConfirm from './LeaveSimConfirm.svelte';
  import { MEMBERS_COPY, membersRemoveNamed, membersResendNamed, membersRevokeNamed } from './copy';
  import type { ComponentProps } from 'svelte';

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

  let target = $state('');
  async function handleInvite() {
    const t = target.trim();
    if (!t) return;
    target = '';
    await onInvite?.(t);
  }
</script>

<div class="text-sm">
  <ul class="mb-2 divide-y divide-current/20">
    {#each members as member (member.userId)}
      <li class="flex items-center justify-between gap-2 py-1">
        <span class="min-w-0 flex-1 truncate">
          <span>@{member.handle}</span>
          {#if isManager}
            <span class="ml-1 text-xs opacity-70">· {member.role}</span>
          {/if}
        </span>
        {#if isManager && member.role !== 'manager'}
          <button
            type="button"
            class="px-2 py-1"
            aria-label={membersRemoveNamed(member.handle)}
            onclick={() => void onRemove?.(member.userId)}>×</button
          >
        {/if}
      </li>
    {/each}
  </ul>

  {#if isManager && pending.length > 0}
    <h3 class="mt-3 mb-1 text-xs font-medium">{MEMBERS_COPY.membersPending}</h3>
    <ul class="mb-2 divide-y divide-current/20">
      {#each pending as inv (inv.id)}
        <li class="flex items-center justify-between gap-2 py-1">
          <span class="min-w-0 flex-1 truncate">{inv.display}</span>
          <span class="flex gap-3">
            <button
              type="button"
              class="underline disabled:no-underline disabled:opacity-60"
              disabled={!inv.invitedByEmail}
              aria-label={membersResendNamed(inv.display)}
              onclick={() => void onResend?.(inv.id)}>{MEMBERS_COPY.membersResend}</button
            >
            <button
              type="button"
              class="underline"
              aria-label={membersRevokeNamed(inv.display)}
              onclick={() => void onRevoke?.(inv.id)}>{MEMBERS_COPY.membersRevoke}</button
            >
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if isManager}
    <div class="flex gap-1">
      <input
        type="text"
        bind:value={target}
        placeholder={MEMBERS_COPY.membersInvitePlaceholder}
        aria-label={MEMBERS_COPY.membersInviteLabel}
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
