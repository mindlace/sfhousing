<script lang="ts">
  import { enhance } from '$app/forms';
  import { AUTH_COPY } from '$lib/account/copy';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { MEMBERS_COPY, inviteHeading, memberErrorText } from '$lib/members/copy';
  let { data, form } = $props();

  // One status line under the heading: the sent confirmation, an Accept or Join failure (a
  // code from the action, never its text), or a magic link that came back failed.
  const failed = $derived(!!form?.code || (!!data.linkError && !form?.checkEmail));
  const status = $derived(
    form?.checkEmail
      ? MEMBERS_COPY.inviteCheckEmail
      : form?.code
        ? memberErrorText(form.code)
        : data.linkError
          ? AUTH_COPY.linkFailed
          : ''
  );

  const btn = 'rounded border border-current px-4 py-2 font-medium disabled:opacity-60';
  const bare = 'self-start px-1 py-1 underline';
  const input = 'rounded border border-current/40 bg-transparent px-3 py-2';

  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      busy = false;
      await update();
    };
  };
</script>

<svelte:head><title>{MEMBERS_COPY.invitePageTitle}</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-3 py-4">
  {#if !data.invite}
    <h1 class="text-2xl font-semibold">{MEMBERS_COPY.inviteInvalidTitle}</h1>
    <FormStatus message={status} tone={failed ? 'error' : 'info'} />
    <p>{MEMBERS_COPY.inviteInvalid}</p>
  {:else}
    <h1 class="text-2xl font-semibold">
      {inviteHeading(data.invite.inviterHandle, data.invite.simTitle)}
    </h1>
    <FormStatus message={status} tone={failed ? 'error' : 'info'} focus={!!form?.checkEmail} />
    {#if form?.checkEmail}
      {#if form?.devLink}
        <p>
          <a class="underline" href={form.devLink} data-testid="dev-link">{AUTH_COPY.devLink}</a>
        </p>
      {/if}
    {:else if data.signedIn}
      <form method="POST" action="?/accept" class="flex flex-col gap-3" use:enhance={withBusy}>
        <button type="submit" class={btn} disabled={busy} aria-busy={busy ? 'true' : undefined}
          >{MEMBERS_COPY.inviteAccept}</button
        >
      </form>
    {:else}
      <form method="POST" action="?/join" class="flex flex-col gap-3" use:enhance={withBusy}>
        <label for="invite-email" class="font-medium">{MEMBERS_COPY.inviteEmailLabel}</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autocomplete="email"
          class={input}
          value={data.invite.invitedEmail ?? ''}
        />
        <button type="submit" class={btn} disabled={busy} aria-busy={busy ? 'true' : undefined}
          >{MEMBERS_COPY.inviteJoinSim}</button
        >
        <button
          type="submit"
          name="fresh"
          value="1"
          class={bare}
          data-testid="start-fresh"
          disabled={busy}>{AUTH_COPY.startFresh}</button
        >
      </form>
    {/if}
  {/if}
</div>
