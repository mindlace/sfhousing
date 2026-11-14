<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ACCOUNT_COPY } from '$lib/account/account-copy';
  import { AUTH_COPY } from '$lib/account/copy';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { BARE } from '$lib/account/ui';
  import AuthenticationPane from '$lib/account/AuthenticationPane.svelte';
  import { currentUser } from '$lib/account/current-user.svelte';
  import DeleteAccountPane from '$lib/account/DeleteAccountPane.svelte';
  import ProfilePane from '$lib/account/ProfilePane.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const user = $derived(currentUser.overlay(data.user) ?? data.user);
  const withPassword = $derived(data.methods.includes('password'));
  // With no method in effect a pseudonymous account has nothing under Sign-in: no section.
  const showAuth = $derived(!user.pseudonymous || data.methods.length > 0);

  // The password facts ride /api/account; they matter only where password sign-in is on.
  let facts = $state<{
    hasGoogle: boolean;
    hasPassword: boolean;
    canRemovePassword: boolean;
  } | null>(null);
  let loadFailed = $state(false);

  async function loadFacts() {
    try {
      const res = await fetch('/api/account');
      if (!res.ok) throw new Error(String(res.status));
      facts = await res.json();
      loadFailed = false;
    } catch {
      loadFailed = true;
    }
  }
  onMount(() => {
    if (withPassword) void loadFacts();
  });

  const settled = $derived(!withPassword || facts !== null);

  async function afterDelete() {
    await goto('/', { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>{ACCOUNT_COPY.pageTitle}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-8 py-4">
  <div class="flex flex-col gap-2">
    <h1 class="text-2xl font-semibold">{ACCOUNT_COPY.heading}</h1>
    <FormStatus
      testid="account-status"
      tone="error"
      message={data.linkError ? AUTH_COPY.linkFailed : ''}
    />
    <form method="POST" action="?/signOut">
      <button type="submit" class={BARE}>{ACCOUNT_COPY.signOut}</button>
    </form>
  </div>

  <section class="flex flex-col gap-3" aria-labelledby="profile-heading">
    <h2 id="profile-heading" class="text-lg font-semibold">{ACCOUNT_COPY.profileHeading}</h2>
    <ProfilePane {user} />
  </section>

  {#if showAuth}
    <section class="flex flex-col gap-3" aria-labelledby="auth-heading">
      <h2 id="auth-heading" class="text-lg font-semibold">{ACCOUNT_COPY.authHeading}</h2>
      <AuthenticationPane
        {user}
        methods={data.methods}
        hasGoogle={facts?.hasGoogle ?? data.hasOAuthAccount}
        hasPassword={facts?.hasPassword ?? false}
        canRemovePassword={facts?.canRemovePassword ?? false}
        hasPasskey={data.hasPasskey}
        accountLoading={!settled}
        accountLoadFailed={loadFailed}
        onAccountChanged={loadFacts}
      />
    </section>
  {/if}

  <section class="flex flex-col gap-3" aria-labelledby="delete-heading">
    <h2 id="delete-heading" class="text-lg font-semibold">{ACCOUNT_COPY.deleteHeading}</h2>
    <DeleteAccountPane {user} onDeleted={afterDelete} />
  </section>
</div>
