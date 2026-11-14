<script lang="ts">
  import { MEMBERS_COPY } from './copy';
  import { inviteBannerModel, type PendingInvite } from './invite-banner';

  let {
    invites,
    path,
    onaccepted,
    onview
  }: {
    invites: PendingInvite[];
    path: string;
    /** Called with the sim's id once the invitation is accepted. */
    onaccepted: (simId: string) => void | Promise<void>;
    /** Called for View, which goes to the sims list. */
    onview: () => void | Promise<void>;
  } = $props();

  let dismissed = $state(false);
  // Declined rows leave locally; filtering keeps it idempotent when `invites` re-seeds.
  let declinedIds = $state<string[]>([]);
  let error = $state<string | null>(null);

  const model = $derived(
    dismissed
      ? null
      : inviteBannerModel(
          invites.filter((i) => !declinedIds.includes(i.id)),
          path
        )
  );

  async function post(inv: PendingInvite, verb: 'accept' | 'decline'): Promise<boolean> {
    const res = await fetch(`/api/invites/${inv.id}/${verb}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    return res.ok;
  }

  async function run(id: string) {
    error = null;
    const inv = model?.invite;
    if (id === 'dismiss') dismissed = true;
    else if (id === 'view') await onview();
    else if (id === 'accept' && inv) {
      if (await post(inv, 'accept')) await onaccepted(inv.simId);
      else error = MEMBERS_COPY.invitationsAcceptFailedToast;
    } else if (id === 'decline' && inv) {
      if (await post(inv, 'decline')) declinedIds = [...declinedIds, inv.id];
      else error = MEMBERS_COPY.invitationsActionFailedToast;
    }
  }
</script>

<div role="status" aria-label={MEMBERS_COPY.inviteBannerLabel} data-testid="invite-banner">
  {#if model}
    <div
      class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-current/40 px-3 py-2 text-sm"
    >
      <span>{model.message}</span>
      <span class="flex gap-2">
        {#each model.actions as action (action.id)}
          <button type="button" class="underline" onclick={() => run(action.id)}
            >{action.label}</button
          >
        {/each}
      </span>
    </div>
    {#if error}<p role="alert" class="mb-4 text-sm">{error}</p>{/if}
  {/if}
</div>
