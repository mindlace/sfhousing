<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import InviteBanner from '$lib/members/InviteBanner.svelte';

  let { data, children } = $props();
</script>

<div class="mx-auto max-w-xl px-4 pt-4">
  <InviteBanner
    invites={data.recipientInvites}
    path={page.url.pathname}
    onaccepted={(simId) => goto(`/sims/${simId}`, { invalidateAll: true })}
    onview={() => goto('/sims')}
  />
</div>

{@render children()}
