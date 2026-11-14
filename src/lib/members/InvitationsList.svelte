<script lang="ts">
  import {
    MEMBERS_COPY,
    invitationsAcceptNamed,
    invitationsDeclineNamed,
    invitationsRow
  } from './copy';
  import type { PendingInvite } from './invite-banner';
  import FormStatus from '$lib/account/FormStatus.svelte';

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
  let notice = $state<{ text: string; error: boolean }>({ text: '', error: false });
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
    else notice = { text: MEMBERS_COPY.invitationsAcceptFailedToast, error: true };
  }
  async function decline(inv: PendingInvite) {
    if (await post(inv, 'decline')) {
      declinedIds = [...declinedIds, inv.id];
      notice = { text: MEMBERS_COPY.invitationsDeclinedToast, error: false };
    } else notice = { text: MEMBERS_COPY.invitationsActionFailedToast, error: true };
  }
</script>

<!-- Mounted while there were invitations to answer, so the status under the heading is in
     place before its text arrives (and stays to say the last one was declined). -->
{#if invitations.length > 0}
  <section class="mb-6" aria-labelledby="invitations-heading">
    <h2 id="invitations-heading" class="mb-1 text-sm font-medium">
      {MEMBERS_COPY.invitationsHeading}
    </h2>
    <FormStatus
      testid="invitations-status"
      tone={notice.error ? 'error' : 'info'}
      message={notice.text}
    />
    {#if visible.length > 0}
      <ul class="space-y-1">
        {#each visible as inv (inv.id)}
          <li class="flex flex-wrap items-center justify-between gap-2">
            <span>{invitationsRow(inv.inviterHandle, inv.simTitle)}</span>
            <span class="flex gap-3">
              <button
                type="button"
                class="min-h-6 underline"
                aria-label={invitationsAcceptNamed(inv.simTitle)}
                onclick={() => accept(inv)}>{MEMBERS_COPY.invitationsAccept}</button
              >
              <button
                type="button"
                class="min-h-6 underline"
                aria-label={invitationsDeclineNamed(inv.simTitle)}
                onclick={() => decline(inv)}>{MEMBERS_COPY.invitationsDecline}</button
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
