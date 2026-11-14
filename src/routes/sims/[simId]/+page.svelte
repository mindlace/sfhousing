<script lang="ts">
  import { enhance } from '$app/forms';
  import MembersPanel from '$lib/members/MembersPanel.svelte';
  import { MEMBERS_COPY, membersSummaryCount } from '$lib/members/copy';
  import { MembershipOverlay } from '$lib/members/membership-overlay.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const overlay = new MembershipOverlay();
  const members = $derived(overlay.members(data.simId, data.members));
  const pending = $derived(overlay.invites(data.simId, data.pendingInvites));
  const base = () => ({ members: data.members, invites: data.pendingInvites });

  let notice = $state<{ text: string; kind: 'status' | 'alert' } | null>(null);
  const fail = (text: string): void => {
    notice = { text, kind: 'alert' };
  };

  const JSON_HEADERS = { 'content-type': 'application/json' };
  const api = $derived(`/api/sims/${data.simId}`);

  /** The server's `{ error }` message, else the generic failure line. */
  async function failure(res: Response, fallback: string): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof body?.error === 'string' ? body.error : fallback;
  }

  async function invite(target: string) {
    notice = null;
    const res = await fetch(`${api}/invites`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ target })
    });
    if (!res.ok) return fail(await failure(res, MEMBERS_COPY.inviteFailed));
    const row = (await res.json()) as { id: string; display: string; invitedByEmail: boolean };
    overlay.addInvite(data.simId, row, base());
  }

  async function remove(userId: string) {
    notice = null;
    const res = await fetch(`${api}/members/${userId}`, {
      method: 'DELETE',
      headers: JSON_HEADERS
    });
    if (!res.ok) return fail(await failure(res, MEMBERS_COPY.membersActionFailed));
    overlay.removeMember(data.simId, userId, base());
  }

  async function resend(inviteId: string) {
    notice = null;
    const res = await fetch(`${api}/invites/${inviteId}/resend`, {
      method: 'POST',
      headers: JSON_HEADERS
    });
    if (!res.ok) return fail(await failure(res, MEMBERS_COPY.resendFailed));
    notice = { text: MEMBERS_COPY.membersResent, kind: 'status' };
  }

  async function revoke(inviteId: string) {
    notice = null;
    const res = await fetch(`${api}/invites/${inviteId}`, {
      method: 'DELETE',
      headers: JSON_HEADERS
    });
    if (!res.ok) return fail(await failure(res, MEMBERS_COPY.membersActionFailed));
    overlay.removeInvite(data.simId, inviteId, base());
  }
</script>

<svelte:head>
  <title>{data.title}</title>
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-8">
  <h1 class="text-2xl font-semibold">{data.title}</h1>

  <details class="mt-6" data-testid="members">
    <summary class="cursor-pointer text-sm font-medium"
      >{membersSummaryCount(members.length)}</summary
    >
    <div class="mt-2">
      <MembersPanel
        {members}
        isManager={data.role === 'manager'}
        {pending}
        currentUserId={data.currentUserId ?? undefined}
        simId={data.simId}
        simTitle={data.title}
        {enhance}
        onInvite={invite}
        onRemove={remove}
        onResend={resend}
        onRevoke={revoke}
      />
      {#if notice}
        <p role={notice.kind === 'alert' ? 'alert' : 'status'} class="mt-2 text-sm">
          {notice.text}
        </p>
      {/if}
    </div>
  </details>
</div>
