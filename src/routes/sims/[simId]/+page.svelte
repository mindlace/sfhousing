<script lang="ts">
  import { enhance } from '$app/forms';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import MembersPanel from '$lib/members/MembersPanel.svelte';
  import {
    MEMBERS_COPY,
    SIMS_COPY,
    SIM_TITLE_MAX,
    memberErrorText,
    membersSummaryCount
  } from '$lib/members/copy';
  import { MembershipOverlay } from '$lib/members/membership-overlay.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const canRename = $derived(data.role === 'manager' || data.role === 'editor');
  const renameError = $derived(form?.renameError ?? null);

  const overlay = new MembershipOverlay();
  const members = $derived(overlay.members(data.simId, data.members));
  const pending = $derived(overlay.invites(data.simId, data.pendingInvites));
  const base = () => ({ members: data.members, invites: data.pendingInvites });

  // One always-mounted status line under the title: only its text changes.
  let notice = $state<{ text: string; error: boolean }>({ text: '', error: false });
  const clear = (): void => {
    notice = { text: '', error: false };
  };
  const fail = (text: string): void => {
    notice = { text, error: true };
  };

  const JSON_HEADERS = { 'content-type': 'application/json' };
  const api = $derived(`/api/sims/${data.simId}`);

  /** The line for the route's `{ code }`; never the response's own text. */
  async function failure(res: Response): Promise<string> {
    if (res.status === 429) return memberErrorText('rate_limited');
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    return memberErrorText(body?.code);
  }

  async function invite(target: string) {
    clear();
    const res = await fetch(`${api}/invites`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ target })
    });
    if (!res.ok) return fail(await failure(res));
    const row = (await res.json()) as { id: string; display: string; invitedByEmail: boolean };
    overlay.addInvite(data.simId, row, base());
  }

  async function remove(userId: string) {
    clear();
    const res = await fetch(`${api}/members/${userId}`, {
      method: 'DELETE',
      headers: JSON_HEADERS
    });
    if (!res.ok) return fail(await failure(res));
    overlay.removeMember(data.simId, userId, base());
  }

  async function resend(inviteId: string) {
    clear();
    const res = await fetch(`${api}/invites/${inviteId}/resend`, {
      method: 'POST',
      headers: JSON_HEADERS
    });
    if (!res.ok) return fail(await failure(res));
    notice = { text: MEMBERS_COPY.membersResent, error: false };
  }

  async function revoke(inviteId: string) {
    clear();
    const res = await fetch(`${api}/invites/${inviteId}`, {
      method: 'DELETE',
      headers: JSON_HEADERS
    });
    if (!res.ok) return fail(await failure(res));
    overlay.removeInvite(data.simId, inviteId, base());
  }
</script>

<svelte:head>
  <title>{data.title}</title>
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-8">
  <h1 class="text-2xl font-semibold">{data.title}</h1>
  <FormStatus
    testid="members-status"
    tone={notice.error ? 'error' : 'info'}
    message={notice.text}
  />

  {#if canRename}
    <details class="mt-2" data-testid="rename" open={renameError !== null}>
      <summary class="cursor-pointer text-sm font-medium">{SIMS_COPY.renameSummary}</summary>
      <form method="POST" action="?/rename" use:enhance class="mt-2 flex flex-wrap items-end gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label for="sim-name" class="text-sm font-medium">{SIMS_COPY.renameLabel}</label>
          <input
            id="sim-name"
            name="name"
            type="text"
            required
            maxlength={SIM_TITLE_MAX}
            autocomplete="off"
            value={data.title}
            class="rounded border border-current/40 bg-transparent px-3 py-2"
            aria-invalid={renameError ? 'true' : undefined}
            aria-describedby={renameError ? 'sim-name-error' : undefined}
          />
          <FieldError id="sim-name-error" forId="sim-name" message={renameError} />
        </div>
        <button type="submit" class="rounded border border-current px-4 py-2 font-medium">
          {SIMS_COPY.renameSave}
        </button>
      </form>
    </details>
  {/if}

  <details class="mt-6" data-testid="members">
    <summary class="cursor-pointer text-sm font-medium"
      >{membersSummaryCount(members.length)}</summary
    >
    <div class="mt-2">
      <MembersPanel
        {members}
        isManager={data.role === 'manager'}
        canInviteByEmail={data.canInviteByEmail}
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
    </div>
  </details>
</div>
