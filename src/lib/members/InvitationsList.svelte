<script lang="ts">
  import {
    MEMBERS_COPY,
    invitationsAcceptNamed,
    invitationsDeclineNamed,
    invitationsRow
  } from './copy';
  import type { PendingInvite } from './invite-banner';

  let {
    invitations,
    onaccepted
  }: {
    invitations: PendingInvite[];
    /** Called with the sim's id once the invitation is accepted. */
    onaccepted: (simId: string) => void | Promise<void>;
  } = $props();

  // Declined rows are dropped locally. Filtering (never splicing a seeded copy) keeps this
  // idempotent when a later load re-seeds `invitations` without the declined row.
  let declinedIds = $state<string[]>([]);
  let notice = $state<{ text: string; kind: 'status' | 'alert' } | null>(null);
  const visible = $derived(invitations.filter((inv) => !declinedIds.includes(inv.id)));

  async function post(inv: PendingInvite, verb: 'accept' | 'decline'): Promise<boolean> {
    const res = await fetch(`/api/invites/${inv.id}/${verb}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    return res.ok;
  }

  async function accept(inv: PendingInvite) {
    if (await post(inv, 'accept')) await onaccepted(inv.simId);
    else notice = { text: MEMBERS_COPY.invitationsAcceptFailedToast, kind: 'alert' };
  }
  async function decline(inv: PendingInvite) {
    if (await post(inv, 'decline')) {
      declinedIds = [...declinedIds, inv.id];
      notice = { text: MEMBERS_COPY.invitationsDeclinedToast, kind: 'status' };
    } else notice = { text: MEMBERS_COPY.invitationsActionFailedToast, kind: 'alert' };
  }
</script>

{#if visible.length > 0}
  <section class="mb-6" aria-label={MEMBERS_COPY.invitationsHeading}>
    <h2 class="mb-1 text-sm font-medium">{MEMBERS_COPY.invitationsHeading}</h2>
    <ul class="space-y-1">
      {#each visible as inv (inv.id)}
        <li class="flex flex-wrap items-center justify-between gap-2">
          <span>{invitationsRow(inv.inviterHandle, inv.simTitle)}</span>
          <span class="flex gap-3">
            <button
              type="button"
              class="underline"
              aria-label={invitationsAcceptNamed(inv.simTitle)}
              onclick={() => accept(inv)}>{MEMBERS_COPY.invitationsAccept}</button
            >
            <button
              type="button"
              class="underline"
              aria-label={invitationsDeclineNamed(inv.simTitle)}
              onclick={() => decline(inv)}>{MEMBERS_COPY.invitationsDecline}</button
            >
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
{#if notice}
  <p role={notice.kind === 'alert' ? 'alert' : 'status'} class="mb-4 text-sm">{notice.text}</p>
{/if}
